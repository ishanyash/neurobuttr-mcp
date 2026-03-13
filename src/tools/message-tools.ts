import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolveSession,
  addMessage,
  rememberInsight,
  getInsights,
} from "../core/session-manager.js";

export function registerMessageTools(server: McpServer): void {
  // nb_add — add a message to the current branch or main thread
  server.tool(
    "add_message",
    "Add a message to the current branch or main thread. Used internally to track conversation history.",
    {
      role: z.enum(["user", "assistant"]).describe("Message role"),
      content: z.string().describe("Message content"),
      branch: z
        .string()
        .optional()
        .describe("Branch name (defaults to current branch, or main if no branch checked out)"),
      action_type: z
        .enum(["prompt", "edit", "bash", "search", "read", "decision", "insight", "agent", "other"])
        .optional()
        .describe("Type of action this message represents"),
      cwd: z
        .string()
        .optional()
        .describe("Project directory (auto-detected from environment if omitted)"),
    },
    async ({ role, content, branch, action_type, cwd }) => {
      try {
        const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
        const session = await resolveSession(projectPath);
        const targetBranch = branch || (session.currentBranchId ? session.currentBranchId : undefined);
        const result = await addMessage(session.id, role, content, targetBranch, action_type);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                messageId: result.messageId,
                target: targetBranch ? `branch` : "main",
              }),
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

  // nb_remember — save an insight from exploration back to main
  server.tool(
    "remember_insight",
    `Save a key finding or insight from a branch exploration back to the main thread. Like "git stash" but for knowledge — insights persist and are visible from any branch. Use this when you discover something valuable during a side exploration.`,
    {
      insight: z.string().describe("The insight or finding to remember"),
      branch: z
        .string()
        .optional()
        .describe("Source branch (defaults to current branch)"),
      cwd: z
        .string()
        .optional()
        .describe("Project directory (auto-detected from environment if omitted)"),
    },
    async ({ insight, branch, cwd }) => {
      try {
        const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
        const session = await resolveSession(projectPath);
        const result = await rememberInsight(session.id, branch, insight);
        return {
          content: [
            {
              type: "text" as const,
              text: `Insight remembered. Available from any branch or the main thread.`,
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

  // nb_insights — list all saved insights
  server.tool(
    "get_insights",
    "List all remembered insights across all branches. Shows what was discovered during explorations.",
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
        const insights = await getInsights(session.id);
        if (insights.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No insights saved yet. Use remember_insight to save findings from branches." },
            ],
          };
        }
        const formatted = insights
          .map((i, idx) => `${idx + 1}. "${i.content}" (from branch: ${i.sourceBranch})`)
          .join("\n");
        return {
          content: [
            { type: "text" as const, text: `Insights:\n${formatted}` },
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
