import { z } from "zod";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveSession } from "../core/session-manager.js";
/** Compute Claude Code's project hash from a directory path */
function claudeProjectHash(cwd) {
    return cwd.replace(/[/_]/g, "-");
}
/** Build the JSONL file path from a source session ID */
function jsonlPath(projectPath, sourceSessionId) {
    const hash = claudeProjectHash(projectPath);
    return join(homedir(), ".claude", "projects", hash, `${sourceSessionId}.jsonl`);
}
export function registerLookupTools(server) {
    server.tool("nb_lookup", `Look up a neurobuttr event by its key (e.g. "nb:a3f2c8" or just "a3f2c8"). Returns the event details and the JSONL file path so you can read the raw source data for full context. Use this when a user references an event key from the metro map UI.`, {
        key: z
            .string()
            .describe('Event key from the metro map (e.g. "nb:a3f2c8" or "a3f2c8")'),
        cwd: z
            .string()
            .optional()
            .describe("Project directory (auto-detected if omitted)"),
    }, async ({ key, cwd }) => {
        try {
            const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
            const session = await resolveSession(projectPath);
            // Normalize key — strip "nb:" prefix if present
            const normalizedKey = key.replace(/^nb:/, "").trim().toLowerCase();
            // Search all messages (main + branches) for matching event key
            let found = null;
            let location = "main";
            let branchName;
            for (const m of session.messages) {
                if (m.eventKey === normalizedKey) {
                    found = m;
                    break;
                }
            }
            if (!found) {
                for (const b of session.branches) {
                    for (const m of b.messages) {
                        if (m.eventKey === normalizedKey) {
                            found = m;
                            location = "branch";
                            branchName = b.name;
                            break;
                        }
                    }
                    if (found)
                        break;
                }
            }
            if (!found) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No event found with key "${key}". Keys are 7-character hex strings shown in the metro map UI (e.g. "nb:a3f2c8").`,
                        },
                    ],
                    isError: true,
                };
            }
            // Build the response — enough to remind Claude what happened
            const lines = [];
            lines.push(`## Event nb:${found.eventKey}`);
            lines.push("");
            lines.push(`**Type:** ${found.actionType || "other"}`);
            lines.push(`**Role:** ${found.role === "user" ? "User prompt" : "AI action"}`);
            lines.push(`**Time:** ${new Date(found.timestamp).toISOString()}`);
            if (location === "branch" && branchName) {
                lines.push(`**Branch:** ${branchName}`);
            }
            // Find the chat session this belongs to
            const chatSession = (session.chatSessions || []).find((cs) => cs.id === found.sourceSessionId);
            if (chatSession) {
                lines.push(`**Chat:** ${chatSession.label}`);
            }
            lines.push("");
            lines.push("**Content:**");
            lines.push(found.content);
            // Provide the JSONL path for deeper investigation
            if (found.sourceSessionId) {
                const path = jsonlPath(projectPath, found.sourceSessionId);
                lines.push("");
                lines.push("---");
                lines.push(`**Source JSONL:** \`${path}\``);
                if (found.sourceEntryUuid) {
                    lines.push(`**Entry UUID:** \`${found.sourceEntryUuid}\``);
                    lines.push(`To see the full raw data, read the JSONL file and search for this UUID.`);
                }
            }
            return {
                content: [
                    {
                        type: "text",
                        text: lines.join("\n"),
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=lookup-tools.js.map