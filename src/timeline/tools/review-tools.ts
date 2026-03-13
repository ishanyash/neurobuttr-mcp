import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  timelineProjectHash,
  loadTimelineIndex,
  loadTimelineSession,
} from "../storage.js";
import type { TimelineSession, TimelineAction } from "../types.js";

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

function formatDuration(startMs: number, endMs: number): string {
  const secs = Math.round((endMs - startMs) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function formatAction(action: TimelineAction): string {
  const lines: string[] = [];
  const ts = formatTimestamp(action.timestamp);

  switch (action.type) {
    case "reasoning":
      lines.push(`[${action.index}] 💭 Reasoning (${ts})`);
      lines.push(
        action.reasoning.length > 300
          ? action.reasoning.slice(0, 300) + "..."
          : action.reasoning
      );
      break;

    case "tool_use":
      lines.push(`[${action.index}] 🔧 ${action.toolName} (${ts})`);
      // Show relevant input fields
      const input = action.toolInput;
      if (action.toolName === "Edit" || action.toolName === "Write") {
        lines.push(`  file: ${input.file_path || "unknown"}`);
      } else if (action.toolName === "Bash") {
        const cmd = String(input.command || "");
        lines.push(
          `  $ ${cmd.length > 100 ? cmd.slice(0, 100) + "..." : cmd}`
        );
      } else if (action.toolName === "Read") {
        lines.push(`  file: ${input.file_path || "unknown"}`);
      } else if (action.toolName === "Grep") {
        lines.push(`  pattern: ${input.pattern || "unknown"}`);
      } else if (action.toolName === "Glob") {
        lines.push(`  pattern: ${input.pattern || "unknown"}`);
      } else {
        const summary = JSON.stringify(input);
        lines.push(
          `  input: ${summary.length > 120 ? summary.slice(0, 120) + "..." : summary}`
        );
      }
      if (action.fileDiff) {
        lines.push(`  --- diff (${action.fileDiff.type}) ---`);
        lines.push(action.fileDiff.patch);
      }
      break;

    case "tool_result":
      lines.push(
        `[${action.index}] ${action.isError ? "❌" : "✅"} Result (${ts})`
      );
      if (action.toolOutput) {
        const output = action.toolOutput;
        lines.push(
          output.length > 200 ? output.slice(0, 200) + "..." : output
        );
      }
      break;
  }

  return lines.join("\n");
}

export function registerTimelineReviewTools(server: McpServer): void {
  // nb_timeline_list
  server.tool(
    "nb_timeline_list",
    `List captured Claude Code sessions for this project. Shows prompt, date, model, files changed, and status for each session.`,
    {
      cwd: z
        .string()
        .optional()
        .describe("Project directory (auto-detected if omitted)"),
      limit: z
        .number()
        .optional()
        .describe("Max sessions to show (default: 10)"),
      file_filter: z
        .string()
        .optional()
        .describe("Only show sessions that touched this file path"),
    },
    async ({ cwd, limit, file_filter }) => {
      try {
        const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
        const projHash = timelineProjectHash(projectPath);
        const index = await loadTimelineIndex(projHash);

        if (index.sessions.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: 'No captured sessions. Run nb_timeline_capture first.',
              },
            ],
          };
        }

        let sessions = index.sessions;

        // Apply file filter
        if (file_filter) {
          sessions = sessions.filter((s) =>
            s.filesModified.some((f) => f.includes(file_filter))
          );
        }

        // Apply limit
        const max = limit || 10;
        sessions = sessions.slice(0, max);

        const lines: string[] = [];
        lines.push(
          `${index.sessions.length} session(s) captured (showing ${sessions.length}):\n`
        );

        for (const s of sessions) {
          const date = formatTimestamp(s.startedAt);
          const prompt =
            s.prompt.length > 60 ? s.prompt.slice(0, 60) + "..." : s.prompt;
          const status = s.status === "rolled_back" ? " [ROLLED BACK]" : "";
          lines.push(
            `${s.id.slice(0, 8)}  ${date}  ${s.model}  ${s.filesModified.length} files  ${s.actionCount} actions${status}`
          );
          lines.push(`  "${prompt}"`);
          lines.push(`  branch: ${s.gitBranch}`);
          lines.push("");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // nb_timeline_show
  server.tool(
    "nb_timeline_show",
    `Show detailed information about a captured Claude Code session — the full action timeline with reasoning, tool calls, and file diffs.`,
    {
      session_id: z
        .string()
        .describe('Session ID (full UUID or first 8 chars)'),
      cwd: z
        .string()
        .optional()
        .describe("Project directory (auto-detected if omitted)"),
      action_range: z
        .string()
        .optional()
        .describe('Action range to show, e.g. "0-10" (default: all)'),
    },
    async ({ session_id, cwd, action_range }) => {
      try {
        const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
        const projHash = timelineProjectHash(projectPath);

        // Support short IDs
        const session = await resolveSession(projHash, session_id);
        if (!session) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Session "${session_id}" not found. Run nb_timeline_list to see available sessions.`,
              },
            ],
            isError: true,
          };
        }

        // Parse action range
        let startIdx = 0;
        let endIdx = session.actions.length;
        if (action_range) {
          const parts = action_range.split("-");
          startIdx = parseInt(parts[0], 10) || 0;
          endIdx = parts[1] ? parseInt(parts[1], 10) + 1 : endIdx;
        }

        const lines: string[] = [];
        lines.push(`Session: ${session.id}`);
        lines.push(`Prompt: "${session.prompt}"`);
        lines.push(`Model: ${session.model} (Claude Code ${session.claudeCodeVersion})`);
        lines.push(`Date: ${formatTimestamp(session.startedAt)}`);
        lines.push(
          `Duration: ${formatDuration(session.startedAt, session.completedAt)}`
        );
        lines.push(`Status: ${session.status}`);
        lines.push(`Git branch: ${session.gitBranch}`);
        lines.push(`Files read: ${session.filesRead.length}`);
        lines.push(`Files modified: ${session.filesModified.length}`);
        if (session.filesModified.length > 0) {
          for (const f of session.filesModified) {
            lines.push(`  M ${f}`);
          }
        }
        if (session.tags.length > 0) {
          lines.push(`Tags: ${session.tags.join(", ")}`);
        }
        if (session.notes) {
          lines.push(`Notes: ${session.notes}`);
        }
        lines.push("");
        lines.push(
          `--- Actions ${startIdx}-${Math.min(endIdx - 1, session.actions.length - 1)} of ${session.actions.length} ---`
        );
        lines.push("");

        const actionsSlice = session.actions.slice(startIdx, endIdx);
        for (const action of actionsSlice) {
          lines.push(formatAction(action));
          lines.push("");
        }

        // Show subagents if any
        if (session.subagentSessions.length > 0) {
          lines.push(`--- Subagent Sessions (${session.subagentSessions.length}) ---`);
          for (const sub of session.subagentSessions) {
            const subPrompt =
              sub.prompt.length > 60
                ? sub.prompt.slice(0, 60) + "..."
                : sub.prompt;
            lines.push(
              `  ${sub.id.slice(0, 8)}: "${subPrompt}" (${sub.actions.length} actions)`
            );
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // nb_timeline_diff
  server.tool(
    "nb_timeline_diff",
    `Show all file changes in a captured session as unified diffs. Like viewing a PR diff — see exactly what the agent changed.`,
    {
      session_id: z
        .string()
        .describe('Session ID (full UUID or first 8 chars)'),
      cwd: z
        .string()
        .optional()
        .describe("Project directory (auto-detected if omitted)"),
      file_filter: z
        .string()
        .optional()
        .describe("Only show diffs for files matching this path"),
    },
    async ({ session_id, cwd, file_filter }) => {
      try {
        const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
        const projHash = timelineProjectHash(projectPath);

        const session = await resolveSession(projHash, session_id);
        if (!session) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Session "${session_id}" not found.`,
              },
            ],
            isError: true,
          };
        }

        // Collect all file diffs
        const diffs: Array<{ path: string; type: string; patch: string }> = [];
        for (const action of session.actions) {
          if (action.type === "tool_use" && action.fileDiff) {
            if (file_filter && !action.fileDiff.path.includes(file_filter)) {
              continue;
            }
            diffs.push(action.fileDiff);
          }
        }

        if (diffs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: file_filter
                  ? `No diffs found for files matching "${file_filter}" in session ${session_id.slice(0, 8)}.`
                  : `No file diffs captured in session ${session_id.slice(0, 8)}.`,
              },
            ],
          };
        }

        // Group by file path
        const byFile = new Map<string, string[]>();
        for (const diff of diffs) {
          const existing = byFile.get(diff.path) || [];
          existing.push(diff.patch);
          byFile.set(diff.path, existing);
        }

        const lines: string[] = [];
        lines.push(
          `Session ${session_id.slice(0, 8)} — ${byFile.size} file(s) changed:\n`
        );

        for (const [path, patches] of byFile) {
          lines.push(`═══ ${path} (${patches.length} edit(s)) ═══`);
          for (const patch of patches) {
            lines.push(patch);
            lines.push("");
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Resolve a session ID (supports short IDs by prefix matching).
 */
async function resolveSession(
  projectHash: string,
  sessionId: string
): Promise<TimelineSession | null> {
  // Try exact match first
  const exact = await loadTimelineSession(projectHash, sessionId);
  if (exact) return exact;

  // Try prefix match
  const index = await loadTimelineIndex(projectHash);
  const match = index.sessions.find((s) => s.id.startsWith(sessionId));
  if (match) {
    return loadTimelineSession(projectHash, match.id);
  }

  return null;
}
