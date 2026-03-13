# Timeline UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live local web UI (`npx neurobuttr-mcp ui`) that lets developers review Claude Code sessions in a browser — outside the agent's context.

**Architecture:** A `node:http` server serves a static `index.html` file and JSON API endpoints. The frontend is vanilla HTML/CSS/JS with two views (session list + session detail). SSE via `fs.watch()` provides live updates.

**Tech Stack:** Node.js built-in `node:http`, `node:fs`, vanilla HTML/JS, inline CSS. Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-13-timeline-ui-design.md`

---

## Chunk 1: HTTP Server + API

### Task 1: Create the HTTP server with API routes

**Files:**
- Create: `src/timeline/ui/server.ts`

- [ ] **Step 1: Create `src/timeline/ui/server.ts` with the HTTP server and API routes**

```typescript
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, watch, mkdir } from "node:fs/promises";
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
    const watcher = watch(sessionsDir, { persistent: false });
    (async () => {
      for await (const event of watcher) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          for (const client of sseClients) {
            client.res.write(
              `event: session-update\ndata: ${JSON.stringify({ type: "update" })}\n\n`
            );
          }
        }, 500);
      }
    })().catch(() => {
      // Watcher closed, ignore
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: Exit 0, no errors. `dist/timeline/ui/server.js` exists.

- [ ] **Step 3: Commit**

```bash
git add src/timeline/ui/server.ts
git commit -m "feat: add timeline UI HTTP server with API routes and SSE"
```

---

## Chunk 2: Frontend HTML

### Task 2: Create the single-page HTML frontend

**Files:**
- Create: `src/timeline/ui/index.html`

- [ ] **Step 1: Create `src/timeline/ui/index.html`**

This is a large file. The full content follows. It contains:
- Inline `<style>` with dark theme
- Session list view (default)
- Session detail view (click a card)
- SSE listener for auto-refresh
- `timeAgo()` utility for relative timestamps
- Diff rendering with red/green coloring
- Expand/collapse for reasoning and tool output

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neurobuttr Timeline</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      line-height: 1.5;
    }

    .container { max-width: 900px; margin: 0 auto; padding: 20px; }

    h1 { color: #f0f6fc; font-size: 1.4em; margin-bottom: 4px; }
    .subtitle { color: #8b949e; font-size: 0.9em; margin-bottom: 20px; }

    /* Session cards */
    .session-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .session-card:hover { border-color: #58a6ff; }
    .session-card .prompt {
      color: #f0f6fc;
      font-size: 0.95em;
      margin-bottom: 6px;
    }
    .session-card .meta {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      font-size: 0.8em;
      color: #8b949e;
    }
    .badge {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 12px;
      font-size: 0.75em;
      font-weight: 500;
    }
    .badge-completed { background: #1b4332; color: #2dd4bf; }
    .badge-error { background: #4c1d1d; color: #f87171; }
    .badge-rolled_back { background: #2d333b; color: #8b949e; }

    /* Detail view */
    .back-link {
      color: #58a6ff;
      cursor: pointer;
      font-size: 0.9em;
      margin-bottom: 16px;
      display: inline-block;
    }
    .back-link:hover { text-decoration: underline; }

    .detail-header {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .detail-header .prompt { color: #f0f6fc; font-size: 1.1em; margin-bottom: 8px; }
    .detail-header .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 4px 16px;
      font-size: 0.85em;
      color: #8b949e;
    }
    .meta-label { color: #6e7681; }

    .files-panel {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 16px;
      font-size: 0.85em;
    }
    .files-panel h3 { color: #f0f6fc; font-size: 0.9em; margin-bottom: 8px; }
    .file-path { color: #58a6ff; font-family: monospace; }

    /* Action timeline */
    .action {
      border-left: 2px solid #30363d;
      padding: 8px 0 8px 16px;
      margin-left: 8px;
      margin-bottom: 4px;
    }
    .action-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85em;
      margin-bottom: 4px;
    }
    .action-icon { font-size: 1em; }
    .action-tool { color: #d2a8ff; font-weight: 600; }
    .action-time { color: #6e7681; font-size: 0.8em; }
    .action-summary { color: #8b949e; font-family: monospace; font-size: 0.8em; }

    .reasoning-text {
      color: #8b949e;
      font-size: 0.85em;
      font-style: italic;
      white-space: pre-wrap;
      max-height: 80px;
      overflow: hidden;
      cursor: pointer;
      position: relative;
    }
    .reasoning-text.expanded { max-height: none; }
    .reasoning-text:not(.expanded)::after {
      content: '... click to expand';
      position: absolute;
      bottom: 0;
      right: 0;
      background: linear-gradient(to right, transparent, #0d1117 40%);
      padding-left: 40px;
      color: #58a6ff;
      font-style: normal;
      font-size: 0.8em;
    }

    .diff-block {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 4px;
      padding: 8px 12px;
      margin-top: 4px;
      font-family: monospace;
      font-size: 0.8em;
      white-space: pre;
      overflow-x: auto;
      line-height: 1.4;
    }
    .diff-add { color: #3fb950; }
    .diff-del { color: #f85149; }
    .diff-hunk { color: #6e7681; }

    .tool-output {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 4px;
      padding: 8px 12px;
      margin-top: 4px;
      font-family: monospace;
      font-size: 0.8em;
      white-space: pre-wrap;
      max-height: 60px;
      overflow: hidden;
      cursor: pointer;
    }
    .tool-output.expanded { max-height: none; }
    .error-output { border-color: #f8514933; }

    .expandable { cursor: pointer; }
    .expandable:hover { opacity: 0.9; }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #8b949e;
    }
    .empty-state h2 { color: #c9d1d9; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div id="app"></div>
  </div>

  <script>
    const app = document.getElementById('app');
    let currentView = 'list';

    function timeAgo(ms) {
      const secs = Math.floor((Date.now() - ms) / 1000);
      if (secs < 60) return 'just now';
      const mins = Math.floor(secs / 60);
      if (mins < 60) return mins + 'm ago';
      const hours = Math.floor(mins / 60);
      if (hours < 24) return hours + 'h ago';
      const days = Math.floor(hours / 24);
      if (days < 7) return days + 'd ago';
      return new Date(ms).toLocaleDateString();
    }

    function duration(start, end) {
      const secs = Math.round((end - start) / 1000);
      if (secs < 60) return secs + 's';
      const mins = Math.floor(secs / 60);
      if (mins < 60) return mins + 'm ' + (secs % 60) + 's';
      const hours = Math.floor(mins / 60);
      return hours + 'h ' + (mins % 60) + 'm';
    }

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function renderDiff(patch) {
      return patch.split('\n').map(line => {
        const esc = escapeHtml(line);
        if (line.startsWith('+')) return '<span class="diff-add">' + esc + '</span>';
        if (line.startsWith('-')) return '<span class="diff-del">' + esc + '</span>';
        if (line.startsWith('@@')) return '<span class="diff-hunk">' + esc + '</span>';
        return esc;
      }).join('\n');
    }

    function renderAction(action) {
      if (action.type === 'reasoning') {
        const text = escapeHtml(action.reasoning);
        const needsExpand = action.reasoning.length > 200;
        return '<div class="action">' +
          '<div class="action-header"><span class="action-icon">💭</span><span class="action-time">#' + action.index + '</span></div>' +
          '<div class="reasoning-text' + (needsExpand ? '' : ' expanded') + '" onclick="this.classList.toggle(\'expanded\')">' + text + '</div>' +
          '</div>';
      }

      if (action.type === 'tool_use') {
        let summary = '';
        const inp = action.toolInput || {};
        if (action.toolName === 'Edit' || action.toolName === 'Write' || action.toolName === 'Read') {
          summary = inp.file_path || '';
        } else if (action.toolName === 'Bash') {
          const cmd = String(inp.command || '');
          summary = '$ ' + (cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd);
        } else if (action.toolName === 'Grep' || action.toolName === 'Glob') {
          summary = inp.pattern || '';
        } else {
          summary = JSON.stringify(inp).slice(0, 80);
        }

        let diffHtml = '';
        if (action.fileDiff) {
          diffHtml = '<div class="diff-block">' + renderDiff(action.fileDiff.patch) + '</div>';
        }

        const inputJson = JSON.stringify(action.toolInput, null, 2);
        const inputHtml = '<div class="tool-output" onclick="this.classList.toggle(\'expanded\')">' + escapeHtml(inputJson) + '</div>';

        return '<div class="action">' +
          '<div class="action-header">' +
            '<span class="action-icon">🔧</span>' +
            '<span class="action-tool">' + escapeHtml(action.toolName) + '</span>' +
            '<span class="action-time">#' + action.index + '</span>' +
          '</div>' +
          (summary ? '<div class="action-summary">' + escapeHtml(summary) + '</div>' : '') +
          diffHtml +
          inputHtml +
          '</div>';
      }

      if (action.type === 'tool_result') {
        const icon = action.isError ? '❌' : '✅';
        const output = action.toolOutput || '';
        const cls = action.isError ? 'tool-output error-output' : 'tool-output';
        return '<div class="action">' +
          '<div class="action-header"><span class="action-icon">' + icon + '</span><span class="action-time">#' + action.index + '</span></div>' +
          (output ? '<div class="' + cls + '" onclick="this.classList.toggle(\'expanded\')">' + escapeHtml(output) + '</div>' : '') +
          '</div>';
      }

      return '';
    }

    async function showList() {
      currentView = 'list';
      const res = await fetch('/api/sessions');
      const data = await res.json();

      if (!data.sessions || data.sessions.length === 0) {
        app.innerHTML =
          '<h1>Neurobuttr Timeline</h1>' +
          '<div class="subtitle">' + escapeHtml(data.projectPath || '') + '</div>' +
          '<div class="empty-state">' +
            '<h2>No sessions captured</h2>' +
            '<p>Use Claude Code on this project, then reopen the UI.</p>' +
          '</div>';
        return;
      }

      let html = '<h1>Neurobuttr Timeline</h1>' +
        '<div class="subtitle">' + escapeHtml(data.projectPath) + ' — ' + data.sessions.length + ' session(s)</div>';

      for (const s of data.sessions) {
        const prompt = s.prompt.length > 80 ? s.prompt.slice(0, 80) + '...' : s.prompt;
        html += '<div class="session-card" onclick="showDetail(\'' + s.id + '\')">' +
          '<div class="prompt">' + escapeHtml(prompt) + '</div>' +
          '<div class="meta">' +
            '<span>' + s.id.slice(0, 8) + '</span>' +
            '<span>' + timeAgo(s.startedAt) + '</span>' +
            '<span>' + escapeHtml(s.model) + '</span>' +
            '<span>' + s.filesModified.length + ' files</span>' +
            '<span>' + s.actionCount + ' actions</span>' +
            '<span class="badge badge-' + s.status + '">' + s.status + '</span>' +
          '</div>' +
          '</div>';
      }

      app.innerHTML = html;
    }

    async function showDetail(id) {
      currentView = 'detail';
      const res = await fetch('/api/sessions/' + id);
      if (!res.ok) {
        app.innerHTML = '<span class="back-link" onclick="showList()">← Back</span><p>Session not found.</p>';
        return;
      }
      const s = await res.json();

      let html = '<span class="back-link" onclick="showList()">← Back to sessions</span>';

      // Header
      html += '<div class="detail-header">' +
        '<div class="prompt">' + escapeHtml(s.prompt) + '</div>' +
        '<div class="meta-grid">' +
          '<div><span class="meta-label">Model:</span> ' + escapeHtml(s.model) + '</div>' +
          '<div><span class="meta-label">Duration:</span> ' + duration(s.startedAt, s.completedAt) + '</div>' +
          '<div><span class="meta-label">Branch:</span> ' + escapeHtml(s.gitBranch) + '</div>' +
          '<div><span class="meta-label">Status:</span> <span class="badge badge-' + s.status + '">' + s.status + '</span></div>' +
          '<div><span class="meta-label">Actions:</span> ' + s.actions.length + '</div>' +
          '<div><span class="meta-label">Version:</span> ' + escapeHtml(s.claudeCodeVersion) + '</div>' +
          (s.tags.length ? '<div><span class="meta-label">Tags:</span> ' + escapeHtml(s.tags.join(', ')) + '</div>' : '') +
          (s.notes ? '<div><span class="meta-label">Notes:</span> ' + escapeHtml(s.notes) + '</div>' : '') +
        '</div>' +
        '</div>';

      // Files changed
      if (s.filesModified.length > 0) {
        html += '<div class="files-panel"><h3>Files Changed (' + s.filesModified.length + ')</h3>';
        for (const f of s.filesModified) {
          html += '<div class="file-path">' + escapeHtml(f) + '</div>';
        }
        html += '</div>';
      }

      // Action timeline
      html += '<h3 style="color:#f0f6fc;margin:16px 0 8px;font-size:0.95em;">Action Timeline</h3>';
      for (const action of s.actions) {
        html += renderAction(action);
      }

      // Subagents
      if (s.subagentSessions && s.subagentSessions.length > 0) {
        html += '<h3 style="color:#f0f6fc;margin:16px 0 8px;font-size:0.95em;">Subagent Sessions (' + s.subagentSessions.length + ')</h3>';
        for (const sub of s.subagentSessions) {
          const p = sub.prompt.length > 60 ? sub.prompt.slice(0, 60) + '...' : sub.prompt;
          html += '<div class="session-card"><div class="prompt">' + escapeHtml(p) + '</div>' +
            '<div class="meta"><span>' + sub.actions.length + ' actions</span></div></div>';
        }
      }

      app.innerHTML = html;
    }

    // SSE for live updates
    const evtSource = new EventSource('/api/events');
    evtSource.addEventListener('session-update', () => {
      if (currentView === 'list') showList();
    });

    // Initial load
    showList();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify file exists**

Run: `ls -la src/timeline/ui/index.html`
Expected: File exists, ~8-10KB.

- [ ] **Step 3: Commit**

```bash
git add src/timeline/ui/index.html
git commit -m "feat: add timeline UI frontend (vanilla HTML/CSS/JS)"
```

---

## Chunk 3: CLI Integration + Build

### Task 3: Add the `ui` subcommand to cli.ts

**Files:**
- Modify: `src/cli.ts:20-30` (command routing)
- Modify: `src/cli.ts:32-66` (help text)

- [ ] **Step 1: Add `ui` command routing in `src/cli.ts`**

Replace the command routing block (lines 20-30) with:

```typescript
const args = process.argv.slice(2);
const command = args[0];

if (command === "init") {
  await init();
} else if (command === "ui") {
  await launchUI();
} else if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else {
  // Default: run MCP server
  await import("./index.js");
}
```

- [ ] **Step 2: Add the `launchUI()` function at the end of `src/cli.ts`**

```typescript
async function launchUI(): Promise<void> {
  const { startTimelineServer } = await import("./timeline/ui/server.js");
  const projectPath = process.cwd();

  // Parse --port flag
  const portIdx = args.indexOf("--port");
  const port = portIdx >= 0 && args[portIdx + 1]
    ? parseInt(args[portIdx + 1], 10)
    : 3100;

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error("Invalid port number. Use: npx neurobuttr-mcp ui --port 3100");
    process.exit(1);
  }

  await startTimelineServer(projectPath, port);

  // Open browser
  const url = `http://localhost:${port}`;
  const { exec } = await import("node:child_process");
  const openCmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start" :
    "xdg-open";
  exec(`${openCmd} ${url}`);
}
```

- [ ] **Step 3: Add `ui` to the help text**

In the `printHelp()` function, add to the Commands section:

```
  ui [--port]  Open timeline review UI in browser (default: port 3100)
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: Exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add 'ui' subcommand to launch timeline review in browser"
```

### Task 4: Update build to copy HTML file

**Files:**
- Modify: `package.json:12` (postbuild script)

- [ ] **Step 1: Update `postbuild` in `package.json`**

Change line 12 from:
```json
"postbuild": "chmod +x dist/cli.js",
```
To:
```json
"postbuild": "chmod +x dist/cli.js && mkdir -p dist/timeline/ui && cp src/timeline/ui/index.html dist/timeline/ui/",
```

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: Exit 0. `dist/timeline/ui/index.html` exists.

- [ ] **Step 3: Verify HTML was copied**

Run: `ls -la dist/timeline/ui/index.html`
Expected: File exists.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: copy timeline UI HTML to dist during postbuild"
```

---

## Chunk 4: End-to-End Verification

### Task 5: End-to-end test

- [ ] **Step 1: Fresh build**

Run: `npm run build`
Expected: Exit 0, `dist/timeline/ui/index.html` and `dist/timeline/ui/server.js` both exist.

- [ ] **Step 2: Launch the UI**

Run: `node dist/cli.js ui --port 3100`
Expected:
- Console prints auto-capture info (if sessions exist)
- Console prints `Timeline UI running at http://localhost:3100 — Ctrl+C to stop`
- Browser opens to `http://localhost:3100`

- [ ] **Step 3: Verify session list renders**

In the browser at `http://localhost:3100`:
- Page loads with dark theme
- Shows project path in header
- If sessions were captured: shows session cards with prompt, model, file count
- If no sessions: shows empty state message

- [ ] **Step 4: Verify session detail**

Click a session card:
- Back link appears
- Header shows full prompt, model, duration, branch, status
- Files changed panel shows modified file paths
- Action timeline shows reasoning (muted italic), tool calls (purple tool name), results (green/red)
- Diffs show red/green coloring for Edit/Write tools
- Long reasoning text is collapsible (click to expand)

- [ ] **Step 5: Verify Ctrl+C stops cleanly**

Press Ctrl+C in the terminal:
- Server stops, process exits cleanly

- [ ] **Step 6: Verify port conflict handling**

Run two instances: `node dist/cli.js ui --port 3100` (in two terminals)
Expected: Second instance prints `Port 3100 is already in use. Try: npx neurobuttr-mcp ui --port 3200`
