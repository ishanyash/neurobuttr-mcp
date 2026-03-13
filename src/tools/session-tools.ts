import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolveSession,
  listBranches,
  getStatus,
} from "../core/session-manager.js";

export function registerSessionTools(server: McpServer): void {
  // nb_log — like `git log --graph`
  server.tool(
    "nb_log",
    `Show all conversation branches with their status, topic, and message count (like "git log --oneline --graph"). Use this to see the conversation structure at a glance.`,
    {
      cwd: z
        .string()
        .optional()
        .describe("Project directory (auto-detected from environment if omitted)"),
    },
    async ({ cwd }) => {
      try {
        const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
        const session = await resolveSession(projectPath);
        const branches = await listBranches(session.id);
        const status = await getStatus(session.id);

        if (branches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `On branch: main\n${status.mainMessages} messages, 0 branches\n\nNo branches yet. Use nb_branch to explore a tangent.`,
              },
            ],
          };
        }

        const lines: string[] = [];
        lines.push(`On branch: ${status.currentBranch}`);
        lines.push(`${status.mainMessages} main messages | ${status.totalBranches} branches (${status.activeBranches} active, ${status.resolvedBranches} resolved) | ${status.insights} insights`);
        lines.push("");

        for (const b of branches) {
          const current = b.isCurrent ? "* " : "  ";
          const resolved = b.resolved ? " [resolved]" : "";
          const topic = b.topic !== "General" ? ` [${b.topic}]` : "";
          lines.push(`${current}${b.name} — "${b.anchorContext}" (${b.messageCount} msgs${resolved})${topic}`);
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

  // nb_status — like `git status`
  server.tool(
    "nb_status",
    `Show the current conversation state (like "git status"). Shows which branch you're on, message counts, and active branches.`,
    {
      cwd: z
        .string()
        .optional()
        .describe("Project directory (auto-detected from environment if omitted)"),
    },
    async ({ cwd }) => {
      try {
        const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
        const session = await resolveSession(projectPath);
        const status = await getStatus(session.id);

        const lines: string[] = [];
        lines.push(`On branch: ${status.currentBranch}`);
        lines.push(`Main thread: ${status.mainMessages} messages`);
        lines.push(`Branches: ${status.totalBranches} total (${status.activeBranches} active, ${status.resolvedBranches} resolved)`);
        lines.push(`Insights: ${status.insights}`);

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
