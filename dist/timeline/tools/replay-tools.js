import { z } from "zod";
import { timelineProjectHash, loadTimelineIndex, loadTimelineSession, } from "../storage.js";
export function registerTimelineReplayTools(server) {
    server.tool("nb_timeline_replay", `Replay a captured session up to a specific action index. Shows actions and reasoning up to that point, plus a context summary you can use to start a new Claude Code session from that state (lightweight branching). Use this to try a different approach from a known point in a previous session.`, {
        session_id: z
            .string()
            .describe('Session ID (full UUID or first 8 chars)'),
        at_action: z
            .number()
            .describe("Action index to replay up to (inclusive)"),
        cwd: z
            .string()
            .optional()
            .describe("Project directory (auto-detected if omitted)"),
    }, async ({ session_id, at_action, cwd }) => {
        try {
            const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
            const projHash = timelineProjectHash(projectPath);
            // Resolve session
            const index = await loadTimelineIndex(projHash);
            const match = index.sessions.find((s) => s.id === session_id || s.id.startsWith(session_id));
            if (!match) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Session "${session_id}" not found.`,
                        },
                    ],
                    isError: true,
                };
            }
            const session = await loadTimelineSession(projHash, match.id);
            if (!session) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Session file not found for "${match.id}".`,
                        },
                    ],
                    isError: true,
                };
            }
            if (at_action < 0 || at_action >= session.actions.length) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Invalid action index ${at_action}. Session has ${session.actions.length} actions (0-${session.actions.length - 1}).`,
                        },
                    ],
                    isError: true,
                };
            }
            // Collect state up to the action
            const actionsUpTo = session.actions.slice(0, at_action + 1);
            const filesModifiedUpTo = new Set();
            const filesReadUpTo = new Set();
            const reasoning = [];
            const toolCalls = [];
            for (const action of actionsUpTo) {
                if (action.type === "reasoning") {
                    reasoning.push(action.reasoning);
                }
                if (action.type === "tool_use") {
                    toolCalls.push(`${action.toolName}(${JSON.stringify(action.toolInput).slice(0, 80)})`);
                    if (action.fileDiff) {
                        filesModifiedUpTo.add(action.fileDiff.path);
                    }
                    const fp = action.toolInput.file_path;
                    if (fp) {
                        if (action.toolName === "Read") {
                            filesReadUpTo.add(fp);
                        }
                        else {
                            filesModifiedUpTo.add(fp);
                        }
                    }
                }
            }
            // Build context summary for branching
            const lines = [];
            lines.push(`=== Session Replay: ${match.id.slice(0, 8)} ===`);
            lines.push(`Original prompt: "${session.prompt}"`);
            lines.push(`Replayed to action ${at_action} of ${session.actions.length - 1}`);
            lines.push(`Model: ${session.model}`);
            lines.push("");
            lines.push(`--- Files touched up to this point ---`);
            if (filesReadUpTo.size > 0) {
                for (const f of filesReadUpTo) {
                    lines.push(`  R ${f}`);
                }
            }
            if (filesModifiedUpTo.size > 0) {
                for (const f of filesModifiedUpTo) {
                    lines.push(`  M ${f}`);
                }
            }
            lines.push("");
            lines.push(`--- Reasoning up to this point ---`);
            for (const r of reasoning) {
                const excerpt = r.length > 200 ? r.slice(0, 200) + "..." : r;
                lines.push(excerpt);
                lines.push("");
            }
            lines.push(`--- Tool calls up to this point ---`);
            for (const tc of toolCalls) {
                lines.push(`  • ${tc}`);
            }
            lines.push("");
            // Generate a suggested prompt for branching
            lines.push(`=== Branch from here ===`);
            lines.push(`To try a different approach from this point, start a new Claude Code session with this context:`);
            lines.push("");
            lines.push(`"I previously worked on: ${session.prompt}`);
            lines.push(`The agent reached action ${at_action} and had modified: ${[...filesModifiedUpTo].join(", ") || "no files"}.`);
            lines.push(`Now I want to try a different approach from that point. Here's what was done so far: ${toolCalls.slice(0, 5).join(", ")}${toolCalls.length > 5 ? "..." : ""}`);
            lines.push(`Please take a different approach to: [describe your alternative here]"`);
            return {
                content: [{ type: "text", text: lines.join("\n") }],
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
//# sourceMappingURL=replay-tools.js.map