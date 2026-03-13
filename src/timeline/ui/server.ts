import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { watch } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  loadTimelineIndex,
  loadTimelineSession,
  timelineProjectHash,
  getCapturedIds,
  saveTimelineSession,
  addToIndex,
  sessionToIndexEntry,
} from "../storage.js";
import {
  claudeProjectHash,
  findSessionFiles,
  filterUncaptured,
  parseJSONLFile,
} from "../parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SSEClient {
  res: ServerResponse;
}

export async function startTimelineServer(
  projectPath: string,
  port: number = 3100
): Promise<void> {
  const projHash = timelineProjectHash(projectPath);
  const sessionsDir = join(
    homedir(),
    ".neurobuttr",
    "timeline",
    projHash,
    "sessions"
  );

  // Ensure sessions directory exists
  await mkdir(sessionsDir, { recursive: true });

  // Auto-capture before starting
  await autoCapture(projectPath, projHash);

  // SSE clients
  const sseClients: SSEClient[] = [];

  // Watch for new session files (debounced)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    watch(sessionsDir, { persistent: false }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        for (const client of sseClients) {
          client.res.write(
            `event: session-update\ndata: ${JSON.stringify({ type: "update" })}\n\n`
          );
        }
      }, 500);
    });
  } catch {
    // fs.watch not available, SSE won't fire but server still works
  }

  const htmlPath = join(__dirname, "index.html");

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    try {
      // Serve index.html
      if (pathname === "/") {
        const html = await readFile(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      // API: session list
      if (pathname === "/api/sessions") {
        const index = await loadTimelineIndex(projHash);
        const response = {
          projectPath,
          sessions: index.sessions,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
        return;
      }

      // API: session detail
      const sessionMatch = pathname.match(/^\/api\/sessions\/(.+)$/);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        const session = await loadTimelineSession(projHash, sessionId);
        if (!session) {
          // Try prefix match
          const index = await loadTimelineIndex(projHash);
          const match = index.sessions.find((s) => s.id.startsWith(sessionId));
          if (match) {
            const fullSession = await loadTimelineSession(projHash, match.id);
            if (fullSession) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(fullSession));
              return;
            }
          }
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(session));
        return;
      }

      // SSE: live updates
      if (pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(":\n\n"); // SSE comment to establish connection
        const client: SSEClient = { res };
        sseClients.push(client);
        req.on("close", () => {
          const idx = sseClients.indexOf(client);
          if (idx >= 0) sseClients.splice(idx, 1);
        });
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : "Internal server error",
        })
      );
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Try: npx neurobuttr-mcp ui --port ${port + 100}`
      );
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Timeline UI running at http://localhost:${port} — Ctrl+C to stop`);
  });
}

async function autoCapture(
  projectPath: string,
  projHash: string
): Promise<void> {
  try {
    const claudeHash = claudeProjectHash(projectPath);
    const allFiles = await findSessionFiles(claudeHash);
    if (allFiles.length === 0) return;

    const capturedIds = await getCapturedIds(projHash);
    const uncaptured = filterUncaptured(allFiles, capturedIds);
    if (uncaptured.length === 0) return;

    let count = 0;
    for (const filePath of uncaptured) {
      const session = await parseJSONLFile(filePath, projectPath, projHash);
      if (session) {
        await saveTimelineSession(session);
        await addToIndex(projHash, sessionToIndexEntry(session));
        count++;
      }
    }
    if (count > 0) {
      console.log(`Auto-captured ${count} new session(s)`);
    }
  } catch {
    // Non-fatal — UI can still show previously captured sessions
  }
}
