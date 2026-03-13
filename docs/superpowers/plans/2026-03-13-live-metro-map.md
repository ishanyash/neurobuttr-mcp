# Live Metro Map Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live, interactive metro-map UI with WebSocket bridge for real-time two-way sync between Claude Code conversations and a browser-based SVG visualization.

**Architecture:** A WebSocket bridge server holds session state in memory and syncs between MCP tools and a browser-based metro map. MCP tools connect as WS clients (falling back to file I/O when bridge isn't running). The browser renders an interactive SVG metro map with zoom/pan, branch creation, checkout, resolve, and insight merge.

**Tech Stack:** Node.js `node:http`, `ws` (WebSocket lib), vanilla HTML/CSS/JS, inline SVG. One new dependency.

**Spec:** `docs/superpowers/specs/2026-03-13-live-metro-map-design.md`

---

## Chunk 1: Type System + Merge Logic

### Task 1: Add `ActionType` and `merged` to type system

**Files:**
- Modify: `src/core/types.ts:1-38`

- [ ] **Step 1: Add `ActionType` type and update `Message` and `Insight` interfaces**

Add to the top of `src/core/types.ts`:

```typescript
export type ActionType =
  | "prompt"
  | "edit"
  | "bash"
  | "search"
  | "read"
  | "decision"
  | "insight"
  | "agent"
  | "other";
```

Add `actionType` to the `Message` interface:

```typescript
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  actionType?: ActionType;
}
```

Add `merged` to the `Insight` interface:

```typescript
export interface Insight {
  id: string;
  content: string;
  sourceBranchId: string;
  timestamp: number;
  merged: boolean;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: Exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat: add ActionType and merged field to type system"
```

---

### Task 2: Add load-time migration in storage

**Files:**
- Modify: `src/core/storage.ts:30-37`

- [ ] **Step 1: Update `loadSession` to default `merged: false` on insights**

In `src/core/storage.ts`, modify the `loadSession` function. After parsing the JSON, add migration logic before returning:

```typescript
export async function loadSession(id: string): Promise<Session | null> {
  try {
    const data = await readFile(sessionPath(id), "utf-8");
    const session = JSON.parse(data) as Session;
    // Migrate: default merged to false for existing insights
    if (session.insights) {
      for (const insight of session.insights) {
        if (insight.merged === undefined) {
          insight.merged = false;
        }
      }
    }
    return session;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: Exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/storage.ts
git commit -m "feat: add load-time migration for insight.merged field"
```

---

### Task 3: Add `actionType` parameter to `addMessage`

**Files:**
- Modify: `src/core/session-manager.ts:80-109`
- Modify: `src/tools/message-tools.ts:12-56`

- [ ] **Step 1: Update `addMessage` in session-manager.ts**

Change the function signature at line 80 to accept an optional `actionType` parameter:

```typescript
export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  branchId?: string,
  actionType?: ActionType
): Promise<{ messageId: string; branchName?: string }> {
```

Add the import for `ActionType` at line 1:

```typescript
import type { Session, Branch, Message, Insight, ActionType } from "./types.js";
```

Where the message object is created inside `addMessage` (the line that constructs `const message: Message = { ... }`), add the `actionType` field:

```typescript
const message: Message = {
  id: generateId(),
  role,
  content,
  timestamp: now(),
  ...(actionType ? { actionType } : {}),
};
```

- [ ] **Step 2: Update `add_message` MCP tool to pass `actionType`**

In `src/tools/message-tools.ts`, add `actionType` to the tool's zod schema (inside `registerMessageTools`, the `add_message` tool definition):

```typescript
action_type: z
  .enum(["prompt", "edit", "bash", "search", "read", "decision", "insight", "agent", "other"])
  .optional()
  .describe("Type of action this message represents"),
```

And pass it through in the handler:

```typescript
const result = await addMessage(session.id, role, content, branchId, action_type);
```

Update the import to include `ActionType`:

```typescript
import {
  resolveSession,
  addMessage,
  rememberInsight,
  getInsights,
} from "../core/session-manager.js";
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: Exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/session-manager.ts src/tools/message-tools.ts
git commit -m "feat: add actionType parameter to addMessage for station rendering"
```

---

### Task 4: Add merge logic to `resolveBranch`

**Files:**
- Modify: `src/core/session-manager.ts:196-216`
- Modify: `src/tools/branch-tools.ts:116-154`

- [ ] **Step 1: Update `resolveBranch` in session-manager.ts to accept merge option**

Replace the existing `resolveBranch` function (lines 196-216) with:

```typescript
export async function resolveBranch(
  sessionId: string,
  branchId?: string,
  merge: boolean = false
): Promise<{ resolved: string; merged: boolean; insightCount: number }> {
  const session = await loadSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const targetId = branchId || session.currentBranchId;
  if (!targetId) {
    throw new Error("No branch to resolve (on main thread)");
  }

  const branch = findBranch(session, targetId);
  if (!branch) {
    throw new Error(`Branch not found: ${targetId}`);
  }

  if (branch.resolved) {
    throw new Error(`Branch "${branch.name}" is already resolved`);
  }

  let insightCount = 0;

  if (merge) {
    // Find and tag insights from this branch
    const branchInsights = session.insights.filter(
      (i) => i.sourceBranchId === branch.id
    );
    insightCount = branchInsights.length;

    for (const insight of branchInsights) {
      insight.merged = true;
    }

    // Append merge summary to main thread if there are insights
    if (insightCount > 0) {
      const summaryParts = branchInsights.map((i) =>
        i.content.length > 100 ? i.content.slice(0, 100) + "..." : i.content
      );
      const summaryMsg: Message = {
        id: generateId(),
        role: "assistant",
        content: `Merged from "${branch.name}": ${summaryParts.join("; ")}`,
        timestamp: now(),
        actionType: "decision",
      };
      session.messages.push(summaryMsg);
    }
  }

  branch.resolved = true;

  // Switch back to main
  if (session.currentBranchId === branch.id) {
    session.currentBranchId = undefined;
  }

  session.updatedAt = now();
  await saveSession(session);

  return { resolved: branch.name, merged: merge, insightCount };
}
```

Add `Message` to the type import if not already there.

- [ ] **Step 2: Update `nb_resolve` MCP tool to add `merge` parameter**

In `src/tools/branch-tools.ts`, update the `nb_resolve` tool's zod schema (around line 118) to add the `merge` param:

```typescript
{
  branch: z
    .string()
    .optional()
    .describe("Branch name or ID to resolve (default: current branch)"),
  merge: z
    .boolean()
    .optional()
    .describe("Merge insights to main before resolving (default: false)"),
  cwd: z
    .string()
    .optional()
    .describe("Project directory (auto-detected if omitted)"),
}
```

Update the handler to pass `merge` through and update the response message:

```typescript
async ({ branch, merge, cwd }) => {
  try {
    const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
    const session = await resolveSession(projectPath);
    const result = await resolveBranch(session.id, branch, merge || false);

    let msg = `Resolved branch "${result.resolved}".`;
    if (result.merged) {
      msg += ` Merged ${result.insightCount} insight(s) to main.`;
    }
    msg += " Switched back to main.";

    return {
      content: [{ type: "text" as const, text: msg }],
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
```

Update the import to include `resolveBranch`:

```typescript
import {
  resolveSession,
  createBranch,
  checkoutBranch,
  resolveBranch,
  getBranchContext,
} from "../core/session-manager.js";
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: Exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/session-manager.ts src/tools/branch-tools.ts
git commit -m "feat: add insight merge on branch resolve"
```

---

## Chunk 2: Bridge Server + Protocol

### Task 5: Install `ws` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install ws and its types**

Run: `npm install ws && npm install --save-dev @types/ws`

- [ ] **Step 2: Verify it installed**

Run: `npm ls ws`
Expected: Shows `ws@X.X.X`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add ws (WebSocket library) for bridge server"
```

---

### Task 6: Create bridge protocol types

**Files:**
- Create: `src/bridge/protocol.ts`

- [ ] **Step 0: Create directories**

Run: `mkdir -p src/bridge/ui`

- [ ] **Step 1: Create `src/bridge/protocol.ts`**

```typescript
import type { Session, ActionType } from "../core/types.js";

// MCP tools → Bridge
export type BridgeAction =
  | {
      action: "branch_created";
      data: {
        branchId: string;
        branchName: string;
        parentMessageId: string;
        parentBranchId?: string;
        topic: string;
      };
    }
  | { action: "checkout"; data: { branchId?: string } }
  | {
      action: "message_added";
      data: {
        messageId: string;
        branchId?: string;
        role: "user" | "assistant";
        content: string;
        actionType?: ActionType;
      };
    }
  | { action: "branch_resolved"; data: { branchId: string; merge: boolean } }
  | {
      action: "insight_saved";
      data: { insightId: string; content: string; sourceBranchId: string };
    }
;

// Browser → Bridge
export type UIAction =
  | { action: "create_branch"; data: { topic: string } }
  | { action: "checkout"; data: { branchId?: string } }
  | { action: "resolve"; data: { branchId: string } }
  | { action: "merge_insights"; data: { branchId: string } };

// Bridge → All Clients
export type BridgeMessage =
  | { type: "state"; session: Session }
  | { type: "patch"; action: string; data: Record<string, unknown> };
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: Exit 0, `dist/bridge/protocol.js` exists.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/protocol.ts
git commit -m "feat: add bridge protocol types"
```

---

### Task 7: Create bridge server

**Files:**
- Create: `src/bridge/server.ts`

- [ ] **Step 1: Create `src/bridge/server.ts`**

```typescript
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

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function startBridgeServer(
  projectPath: string,
  port: number = 3200
): Promise<void> {
  // Load initial session state
  let session = await resolveSession(projectPath);
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: Exit 0, `dist/bridge/server.js` exists.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/server.ts
git commit -m "feat: add bridge server with HTTP + WebSocket hub"
```

---

### Task 8: Create bridge client for MCP tools

**Files:**
- Create: `src/bridge/bridge-client.ts`

- [ ] **Step 1: Create `src/bridge/bridge-client.ts`**

```typescript
import WebSocket from "ws";
import type { BridgeAction } from "./protocol.js";

const DEFAULT_PORT = 3200;
let connection: WebSocket | null = null;
let connected = false;

function getPort(): number {
  const envPort = process.env.NEUROBUTTR_BRIDGE_PORT;
  return envPort ? parseInt(envPort, 10) : DEFAULT_PORT;
}

function ensureConnection(): WebSocket | null {
  if (connection && connected) {
    return connection;
  }

  // Clean up stale connection
  if (connection) {
    try {
      connection.close();
    } catch {
      // ignore
    }
    connection = null;
    connected = false;
  }

  try {
    const port = getPort();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    // Set a short timeout for connection
    const timeout = setTimeout(() => {
      if (!connected) {
        ws.close();
        connection = null;
      }
    }, 500);

    ws.on("open", () => {
      connected = true;
      clearTimeout(timeout);
    });

    ws.on("close", () => {
      connected = false;
      connection = null;
    });

    ws.on("error", () => {
      connected = false;
      connection = null;
    });

    connection = ws;
    return null; // Not connected yet on first call
  } catch {
    return null;
  }
}

/**
 * Notify the bridge of a session mutation.
 * Non-blocking, fire-and-forget. If bridge isn't running, silently no-ops.
 */
export function notifyBridge(action: BridgeAction): void {
  const ws = ensureConnection();
  if (ws && connected) {
    try {
      ws.send(JSON.stringify({ type: "bridge_action", payload: action }));
    } catch {
      // Bridge unavailable, continue with file I/O
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: Exit 0, `dist/bridge/bridge-client.js` exists.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/bridge-client.ts
git commit -m "feat: add bridge client for MCP tool notifications"
```

---

### Task 9: Wire bridge notifications into session manager

**Files:**
- Modify: `src/core/session-manager.ts`

- [ ] **Step 1: Add bridge notifications to key session-manager functions**

Add the import at the top of `src/core/session-manager.ts`:

```typescript
import { notifyBridge } from "../bridge/bridge-client.js";
```

Add notification calls at the end of each mutating function, right before the return statement:

In `addMessage` (after `await saveSession(session)`):
```typescript
notifyBridge({
  action: "message_added",
  data: {
    messageId: message.id,
    branchId: branchId,
    role,
    content,
    actionType,
  },
});
```

In `createBranch` (after `await saveSession(session)`):
```typescript
notifyBridge({
  action: "branch_created",
  data: {
    branchId: branch.id,
    branchName: branch.name,
    parentMessageId: branch.parentMessageId,
    parentBranchId: branch.parentBranchId,
    topic,
  },
});
```

In `checkoutBranch` — the function has a parameter typically named `branchRef`. Add the notification after `await saveSession(session)`, using the local variables already in scope:
```typescript
notifyBridge({
  action: "checkout",
  data: { branchId: session.currentBranchId },
});
```
This works for both main (currentBranchId is undefined) and branch (currentBranchId is set).

In `resolveBranch` (after `await saveSession(session)`):
```typescript
notifyBridge({
  action: "branch_resolved",
  data: { branchId: branch.id, merge },
});
```

In `rememberInsight` (after `await saveSession(session)`):
```typescript
notifyBridge({
  action: "insight_saved",
  data: {
    insightId: insight.id,
    content: insight.content,
    sourceBranchId: insight.sourceBranchId,
  },
});
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: Exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/session-manager.ts
git commit -m "feat: wire bridge notifications into session manager"
```

---

## Chunk 3: CLI Integration

### Task 10: Add `map` command to CLI

**Files:**
- Modify: `src/cli.ts:20-32` (command routing)
- Modify: `src/cli.ts:34-70` (help text)

- [ ] **Step 1: Add `map` command routing**

In `src/cli.ts`, update the command routing block (around line 23) to add the `map` case:

```typescript
if (command === "init") {
  await init();
} else if (command === "ui") {
  await launchUI();
} else if (command === "map") {
  await launchMap();
} else if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else {
  // Default: run MCP server
  await import("./index.js");
}
```

- [ ] **Step 2: Add `launchMap` function**

Add before the `ensureGlobalGitignore` function:

```typescript
async function launchMap(): Promise<void> {
  const { startBridgeServer } = await import("./bridge/server.js");
  const projectPath = process.cwd();

  // Parse --port flag
  const portIdx = args.indexOf("--port");
  const port =
    portIdx >= 0 && args[portIdx + 1]
      ? parseInt(args[portIdx + 1], 10)
      : 3200;

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error("Invalid port number. Use: npx neurobuttr-mcp map --port 3200");
    process.exit(1);
  }

  await startBridgeServer(projectPath, port);

  // Open browser
  const url = `http://localhost:${port}`;
  const { exec } = await import("node:child_process");
  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${openCmd} ${url}`);
}
```

- [ ] **Step 3: Add `map` to help text**

In the `printHelp` function, add to the Commands section:

```
  map [--port]   Open live metro map in browser (default: port 3200)
```

- [ ] **Step 4: Update `postbuild` in `package.json`**

Change the postbuild script to also copy the bridge UI HTML:

```json
"postbuild": "chmod +x dist/cli.js && mkdir -p dist/timeline/ui && cp src/timeline/ui/index.html dist/timeline/ui/ && mkdir -p dist/bridge/ui && cp src/bridge/ui/index.html dist/bridge/ui/",
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: Exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts package.json
git commit -m "feat: add 'map' CLI command to launch metro map bridge"
```

---

## Chunk 4: Metro Map UI

### Task 11: Create the metro map HTML

**Files:**
- Create: `src/bridge/ui/index.html`

- [ ] **Step 1: Create `src/bridge/ui/index.html`**

This is the largest file. It contains the full metro map SPA with:
- Inline CSS (dark theme, monochrome + blue glow)
- SVG metro map renderer
- Zoom/pan via mouse wheel + drag
- WebSocket connection with auto-reconnect
- Branch create/checkout/resolve/merge from UI
- Station hover cards
- Right sidebar for branch detail
- Bottom insight panel

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neurobuttr Map</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0e14;
      color: #c9d1d9;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Top bar */
    .topbar {
      height: 44px;
      background: #0d1117;
      border-bottom: 1px solid #1b2028;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      flex-shrink: 0;
    }
    .topbar-left { display: flex; align-items: center; gap: 10px; }
    .topbar-logo { font-size: 0.85em; font-weight: 600; color: #f0f6fc; letter-spacing: -0.3px; }
    .topbar-sep { color: #30363d; }
    .topbar-project { font-size: 0.8em; color: #8b949e; font-family: monospace; }
    .topbar-right { display: flex; align-items: center; gap: 12px; }
    .topbar-stat { font-size: 0.75em; color: #6e7681; display: flex; align-items: center; gap: 4px; }
    .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
    .dot-live { background: #3fb950; box-shadow: 0 0 6px #3fb95066; }
    .dot-dead { background: #f85149; }
    .btn {
      background: #21262d; border: 1px solid #30363d; color: #c9d1d9;
      font-size: 0.75em; padding: 4px 12px; border-radius: 6px; cursor: pointer;
    }
    .btn:hover { background: #30363d; border-color: #58a6ff; color: #f0f6fc; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-merge { background: #238636; border-color: #238636; color: #fff; }
    .btn-merge:hover { background: #2ea043; }

    /* Canvas */
    .canvas { flex: 1; position: relative; overflow: hidden; cursor: grab; }
    .canvas.dragging { cursor: grabbing; }
    .canvas svg { position: absolute; top: 0; left: 0; }

    /* Station tooltip */
    .tooltip {
      position: absolute; background: #161b22; border: 1px solid #30363d;
      border-radius: 6px; padding: 8px 12px; font-size: 0.78em;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4); pointer-events: none;
      z-index: 20; display: none; max-width: 250px;
    }
    .tooltip.visible { display: block; pointer-events: auto; }
    .tooltip-title { color: #f0f6fc; font-weight: 500; margin-bottom: 2px; }
    .tooltip-meta { color: #6e7681; font-size: 0.9em; }
    .tooltip-actions { display: flex; gap: 8px; margin-top: 6px; }
    .tooltip-action { color: #58a6ff; cursor: pointer; font-size: 0.9em; }
    .tooltip-action:hover { text-decoration: underline; }

    /* Sidebar */
    .sidebar {
      position: absolute; top: 0; right: -300px; width: 280px; height: 100%;
      background: #0d1117; border-left: 1px solid #1b2028; padding: 16px;
      overflow-y: auto; transition: right 0.2s ease; z-index: 10;
    }
    .sidebar.open { right: 0; }
    .sidebar-close { float: right; cursor: pointer; color: #6e7681; font-size: 0.85em; }
    .sidebar-close:hover { color: #f0f6fc; }
    .sidebar-title { font-size: 0.85em; font-weight: 600; color: #f0f6fc; margin: 8px 0 12px; display: flex; align-items: center; gap: 6px; }
    .sidebar-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .sidebar-label { font-size: 0.65em; text-transform: uppercase; letter-spacing: 0.5px; color: #484f58; margin: 12px 0 6px; }
    .sidebar-item { font-size: 0.78em; color: #8b949e; padding: 3px 0; display: flex; align-items: center; gap: 6px; }
    .sidebar-item-icon { width: 14px; text-align: center; flex-shrink: 0; font-size: 0.75em; }
    .sidebar-actions { display: flex; gap: 8px; margin-top: 14px; }
    .sidebar-actions .btn { flex: 1; text-align: center; }

    /* Insight panel */
    .insight-panel {
      position: absolute; bottom: 0; left: 0; right: 0;
      background: linear-gradient(transparent, #0a0e14 40%);
      padding: 32px 20px 12px; display: flex; gap: 12px; overflow-x: auto;
    }
    .insight-chip {
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      padding: 8px 12px; font-size: 0.75em; color: #c9d1d9;
      min-width: 200px; max-width: 260px; flex-shrink: 0; line-height: 1.4;
    }
    .insight-source { font-size: 0.85em; color: #6e7681; margin-top: 4px; }
    .insight-merged { border-color: #23863633; }

    /* Disconnected banner */
    .disconnected {
      position: absolute; top: 44px; left: 0; right: 0;
      background: #4c1d1d; color: #f87171; text-align: center;
      font-size: 0.78em; padding: 4px; display: none;
    }
    .disconnected.visible { display: block; }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-left">
      <span class="topbar-logo">neurobuttr</span>
      <span class="topbar-sep">/</span>
      <span class="topbar-project" id="project-name">...</span>
    </div>
    <div class="topbar-right">
      <span class="topbar-stat"><span class="dot dot-live" id="status-dot"></span> <span id="status-text">connecting</span></span>
      <span class="topbar-stat" id="branch-count">0 branches</span>
      <span class="topbar-stat" id="action-count">0 actions</span>
      <button class="btn" id="btn-branch" onclick="promptBranch()">+ Branch</button>
    </div>
  </div>

  <div class="disconnected" id="disconnected-banner">Connection lost. Reconnecting...</div>

  <div class="canvas" id="canvas">
    <svg id="metro-svg" xmlns="http://www.w3.org/2000/svg"></svg>
  </div>

  <div class="tooltip" id="tooltip"></div>

  <div class="sidebar" id="sidebar">
    <span class="sidebar-close" onclick="closeSidebar()">close</span>
    <div id="sidebar-content"></div>
  </div>

  <div class="insight-panel" id="insight-panel"></div>

  <script>
    // State
    let session = null;
    let ws = null;
    let wsConnected = false;

    // Pan/zoom state
    let viewX = 0, viewY = 0, zoom = 1;
    let dragging = false, dragStartX = 0, dragStartY = 0;

    // Layout constants
    const STATION_SPACING = 50;
    const BRANCH_Y_OFFSET = 80;
    const MAIN_Y = 250;
    const STATION_R = 5;

    // Escape HTML
    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function trunc(s, n) { return s.length > n ? s.slice(0, n) + '...' : s; }

    // ─── WebSocket ───
    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(proto + '//' + location.host + '/ws');

      ws.onopen = () => {
        wsConnected = true;
        document.getElementById('status-dot').className = 'dot dot-live';
        document.getElementById('status-text').textContent = 'live';
        document.getElementById('disconnected-banner').classList.remove('visible');
        document.getElementById('btn-branch').disabled = false;
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'state') {
          session = msg.session;
          render();
        } else if (msg.type === 'patch') {
          // For now, request full state on any patch
          // (incremental patching can be optimized later)
          ws.send(JSON.stringify({ action: 'request_state' }));
        }
      };

      ws.onclose = () => {
        wsConnected = false;
        document.getElementById('status-dot').className = 'dot dot-dead';
        document.getElementById('status-text').textContent = 'disconnected';
        document.getElementById('disconnected-banner').classList.add('visible');
        document.getElementById('btn-branch').disabled = true;
        setTimeout(connect, 2000);
      };

      ws.onerror = () => { ws.close(); };
    }

    function send(action) {
      if (ws && wsConnected) ws.send(JSON.stringify(action));
    }

    // ─── Actions ───
    function promptBranch() {
      const topic = prompt('Branch topic:');
      if (topic) send({ action: 'create_branch', data: { topic } });
    }
    function doCheckout(branchId) { send({ action: 'checkout', data: { branchId } }); closeSidebar(); }
    function doResolve(branchId) { send({ action: 'resolve', data: { branchId } }); closeSidebar(); }
    function doMerge(branchId) { send({ action: 'merge_insights', data: { branchId } }); closeSidebar(); }

    // ─── Sidebar ───
    function openSidebar(branch) {
      const sb = document.getElementById('sidebar');
      const actionIcons = { edit: 'M', bash: '$', search: '?', read: 'R', prompt: '>', decision: 'D', insight: 'I', other: '.' };
      const actionColors = { edit: '#3fb950', bash: '#f47067', search: '#79c0ff', read: '#8b949e', prompt: '#e6edf3', decision: '#d4a72c' };

      const branchInsights = (session.insights || []).filter(i => i.sourceBranchId === branch.id);
      const msgs = branch.messages || [];

      let html = '<div class="sidebar-title"><span class="sidebar-dot" style="background:#58a6ff"></span>' + esc(branch.name) + '</div>';

      if (branch.anchorContext) {
        html += '<div class="sidebar-label">Context</div>';
        html += '<div class="sidebar-item"><span style="color:#6e7681;font-size:0.9em;">' + esc(branch.anchorContext) + '</span></div>';
      }

      html += '<div class="sidebar-label">Activity (' + msgs.length + ')</div>';
      for (const m of msgs) {
        const at = m.actionType || 'other';
        const icon = actionIcons[at] || '.';
        const color = actionColors[at] || '#8b949e';
        html += '<div class="sidebar-item"><span class="sidebar-item-icon" style="color:' + color + '">' + icon + '</span>' + esc(trunc(m.content, 60)) + '</div>';
      }

      if (branchInsights.length > 0) {
        html += '<div class="sidebar-label">Insights (' + branchInsights.length + ')</div>';
        for (const ins of branchInsights) {
          html += '<div class="sidebar-item"><span class="sidebar-item-icon" style="color:#f0883e">&#9670;</span>' + esc(trunc(ins.content, 80)) + '</div>';
        }
      }

      if (!branch.resolved) {
        html += '<div class="sidebar-actions">';
        html += '<button class="btn" onclick="doCheckout(\'' + branch.id + '\')">Checkout</button>';
        html += '<button class="btn" onclick="doResolve(\'' + branch.id + '\')">Resolve</button>';
        html += '<button class="btn btn-merge" onclick="doMerge(\'' + branch.id + '\')">Merge</button>';
        html += '</div>';
      } else {
        html += '<div class="sidebar-label" style="color:#3fb950">Resolved</div>';
      }

      document.getElementById('sidebar-content').innerHTML = html;
      sb.classList.add('open');
    }
    function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); }

    // ─── Tooltip ───
    function showTooltip(x, y, station) {
      const tt = document.getElementById('tooltip');
      const actionLabels = { edit: 'Edited file', bash: 'Ran command', search: 'Searched', read: 'Read file', prompt: 'Prompt', decision: 'Decision', insight: 'Insight', other: 'Action' };
      tt.innerHTML = '<div class="tooltip-title">' + (actionLabels[station.actionType] || 'Action') + '</div>' +
        '<div class="tooltip-meta">' + esc(trunc(station.content, 80)) + '</div>';
      tt.style.left = (x + 16) + 'px';
      tt.style.top = (y - 8) + 'px';
      tt.classList.add('visible');
    }
    function hideTooltip() { document.getElementById('tooltip').classList.remove('visible'); }

    // ─── SVG Rendering ───
    function render() {
      if (!session) return;

      document.getElementById('project-name').textContent = session.projectPath.split('/').pop() || session.projectPath;
      const branches = session.branches || [];
      const mainMsgs = session.messages || [];
      document.getElementById('branch-count').textContent = branches.length + ' branch' + (branches.length !== 1 ? 'es' : '');

      const totalActions = mainMsgs.length + branches.reduce((s, b) => s + (b.messages || []).length, 0);
      document.getElementById('action-count').textContent = totalActions + ' actions';

      // Build station list for main line
      const mainStations = mainMsgs.map((m, i) => ({
        x: 60 + i * STATION_SPACING,
        y: MAIN_Y,
        msg: m,
        actionType: m.actionType || (m.role === 'user' ? 'prompt' : 'other'),
        role: m.role,
        content: m.content,
        id: m.id,
      }));

      // SVG dimensions
      const svgWidth = Math.max(800, 60 + mainStations.length * STATION_SPACING + 60);
      const svgHeight = 500;
      const svg = document.getElementById('metro-svg');
      svg.setAttribute('viewBox', '0 0 ' + svgWidth + ' ' + svgHeight);
      svg.setAttribute('width', svgWidth * zoom);
      svg.setAttribute('height', svgHeight * zoom);
      svg.style.left = viewX + 'px';
      svg.style.top = viewY + 'px';

      let svgContent = '';

      // Defs
      svgContent += '<defs>';
      svgContent += '<filter id="glow"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#58a6ff" flood-opacity="0.6"/></filter>';
      svgContent += '<filter id="glow-s"><feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#58a6ff" flood-opacity="0.3"/></filter>';
      svgContent += '<filter id="glow-g"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#238636" flood-opacity="0.5"/></filter>';
      svgContent += '</defs>';

      // Main line
      if (mainStations.length > 1) {
        svgContent += '<line x1="' + mainStations[0].x + '" y1="' + MAIN_Y + '" x2="' + mainStations[mainStations.length - 1].x + '" y2="' + MAIN_Y + '" stroke="#58a6ff" stroke-width="3" opacity="0.4" stroke-linecap="round"/>';
      }

      // Branch rendering
      let branchIdx = 0;
      for (const branch of branches) {
        // Find fork point on main line
        const forkIdx = mainStations.findIndex(s => s.id === branch.parentMessageId);
        if (forkIdx < 0) continue;

        const direction = branchIdx % 2 === 0 ? -1 : 1; // alternate up/down
        const forkX = mainStations[forkIdx].x;
        const branchY = MAIN_Y + direction * BRANCH_Y_OFFSET;
        const branchMsgs = branch.messages || [];

        // Branch stations
        const bStations = branchMsgs.map((m, i) => ({
          x: forkX + (i + 1) * STATION_SPACING,
          y: branchY,
          msg: m,
          actionType: m.actionType || (m.role === 'user' ? 'prompt' : 'other'),
          role: m.role,
          content: m.content,
          id: m.id,
        }));

        if (bStations.length === 0) {
          branchIdx++;
          continue;
        }

        // Branch curve (fork to first station)
        const cx1 = forkX + 15;
        const cy1 = MAIN_Y;
        const cx2 = bStations[0].x - 15;
        const cy2 = branchY;
        svgContent += '<path d="M ' + forkX + ' ' + MAIN_Y + ' C ' + cx1 + ' ' + cy1 + ' ' + cx2 + ' ' + cy2 + ' ' + bStations[0].x + ' ' + branchY + '" stroke="#58a6ff" stroke-width="2" fill="none" opacity="0.5" stroke-linecap="round"/>';

        // Branch line through stations
        if (bStations.length > 1) {
          svgContent += '<line x1="' + bStations[0].x + '" y1="' + branchY + '" x2="' + bStations[bStations.length - 1].x + '" y2="' + branchY + '" stroke="#58a6ff" stroke-width="2" opacity="0.5" stroke-linecap="round"/>';
        }

        // Merge curve back (if resolved with merge)
        const branchInsights = (session.insights || []).filter(i => i.sourceBranchId === branch.id && i.merged);
        if (branch.resolved && branchInsights.length > 0) {
          // Find nearest main station after last branch station
          const lastBX = bStations[bStations.length - 1].x;
          const mergeStation = mainStations.find(s => s.x > lastBX) || mainStations[mainStations.length - 1];
          const mx1 = lastBX + 15;
          const my1 = branchY;
          const mx2 = mergeStation.x - 15;
          const my2 = MAIN_Y;
          svgContent += '<path d="M ' + lastBX + ' ' + branchY + ' C ' + mx1 + ' ' + my1 + ' ' + mx2 + ' ' + my2 + ' ' + mergeStation.x + ' ' + MAIN_Y + '" stroke="#238636" stroke-width="2" fill="none" opacity="0.6" stroke-linecap="round"/>';
          // Merge point
          svgContent += '<circle cx="' + mergeStation.x + '" cy="' + MAIN_Y + '" r="7" fill="#0a0e14" stroke="#238636" stroke-width="2" filter="url(#glow-g)"/>';
        }

        // Branch label
        const labelY = branchY + (direction === -1 ? -14 : 18);
        svgContent += '<text x="' + bStations[0].x + '" y="' + labelY + '" fill="#58a6ff" font-size="9" font-family="system-ui" opacity="0.7">' + esc(branch.name) + '</text>';

        // Render branch stations
        for (const st of bStations) {
          const who = st.role === 'user' ? 'user' : 'agent';
          svgContent += renderStation(st, who, branch);
        }

        branchIdx++;
      }

      // Render main stations
      for (let i = 0; i < mainStations.length; i++) {
        const st = mainStations[i];
        const who = st.role === 'user' ? 'user' : 'agent';
        svgContent += renderStation(st, who, null);
      }

      svg.innerHTML = svgContent;

      // Render insights panel
      renderInsights();
    }

    function renderStation(st, who, branch) {
      const isUser = who === 'user';
      const stroke = isUser ? '#6e7681' : '#58a6ff';
      const filter = isUser ? '' : ' filter="url(#glow)"';
      const filterS = isUser ? '' : ' filter="url(#glow-s)"';
      const r = STATION_R;
      const dataAttr = ' data-id="' + st.id + '"';

      let shape = '';
      switch (st.actionType) {
        case 'bash':
          // Square
          shape = '<rect x="' + (st.x - r) + '" y="' + (st.y - r) + '" width="' + (r * 2) + '" height="' + (r * 2) + '" rx="2" fill="#0a0e14" stroke="' + stroke + '" stroke-width="' + (isUser ? 1.5 : 2) + '"' + filter + dataAttr + '/>';
          break;
        case 'search':
          // Triangle
          const h = r * 1.8;
          const pts = st.x + ',' + (st.y - h / 2) + ' ' + (st.x - r) + ',' + (st.y + h / 2) + ' ' + (st.x + r) + ',' + (st.y + h / 2);
          shape = '<polygon points="' + pts + '" fill="#0a0e14" stroke="' + stroke + '" stroke-width="' + (isUser ? 1.5 : 2) + '" stroke-linejoin="round"' + filter + dataAttr + '/>';
          break;
        case 'read':
          // Dashed circle
          shape = '<circle cx="' + st.x + '" cy="' + st.y + '" r="' + r + '" fill="#0a0e14" stroke="' + stroke + '" stroke-width="1.5" stroke-dasharray="3 2"' + filterS + dataAttr + '/>';
          break;
        case 'decision':
          // Diamond
          const dr = r * 1.1;
          shape = '<rect x="' + (st.x - dr) + '" y="' + (st.y - dr) + '" width="' + (dr * 2) + '" height="' + (dr * 2) + '" rx="1" transform="rotate(45 ' + st.x + ' ' + st.y + ')" fill="#0a0e14" stroke="' + stroke + '" stroke-width="' + (isUser ? 1.5 : 2) + '"' + filter + dataAttr + '/>';
          break;
        case 'insight':
          // Filled diamond
          const ir = r * 1.1;
          shape = '<rect x="' + (st.x - ir) + '" y="' + (st.y - ir) + '" width="' + (ir * 2) + '" height="' + (ir * 2) + '" rx="1" transform="rotate(45 ' + st.x + ' ' + st.y + ')" fill="#f0883e" stroke="#f0883e" stroke-width="1"' + dataAttr + '/>';
          break;
        default:
          // Circle (edit, prompt, other)
          shape = '<circle cx="' + st.x + '" cy="' + st.y + '" r="' + r + '" fill="#0a0e14" stroke="' + stroke + '" stroke-width="' + (isUser ? 1.5 : 2) + '"' + filter + dataAttr + '/>';
      }

      return '<g class="station" onmouseenter="showTooltip(event.clientX, event.clientY, ' + escAttr(JSON.stringify({ actionType: st.actionType, content: trunc(st.content, 100) })) + ')" onmouseleave="hideTooltip()"' +
        (branch ? ' onclick="openSidebar(' + escAttr(JSON.stringify(branch)) + ')"' : '') +
        ' style="cursor:' + (branch ? 'pointer' : 'default') + '">' + shape + '</g>';
    }

    function escAttr(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

    function renderInsights() {
      const panel = document.getElementById('insight-panel');
      const insights = session.insights || [];
      if (insights.length === 0) { panel.innerHTML = ''; return; }

      let html = '';
      for (const ins of insights) {
        const branch = (session.branches || []).find(b => b.id === ins.sourceBranchId);
        const branchName = branch ? branch.name : 'unknown';
        const cls = ins.merged ? 'insight-chip insight-merged' : 'insight-chip';
        html += '<div class="' + cls + '">' +
          '<span style="color:#f0883e;margin-right:4px;">&#9670;</span>' +
          esc(trunc(ins.content, 80)) +
          '<div class="insight-source">from ' + esc(branchName) + ' &middot; ' + (ins.merged ? 'merged' : 'pending') + '</div>' +
          '</div>';
      }
      panel.innerHTML = html;
    }

    // ─── Pan/Zoom ───
    const canvas = document.getElementById('canvas');

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = Math.max(0.3, Math.min(3, zoom * delta));
      render();
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      dragging = true;
      dragStartX = e.clientX - viewX;
      dragStartY = e.clientY - viewY;
      canvas.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      viewX = e.clientX - dragStartX;
      viewY = e.clientY - dragStartY;
      const svg = document.getElementById('metro-svg');
      svg.style.left = viewX + 'px';
      svg.style.top = viewY + 'px';
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
      canvas.classList.remove('dragging');
    });

    // ─── Init ───
    connect();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify file exists**

Run: `ls -la src/bridge/ui/index.html`
Expected: File exists.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/ui/index.html
git commit -m "feat: add metro map UI (SVG, zoom/pan, WebSocket, interactive)"
```

---

## Chunk 5: Build + End-to-End Verification

### Task 12: Full build and verify

- [ ] **Step 1: Create bridge/ui directory in dist**

Run: `npm run build`
Expected: Exit 0. All files compile. `dist/bridge/ui/index.html`, `dist/bridge/server.js`, `dist/bridge/bridge-client.js`, `dist/bridge/protocol.js` all exist.

- [ ] **Step 2: Launch the bridge**

Run: `node dist/cli.js map --port 3200`
Expected:
- Console prints `Metro Map running at http://localhost:3200 — Ctrl+C to stop`
- Browser opens to `http://localhost:3200`

- [ ] **Step 3: Verify the map renders**

In the browser:
- Page loads with dark theme
- Top bar shows project name, "live" indicator
- Metro map canvas shows main line (if session has messages)
- Pan by dragging, zoom with scroll wheel

- [ ] **Step 4: Verify branch interaction**

Click "+ Branch" in top bar:
- Prompt dialog appears
- Enter a topic → branch appears on the map as a curved line

- [ ] **Step 5: Verify Ctrl+C stops cleanly**

Press Ctrl+C in terminal:
- Server stops, process exits cleanly

- [ ] **Step 6: Verify graceful degradation**

Without the bridge running, use Claude Code with neurobuttr tools:
- `nb_branch`, `nb_checkout`, `nb_resolve` should all work normally
- No errors about WebSocket connection
