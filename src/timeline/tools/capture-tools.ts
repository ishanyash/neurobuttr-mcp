import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  claudeProjectHash,
  findSessionFiles,
  filterUncaptured,
  parseJSONLFile,
} from "../parser.js";
import {
  timelineProjectHash,
  getCapturedIds,
  saveTimelineSession,
  addToIndex,
  sessionToIndexEntry,
} from "../storage.js";

export function registerTimelineCaptureTools(server: McpServer): void {
  server.tool(
    "nb_timeline_capture",
    `Parse Claude Code session logs and capture them as structured timeline records. Run this after a Claude Code session to record what the agent did — prompts, tool calls, reasoning, and file diffs. Use all=true to capture all uncaptured sessions.`,
    {
      cwd: z
        .string()
        .optional()
        .describe("Project directory (auto-detected if omitted)"),
      all: z
        .boolean()
        .optional()
        .describe("Capture all uncaptured sessions (default: latest only)"),
    },
    async ({ cwd, all }) => {
      try {
        const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
        const claudeHash = claudeProjectHash(projectPath);
        const projHash = timelineProjectHash(projectPath);

        // Find JSONL files
        const allFiles = await findSessionFiles(claudeHash);
        if (allFiles.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No Claude Code session logs found for this project.",
              },
            ],
          };
        }

        // Filter to uncaptured
        const capturedIds = await getCapturedIds(projHash);
        let uncaptured = filterUncaptured(allFiles, capturedIds);

        if (uncaptured.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `All ${allFiles.length} sessions already captured. Nothing new to capture.`,
              },
            ],
          };
        }

        // If not capturing all, only take the latest (by file modification time)
        if (!all) {
          uncaptured = [uncaptured[uncaptured.length - 1]];
        }

        // Parse and save each session
        const captured: Array<{ id: string; prompt: string; files: number }> = [];
        const skipped: string[] = [];

        for (const filePath of uncaptured) {
          const session = await parseJSONLFile(
            filePath,
            projectPath,
            projHash
          );
          if (session) {
            await saveTimelineSession(session);
            await addToIndex(projHash, sessionToIndexEntry(session));
            captured.push({
              id: session.id,
              prompt:
                session.prompt.length > 80
                  ? session.prompt.slice(0, 80) + "..."
                  : session.prompt,
              files: session.filesModified.length,
            });
          } else {
            skipped.push(filePath);
          }
        }

        const lines: string[] = [];
        lines.push(`Captured ${captured.length} session(s):`);
        for (const s of captured) {
          lines.push(`  • [${s.id.slice(0, 8)}] "${s.prompt}" (${s.files} files modified)`);
        }
        if (skipped.length > 0) {
          lines.push(`Skipped ${skipped.length} (empty, active, or unparseable)`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error capturing sessions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
