import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { computeDiffFromToolUse } from "./diff-computer.js";
const MAX_TOOL_OUTPUT_LENGTH = 10_000;
const ACTIVE_SESSION_THRESHOLD_MS = 30_000;
/**
 * Compute Claude Code's project hash from a directory path.
 * Claude Code uses the absolute path with '/' replaced by '-'.
 */
export function claudeProjectHash(cwd) {
    return cwd.replace(/[/_]/g, "-");
}
/**
 * Find all JSONL session files for a project in Claude Code's log directory.
 */
export async function findSessionFiles(claudeHash) {
    const dir = join(homedir(), ".claude", "projects", claudeHash);
    try {
        const entries = await readdir(dir);
        return entries
            .filter((f) => f.endsWith(".jsonl"))
            .map((f) => join(dir, f));
    }
    catch {
        return [];
    }
}
/**
 * Extract the session UUID from a JSONL filename.
 */
function sessionIdFromFile(filePath) {
    return basename(filePath, ".jsonl");
}
/**
 * Check if a session file is still being actively written to.
 */
async function isActiveSession(filePath) {
    try {
        const s = await stat(filePath);
        return Date.now() - s.mtimeMs < ACTIVE_SESSION_THRESHOLD_MS;
    }
    catch {
        return false;
    }
}
/**
 * Parse a single JSONL file into a TimelineSession.
 * Returns null if the session is empty, active, or unparseable.
 */
export async function parseJSONLFile(filePath, projectPath, projectHash) {
    // Skip active sessions
    if (await isActiveSession(filePath)) {
        return null;
    }
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const entries = [];
    for (const line of lines) {
        try {
            entries.push(JSON.parse(line));
        }
        catch {
            // Skip malformed lines
        }
    }
    // Filter to user and assistant entries
    const messages = entries.filter((e) => e.type === "user" || e.type === "assistant");
    if (messages.length === 0) {
        return null;
    }
    // Extract prompt (first real user text, skipping IDE metadata)
    let prompt = "";
    for (const msg of messages) {
        if (msg.type === "user" && msg.message?.content) {
            for (const block of msg.message.content) {
                if (block.type === "text" && block.text) {
                    const text = block.text.trim();
                    // Skip IDE-injected context blocks (VS Code sends these before the real prompt)
                    if (text.startsWith("<ide_opened_file>") ||
                        text.startsWith("<ide_selection>") ||
                        text.startsWith("<system-reminder>") ||
                        text.startsWith("<available-deferred-tools>")) {
                        continue;
                    }
                    prompt = text;
                    break;
                }
            }
            if (prompt)
                break;
        }
    }
    if (!prompt) {
        // Fallback: if all text blocks were IDE metadata, use a cleaned version of the first one
        for (const msg of messages) {
            if (msg.type === "user" && msg.message?.content) {
                for (const block of msg.message.content) {
                    if (block.type === "text" && block.text) {
                        prompt = block.text
                            .replace(/<ide_opened_file>.*?<\/ide_opened_file>/gs, "")
                            .replace(/<ide_selection>.*?<\/ide_selection>/gs, "")
                            .replace(/<system-reminder>.*?<\/system-reminder>/gs, "")
                            .replace(/<available-deferred-tools>.*?<\/available-deferred-tools>/gs, "")
                            .trim();
                        if (prompt)
                            break;
                    }
                }
                if (prompt)
                    break;
            }
        }
        if (!prompt) {
            prompt = "(IDE session — no explicit prompt)";
        }
    }
    // Extract metadata from first entries
    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];
    const claudeCodeVersion = firstMsg.version || "unknown";
    const gitBranch = firstMsg.gitBranch || "unknown";
    // Find model from first assistant message
    let model = "unknown";
    for (const msg of messages) {
        if (msg.type === "assistant" && msg.message?.model) {
            model = msg.message.model;
            break;
        }
    }
    // Build actions
    const actions = [];
    const filesRead = new Set();
    const filesModified = new Set();
    let actionIndex = 0;
    for (const msg of messages) {
        const timestamp = msg.timestamp
            ? new Date(msg.timestamp).getTime()
            : Date.now();
        const content = msg.message?.content || [];
        for (const block of content) {
            if (msg.type === "assistant" && block.type === "text" && block.text) {
                const action = {
                    index: actionIndex++,
                    timestamp,
                    type: "reasoning",
                    reasoning: block.text,
                };
                actions.push(action);
            }
            if (msg.type === "assistant" && block.type === "tool_use" && block.name) {
                const toolInput = (block.input || {});
                const fileDiff = computeDiffFromToolUse(block.name, toolInput);
                // Track files
                const filePath = toolInput.file_path;
                if (filePath) {
                    if (block.name === "Read") {
                        filesRead.add(filePath);
                    }
                    else if (block.name === "Edit" ||
                        block.name === "Write") {
                        filesModified.add(filePath);
                    }
                }
                if (block.name === "Grep" || block.name === "Glob") {
                    const path = toolInput.path;
                    if (path)
                        filesRead.add(path);
                }
                const action = {
                    index: actionIndex++,
                    timestamp,
                    type: "tool_use",
                    toolName: block.name,
                    toolInput,
                    fileDiff,
                };
                actions.push(action);
            }
            if ((msg.type === "user" && block.type === "tool_result") ||
                block.type === "tool_result") {
                let output = null;
                if (typeof block.content === "string") {
                    output = block.content;
                }
                else if (Array.isArray(block.content)) {
                    // Content is a list of blocks — extract text
                    output = block.content
                        .map((b) => (typeof b === "string" ? b : b.text || ""))
                        .join("\n");
                }
                // Truncate large outputs
                if (output && output.length > MAX_TOOL_OUTPUT_LENGTH) {
                    output =
                        output.slice(0, MAX_TOOL_OUTPUT_LENGTH) +
                            `\n... [truncated, ${output.length} chars total]`;
                }
                const action = {
                    index: actionIndex++,
                    timestamp,
                    type: "tool_result",
                    toolUseId: block.tool_use_id || "",
                    toolOutput: output,
                    isError: block.is_error === true,
                };
                actions.push(action);
            }
        }
    }
    // Skip sessions with no tool usage (empty sessions)
    const hasToolUse = actions.some((a) => a.type === "tool_use");
    if (!hasToolUse) {
        return null;
    }
    const startedAt = firstMsg.timestamp
        ? new Date(firstMsg.timestamp).getTime()
        : Date.now();
    const completedAt = lastMsg.timestamp
        ? new Date(lastMsg.timestamp).getTime()
        : Date.now();
    // Auto-generate summary
    const promptExcerpt = prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt;
    const toolUseCount = actions.filter((a) => a.type === "tool_use").length;
    const summary = `${promptExcerpt} (${toolUseCount} tool calls, ${filesModified.size} files modified)`;
    // Parse subagent sessions
    const sessionId = sessionIdFromFile(filePath);
    const subagentSessions = await parseSubagents(filePath, sessionId, projectPath, projectHash);
    return {
        id: sessionId,
        projectPath,
        projectHash,
        prompt,
        model,
        claudeCodeVersion,
        startedAt,
        completedAt,
        status: "completed",
        actions,
        gitBranch,
        gitCommitBefore: null, // Would need git log correlation
        gitCommitAfter: null,
        filesRead: [...filesRead],
        filesModified: [...filesModified],
        summary,
        parentSessionId: null,
        branchPoint: null,
        tags: [],
        notes: "",
        subagentSessions,
    };
}
/**
 * Parse subagent JSONL files for a session.
 */
async function parseSubagents(parentFilePath, parentSessionId, projectPath, projectHash) {
    const parentDir = parentFilePath.replace(".jsonl", "");
    const subagentDir = join(parentDir, "subagents");
    try {
        const files = await readdir(subagentDir);
        const subagentFiles = files
            .filter((f) => f.endsWith(".jsonl"))
            .map((f) => join(subagentDir, f));
        const results = [];
        for (const file of subagentFiles) {
            const session = await parseJSONLFile(file, projectPath, projectHash);
            if (session) {
                session.parentSessionId = parentSessionId;
                results.push(session);
            }
        }
        return results;
    }
    catch {
        return []; // No subagents directory
    }
}
/**
 * Find uncaptured session files (not in the capturedIds set).
 */
export function filterUncaptured(filePaths, capturedIds) {
    return filePaths.filter((f) => !capturedIds.has(sessionIdFromFile(f)));
}
//# sourceMappingURL=parser.js.map