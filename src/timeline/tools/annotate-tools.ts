import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  timelineProjectHash,
  loadTimelineIndex,
  loadTimelineSession,
  saveTimelineSession,
  updateIndexEntry,
} from "../storage.js";

export function registerTimelineAnnotateTools(server: McpServer): void {
  server.tool(
    "nb_timeline_annotate",
    `Add tags or notes to a captured timeline session. Tags are appended to existing tags. Notes replace the existing note.`,
    {
      session_id: z
        .string()
        .describe('Session ID (full UUID or first 8 chars)'),
      cwd: z
        .string()
        .optional()
        .describe("Project directory (auto-detected if omitted)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags to add to the session"),
      note: z
        .string()
        .optional()
        .describe("Note to set on the session (replaces existing)"),
    },
    async ({ session_id, cwd, tags, note }) => {
      try {
        const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
        const projHash = timelineProjectHash(projectPath);

        // Resolve session ID (support short IDs)
        const index = await loadTimelineIndex(projHash);
        const match = index.sessions.find(
          (s) => s.id === session_id || s.id.startsWith(session_id)
        );
        if (!match) {
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

        const session = await loadTimelineSession(projHash, match.id);
        if (!session) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Session file not found for "${match.id}".`,
              },
            ],
            isError: true,
          };
        }

        // Apply changes
        if (tags && tags.length > 0) {
          const newTags = tags.filter((t) => !session.tags.includes(t));
          session.tags.push(...newTags);
        }
        if (note !== undefined) {
          session.notes = note;
        }

        await saveTimelineSession(session);

        const lines: string[] = [];
        lines.push(`Updated session ${match.id.slice(0, 8)}:`);
        if (session.tags.length > 0) {
          lines.push(`  Tags: ${session.tags.join(", ")}`);
        }
        if (session.notes) {
          lines.push(`  Notes: ${session.notes}`);
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
