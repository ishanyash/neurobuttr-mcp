import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import {
  timelineProjectHash,
  loadTimelineIndex,
  loadTimelineSession,
  saveTimelineSession,
  updateIndexEntry,
} from "../storage.js";

function execGit(command: string, cwd: string): string {
  return execSync(`git ${command}`, { cwd, encoding: "utf-8" }).trim();
}

export function registerTimelineRollbackTools(server: McpServer): void {
  server.tool(
    "nb_timeline_rollback",
    `Revert all changes from a captured Claude Code session. Creates a git revert commit if the session's changes were committed, or reverse-applies diffs for uncommitted changes. Requires a clean working tree.`,
    {
      session_id: z
        .string()
        .describe('Session ID (full UUID or first 8 chars)'),
      cwd: z
        .string()
        .optional()
        .describe("Project directory (auto-detected if omitted)"),
    },
    async ({ session_id, cwd }) => {
      try {
        const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
        const projHash = timelineProjectHash(projectPath);

        // Resolve session
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

        if (session.status === "rolled_back") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Session ${match.id.slice(0, 8)} is already rolled back.`,
              },
            ],
          };
        }

        // Check preconditions
        const gitStatus = execGit("status --porcelain", projectPath);
        if (gitStatus.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Cannot rollback: working tree is not clean. Commit or stash your changes first.\n\nDirty files:\n${gitStatus}`,
              },
            ],
            isError: true,
          };
        }

        // Strategy 1: Git revert if we have a commit
        if (session.gitCommitAfter) {
          try {
            // Check if commit is reachable
            execGit(
              `merge-base --is-ancestor ${session.gitCommitAfter} HEAD`,
              projectPath
            );

            // Create revert commit
            execGit(
              `revert --no-edit ${session.gitCommitAfter}`,
              projectPath
            );

            session.status = "rolled_back";
            await saveTimelineSession(session);
            await updateIndexEntry(projHash, session.id, {
              status: "rolled_back",
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Rolled back session ${match.id.slice(0, 8)} by reverting commit ${session.gitCommitAfter.slice(0, 8)}.\n\nReverted files:\n${session.filesModified.map((f) => `  R ${f}`).join("\n")}`,
                },
              ],
            };
          } catch {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Cannot rollback: commit ${session.gitCommitAfter.slice(0, 8)} is not in the current branch history (may have been rebased or amended).`,
                },
              ],
              isError: true,
            };
          }
        }

        // Strategy 2: Reverse-apply diffs for uncommitted changes
        const diffs: string[] = [];
        for (const action of session.actions) {
          if (action.type === "tool_use" && action.fileDiff) {
            diffs.push(action.fileDiff.patch);
          }
        }

        if (diffs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Session ${match.id.slice(0, 8)} has no captured file diffs to rollback.`,
              },
            ],
            isError: true,
          };
        }

        // Dry run first
        const patchContent = diffs.join("\n");
        try {
          execSync("git apply --reverse --check -", {
            cwd: projectPath,
            input: patchContent,
            encoding: "utf-8",
          });
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: `Cannot rollback: files have been modified since this session. The diffs no longer apply cleanly.\n\nAffected files:\n${session.filesModified.map((f) => `  ${f}`).join("\n")}\n\nConsider manual resolution.`,
              },
            ],
            isError: true,
          };
        }

        // Apply the reverse patch
        execSync("git apply --reverse -", {
          cwd: projectPath,
          input: patchContent,
          encoding: "utf-8",
        });

        session.status = "rolled_back";
        await saveTimelineSession(session);
        await updateIndexEntry(projHash, session.id, {
          status: "rolled_back",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Rolled back session ${match.id.slice(0, 8)} by reversing ${diffs.length} file diff(s).\n\nReverted files:\n${session.filesModified.map((f) => `  R ${f}`).join("\n")}\n\nNote: changes are unstaged. Review with git diff and commit when ready.`,
            },
          ],
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
