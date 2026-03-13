/**
 * Import conversation history from Claude Code JSONL logs into a neurobuttr session.
 * Called by the bridge server on startup to populate the metro map with past activity.
 *
 * - Parses user prompts and tool calls from the main session
 * - Infers `requiresApproval` from tool type
 * - Discovers subagent JSONL files and imports them as branches
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { saveSession } from "../core/storage.js";
import { generateId, now } from "../utils.js";
/** Generate a short stable event key from a JSONL entry UUID + timestamp */
function makeEventKey(entryUuid, timestamp, index) {
    // Use entry UUID if available, otherwise fall back to timestamp + index
    const source = entryUuid || `${timestamp}-${index}`;
    const hash = createHash("sha256").update(source).digest("hex");
    return hash.slice(0, 7); // 7 hex chars = 268M unique keys, similar to git short SHA
}
/** Map Claude Code tool names to our ActionType */
function toolToActionType(toolName) {
    const name = toolName.toLowerCase();
    if (name === "read")
        return "read";
    if (name === "edit" || name === "write")
        return "edit";
    if (name === "bash")
        return "bash";
    if (name === "grep" || name === "glob")
        return "search";
    if (name === "agent")
        return "agent";
    if (name.startsWith("mcp_") || name.startsWith("mcp__"))
        return "other";
    return "other";
}
/** Does this tool typically require user approval in default permission mode? */
function toolRequiresApproval(toolName) {
    const name = toolName.toLowerCase();
    // These tools mutate state or run arbitrary code — require approval
    if (name === "bash")
        return true;
    if (name === "edit" || name === "write")
        return true;
    if (name === "agent")
        return true;
    // NotebookEdit, WebFetch, etc. also require approval
    if (name === "notebookedit" || name === "webfetch" || name === "websearch")
        return true;
    // Read-only tools are auto-approved
    if (name === "read" || name === "grep" || name === "glob")
        return false;
    // Skill tool doesn't require approval
    if (name === "skill" || name === "toolsearch" || name === "todowrite")
        return false;
    // MCP tools typically require approval
    if (name.startsWith("mcp_") || name.startsWith("mcp__"))
        return true;
    return false;
}
/** Get a short description for a tool use */
function toolSummary(toolName, input) {
    switch (toolName) {
        case "Read":
            return `Read ${input.file_path || "file"}`;
        case "Edit":
            return `Edit ${input.file_path || "file"}`;
        case "Write":
            return `Write ${input.file_path || "file"}`;
        case "Bash":
            return `$ ${typeof input.command === "string" ? input.command.slice(0, 80) : "command"}`;
        case "Grep":
            return `Grep: ${input.pattern || ""}`;
        case "Glob":
            return `Glob: ${input.pattern || ""}`;
        case "Agent":
            return `Agent: ${input.description || "subagent"}`;
        case "TodoWrite":
            if (Array.isArray(input.todos)) {
                const items = input.todos;
                const summary = items.map(t => `[${t.status || "?"}] ${t.content || ""}`).join("; ");
                return `Todo: ${summary.slice(0, 120)}`;
            }
            return "TodoWrite";
        case "AskUserQuestion":
            return `Ask: ${typeof input.question === "string" ? input.question.slice(0, 100) : "question"}`;
        case "ToolSearch":
            return `ToolSearch: ${typeof input.query === "string" ? input.query : "search"}`;
        case "Skill":
            return `Skill: ${typeof input.skill === "string" ? input.skill : "invoke"}`;
        case "WebSearch":
            return `WebSearch: ${typeof input.query === "string" ? input.query.slice(0, 80) : "search"}`;
        case "WebFetch":
            return `WebFetch: ${typeof input.url === "string" ? input.url.slice(0, 80) : "url"}`;
        case "NotebookEdit":
            return `NotebookEdit: ${input.notebook_path || "notebook"}`;
        default:
            // For unknown tools, try to extract something useful from input
            if (input && typeof input === "object") {
                const firstStr = Object.values(input).find(v => typeof v === "string");
                if (firstStr)
                    return `${toolName}: ${firstStr.slice(0, 80)}`;
            }
            return toolName;
    }
}
/** Compute Claude Code's project hash from a directory path */
function claudeProjectHash(cwd) {
    return cwd.replace(/[/_]/g, "-");
}
/** Find all JSONL session files for this project, sorted by mtime (oldest first) */
async function findAllSessions(projectPath) {
    const hash = claudeProjectHash(projectPath);
    const dir = join(homedir(), ".claude", "projects", hash);
    let files;
    try {
        const entries = await readdir(dir);
        // Only top-level .jsonl files (not subagent files in subdirs)
        files = entries.filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
    }
    catch {
        return [];
    }
    if (files.length === 0)
        return [];
    const withStats = await Promise.all(files.map(async (f) => {
        try {
            const s = await stat(f);
            return { path: f, mtime: s.mtimeMs };
        }
        catch {
            return { path: f, mtime: 0 };
        }
    }));
    // Oldest first — chronological order on the metro map
    withStats.sort((a, b) => a.mtime - b.mtime);
    return withStats.map((w) => w.path);
}
/** Find subagent JSONL files for the most recent session of this project.
 *  Subagents live inside per-session UUID dirs: {projectHash}/{sessionId}/subagents/
 */
async function findSubagentFiles(projectPath, sessionFile) {
    // sessionFile is like /.../projects/{hash}/{uuid}.jsonl
    // The subagents dir is at /.../projects/{hash}/{uuid}/subagents/
    const sessionId = sessionFile.replace(/\.jsonl$/, "");
    const subDir = join(sessionId, "subagents");
    try {
        const entries = await readdir(subDir);
        return entries
            .filter((f) => f.endsWith(".jsonl"))
            .map((f) => join(subDir, f));
    }
    catch {
        return [];
    }
}
/** Parse a JSONL file into journal entries */
function parseJSONL(raw) {
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const entries = [];
    for (const line of lines) {
        try {
            entries.push(JSON.parse(line));
        }
        catch {
            // skip malformed
        }
    }
    return entries;
}
/** Check if text is IDE metadata that should be skipped */
function isMetadata(text) {
    return (text.startsWith("<ide_opened_file>") ||
        text.startsWith("<ide_selection>") ||
        text.startsWith("<system-reminder>") ||
        text.startsWith("<available-deferred-tools>"));
}
/** Extract messages from journal entries, capturing entry UUIDs for event keys */
function extractMessages(entries) {
    const messages = [];
    let msgIndex = 0;
    for (const entry of entries) {
        if (!entry.message?.content)
            continue;
        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : now();
        const entryUuid = entry.uuid;
        // Normalize content: subagent user entries may have string content
        const rawContent = entry.message.content;
        const blocks = typeof rawContent === "string"
            ? [{ type: "text", text: rawContent }]
            : Array.isArray(rawContent) ? rawContent : [];
        if (entry.type === "user") {
            for (const block of blocks) {
                if (block.type === "text" && block.text && !isMetadata(block.text)) {
                    const key = makeEventKey(entryUuid, ts, msgIndex++);
                    messages.push({
                        id: generateId(),
                        role: "user",
                        content: block.text,
                        timestamp: ts,
                        actionType: "prompt",
                        requiresApproval: false,
                        sourceEntryUuid: entryUuid,
                        eventKey: key,
                    });
                    break;
                }
            }
        }
        else if (entry.type === "assistant") {
            for (const block of blocks) {
                if (block.type === "tool_use" && block.name) {
                    const actionType = toolToActionType(block.name);
                    const content = toolSummary(block.name, block.input || {});
                    const requiresApproval = toolRequiresApproval(block.name);
                    // Extract agentId for Agent tool calls
                    let agentId;
                    if (block.name === "Agent" && block.input) {
                        const desc = block.input.description;
                        if (typeof desc === "string") {
                            agentId = entry.uuid;
                        }
                    }
                    const key = makeEventKey(entryUuid, ts, msgIndex++);
                    messages.push({
                        id: generateId(),
                        role: "assistant",
                        content,
                        timestamp: ts,
                        actionType,
                        requiresApproval,
                        agentId,
                        sourceEntryUuid: entryUuid,
                        eventKey: key,
                    });
                }
            }
            // Non-tool text responses
            if (!blocks.some((b) => b.type === "tool_use")) {
                const textBlock = blocks.find((b) => b.type === "text" && b.text && b.text.length > 20);
                if (textBlock?.text) {
                    const key = makeEventKey(entryUuid, ts, msgIndex++);
                    messages.push({
                        id: generateId(),
                        role: "assistant",
                        content: textBlock.text,
                        timestamp: ts,
                        actionType: "other",
                        requiresApproval: false,
                        sourceEntryUuid: entryUuid,
                        eventKey: key,
                    });
                }
            }
        }
    }
    return messages;
}
/** Metro line colors for chat sessions */
const SESSION_COLORS = [
    "#58a6ff", "#a5b4fc", "#79c0ff", "#d4a72c",
    "#f0883e", "#3fb950", "#f47067", "#bc8cff",
];
/** Extract a session ID (uuid stem) from a JSONL file path */
function sessionIdFromFile(filePath) {
    const base = filePath.split("/").pop() || filePath;
    return base.replace(/\.jsonl$/, "");
}
/**
 * Import all Claude Code sessions for this project into the neurobuttr session.
 * Each JSONL file becomes a separate "chat session" (metro line).
 * Only imports if the session currently has no messages (fresh start).
 * Returns the number of messages imported.
 */
export async function importSessionHistory(session) {
    // Only import into empty sessions
    if (session.messages.length > 0)
        return 0;
    const sessionFiles = await findAllSessions(session.projectPath);
    if (sessionFiles.length === 0)
        return 0;
    let totalMessages = 0;
    let branchCount = 0;
    for (let idx = 0; idx < sessionFiles.length; idx++) {
        const filePath = sessionFiles[idx];
        const sourceId = sessionIdFromFile(filePath);
        const color = SESSION_COLORS[idx % SESSION_COLORS.length];
        let raw;
        try {
            raw = await readFile(filePath, "utf-8");
        }
        catch {
            continue;
        }
        const entries = parseJSONL(raw);
        const messages = extractMessages(entries);
        if (messages.length === 0)
            continue;
        // Tag each message with its source session
        for (const m of messages) {
            m.sourceSessionId = sourceId;
        }
        // Build chat session metadata
        const firstPrompt = messages.find((m) => m.actionType === "prompt");
        const label = firstPrompt
            ? firstPrompt.content.slice(0, 60)
            : `Chat ${idx + 1}`;
        const chatSession = {
            id: sourceId,
            label,
            color,
            startedAt: messages[0].timestamp,
            endedAt: messages[messages.length - 1].timestamp,
            messageCount: messages.length,
        };
        session.chatSessions.push(chatSession);
        session.messages.push(...messages);
        totalMessages += messages.length;
        // Import subagent files as branches for this session
        const subagentFiles = await findSubagentFiles(session.projectPath, filePath);
        for (const subFile of subagentFiles) {
            try {
                const subRaw = await readFile(subFile, "utf-8");
                const subEntries = parseJSONL(subRaw);
                const subMessages = extractMessages(subEntries);
                if (subMessages.length === 0)
                    continue;
                // Tag subagent messages with parent session
                for (const m of subMessages) {
                    m.sourceSessionId = sourceId;
                }
                const subFirstPrompt = subMessages.find((m) => m.actionType === "prompt");
                const topic = subFirstPrompt
                    ? subFirstPrompt.content.slice(0, 60)
                    : `Agent ${branchCount + 1}`;
                // Find closest parent message by timestamp (within this session's messages)
                const subStart = subMessages[0].timestamp;
                let parentMsg = messages[0];
                for (const m of messages) {
                    if (m.timestamp <= subStart)
                        parentMsg = m;
                    else
                        break;
                }
                const branch = {
                    id: generateId(),
                    name: `agent: ${topic}`,
                    parentMessageId: parentMsg.id,
                    anchorContext: `Subagent exploration`,
                    messages: subMessages,
                    resolved: true,
                    topic,
                    createdAt: subStart,
                };
                session.branches.push(branch);
                branchCount++;
            }
            catch {
                // skip broken subagent files
            }
        }
    }
    if (totalMessages === 0)
        return 0;
    // Sort all messages by timestamp for proper interleaving
    session.messages.sort((a, b) => a.timestamp - b.timestamp);
    session.updatedAt = now();
    await saveSession(session);
    return totalMessages + branchCount;
}
//# sourceMappingURL=import-history.js.map