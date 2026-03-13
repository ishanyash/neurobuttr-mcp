import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadSession } from "../core/storage.js";
import { resolveSession, getInsights } from "../core/session-manager.js";
import { buildGraph } from "../map/graph-builder.js";
import { renderMap } from "../map/map-renderer.js";

export function registerMapTools(server: McpServer): void {
  server.tool(
    "nb_map",
    `Generate a visual relationship map of the conversation. By default writes a Mermaid diagram to .neurobuttr/map.mmd that can be previewed in VS Code with the Mermaid Preview extension. Also returns an ASCII summary in the response.`,
    {
      format: z
        .enum(["mermaid", "ascii", "json"])
        .optional()
        .default("mermaid")
        .describe(
          "Output format: 'mermaid' (writes .mmd file for VS Code preview, default), 'ascii' (text tree), or 'json' (structured data)"
        ),
      cwd: z
        .string()
        .optional()
        .describe("Project directory (auto-detected from environment if omitted)"),
    },
    async ({ format, cwd }) => {
      try {
        const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
        const session = await resolveSession(projectPath);
        const fullSession = await loadSession(session.id);

        if (!fullSession || (fullSession.messages.length === 0 && fullSession.branches.length === 0)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No conversation data yet. Start a conversation and create branches to see the map.",
              },
            ],
          };
        }

        const graph = buildGraph(fullSession);
        const insights = await getInsights(session.id);
        const insightData = insights.map((i) => ({
          content: i.content,
          sourceBranch: i.sourceBranch,
        }));

        if (format === "mermaid") {
          // Write .mmd file for VS Code Mermaid Preview
          const mermaidContent = renderMap(graph, "mermaid", insightData);
          const neurobuttrDir = join(projectPath, ".neurobuttr");
          await mkdir(neurobuttrDir, { recursive: true });
          const mmdPath = join(neurobuttrDir, "map.mmd");
          await writeFile(mmdPath, mermaidContent);

          // Also generate ASCII for inline display
          const asciiContent = renderMap(graph, "ascii", insightData);

          return {
            content: [
              {
                type: "text" as const,
                text: `Conversation map written to .neurobuttr/map.mmd\nOpen it in VS Code with the Mermaid Preview extension to see the diagram.\n\n${asciiContent}`,
              },
            ],
          };
        }

        const rendered = renderMap(graph, format, insightData);
        return {
          content: [{ type: "text" as const, text: rendered }],
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
