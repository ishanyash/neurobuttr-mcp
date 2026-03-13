import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { Session } from "../core/types.js";
import type { BridgeAction, UIAction, BridgeMessage } from "./protocol.js";
import {
  resolveSession,
  createBranch,
  checkoutBranch,
  resolveBranch,
  addMessage,
  rememberInsight,
} from "../core/session-manager.js";
import { saveSession } from "../core/storage.js";
import { importSessionHistory } from "./import-history.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function startBridgeServer(
  projectPath: string,
  port: number = 3200
): Promise<void> {
  // Load initial session state
  let session = await resolveSession(projectPath);

  // Import past conversation history from Claude Code logs
  const imported = await importSessionHistory(session);
  if (imported > 0) {
    console.log(`Imported ${imported} actions from Claude Code session logs`);
    session = await resolveSession(projectPath); // reload after import
  }

  const clients = new Set<WebSocket>();

  function broadcast(msg: BridgeMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  async function refreshSession(): Promise<void> {
    session = await resolveSession(projectPath);
  }

  async function handleBridgeAction(action: BridgeAction): Promise<void> {
    // MCP tool already performed the mutation and saved.
    // We just need to refresh our in-memory state and broadcast.
    await refreshSession();
    broadcast({ type: "patch", action: action.action, data: action.data as Record<string, unknown> });
  }

  async function handleUIAction(action: UIAction): Promise<void> {
    switch (action.action) {
      case "create_branch": {
        await createBranch(session.id, action.data.topic);
        break;
      }
      case "checkout": {
        await checkoutBranch(session.id, action.data.branchId || "main");
        break;
      }
      case "resolve": {
        await resolveBranch(session.id, action.data.branchId);
        break;
      }
      case "merge_insights": {
        await resolveBranch(session.id, action.data.branchId, true);
        break;
      }
    }
    await refreshSession();
    broadcast({ type: "state", session });
  }

  // HTTP server for serving the UI
  const htmlPath = join(__dirname, "ui", "index.html");

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const pathname = new URL(req.url || "/", `http://localhost:${port}`).pathname;

    if (pathname === "/") {
      try {
        const html = await readFile(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Failed to load UI");
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  // WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);

    // Send full state on connect
    ws.send(JSON.stringify({ type: "state", session } satisfies BridgeMessage));

    ws.on("message", async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Determine message type
        if ("type" in msg && msg.type === "bridge_action") {
          await handleBridgeAction(msg.payload as BridgeAction);
        } else if ("action" in msg && msg.action === "request_state") {
          // Browser requesting full state refresh
          await refreshSession();
          ws.send(JSON.stringify({ type: "state", session } satisfies BridgeMessage));
        } else if ("action" in msg) {
          await handleUIAction(msg as UIAction);
        }
      } catch (err) {
        console.error("Bridge message error:", err);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Try: npx neurobuttr-mcp map --port ${port + 100}`
      );
      process.exit(1);
    }
    throw err;
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`Metro Map running at http://localhost:${port} — Ctrl+C to stop`);
  });
}
