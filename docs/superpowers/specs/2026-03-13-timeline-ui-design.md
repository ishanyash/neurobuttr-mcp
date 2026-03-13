# Timeline UI — Design Spec

**Date:** 2026-03-13
**Status:** Draft

---

## Context

The Timeline MCP tools (`nb_timeline_capture`, `nb_timeline_show`, etc.) capture and expose Claude Code session data, but reviewing sessions through MCP tools still uses the agent's context window. The whole point of Timeline is to review agent work **outside** the chat. A live local web UI solves this — the developer opens it in a browser tab, reviews sessions independently, and never pollutes the agent's context.

---

## Architecture

### Server: `src/timeline/ui/server.ts`

A `node:http` server (zero dependencies) bound to `127.0.0.1:3100` (configurable via `--port`). Launched by `npx neurobuttr-mcp ui`. Binds to localhost only — never `0.0.0.0`.

**Routes:**

| Route | Method | Content-Type | Response |
|---|---|---|---|
| `/` | GET | `text/html` | Serves `index.html` |
| `/api/sessions` | GET | `application/json` | Transformed session list (see API section) |
| `/api/sessions/:id` | GET | `application/json` | Full session detail JSON |
| `/api/events` | GET | `text/event-stream` | SSE stream for live updates |

**Route parsing:** Since `node:http` has no router, URL parsing uses `new URL(req.url, 'http://localhost')`. The `:id` parameter is extracted by splitting the pathname (e.g., `/api/sessions/abc123` → `abc123`).

**Error responses:** All API routes return `{ "error": "message" }` with appropriate HTTP status codes:
- 404 for unknown routes and non-existent session IDs
- 500 for disk read errors

**Port conflicts:** If the port is already in use (`EADDRINUSE`), print a clear error: `Port 3100 is already in use. Try: npx neurobuttr-mcp ui --port 3200`

The server reads from `~/.neurobuttr/timeline/{project-hash}/sessions/` where the project hash is derived from the `cwd` where the command is run (using `sessionIdFromPath` from `src/core/storage.ts`).

**HTML file resolution:** The server resolves `index.html` relative to its own location using `import.meta.url`:
```ts
const htmlPath = join(dirname(fileURLToPath(import.meta.url)), "index.html");
```

### Live Updates via SSE

The server watches `~/.neurobuttr/timeline/{project-hash}/sessions/` using `fs.watch()`. Events are debounced (500ms window) to avoid duplicate notifications from `kqueue`/`inotify`. If the sessions directory doesn't exist yet, the server creates it before watching. When a new session JSON file appears or an existing one changes, it sends an SSE event to all connected browsers:

```
event: session-update
data: {"type": "new_session", "id": "abc123"}
```

The frontend listens on `EventSource('/api/events')` and re-fetches the session list when notified. `EventSource` auto-reconnects on connection drops, which is the desired behavior for long-lived browser tabs. No polling required.

### Auto-capture on Launch

Before starting the HTTP server, the `ui` command runs the same capture logic as `nb_timeline_capture` — parses any uncaptured Claude Code JSONL logs and writes session JSONs. This ensures the UI always shows the latest data on first load.

### Frontend: `src/timeline/ui/index.html`

A single HTML file with inline `<style>` and `<script>`. Vanilla JS, no framework, no build step. Two views rendered by swapping DOM content.

#### Session List View (default)

- **Header:** Project path (derived from API), total session count
- **Session cards** in a vertical list, newest first. Each card shows:
  - Short ID (first 8 chars of UUID)
  - Prompt text (truncated to ~80 chars)
  - Timestamp (relative: "2 hours ago", "yesterday")
  - Model name
  - File count badge (e.g., "3 files")
  - Action count
  - Status badge: green for completed, red for error, grey for rolled_back
- **Click a card** → navigates to Session Detail view
- **Auto-refreshes** when SSE notifies of new sessions (new card slides in at top)
- **Empty state:** If no sessions exist, show: "No sessions captured yet. Use Claude Code on this project, then run `npx neurobuttr-mcp ui` again."

#### Session Detail View

- **Back link** → returns to Session List
- **Header section:**
  - Full prompt text
  - Model + Claude Code version
  - Duration (e.g., "4m 32s")
  - Git branch
  - Status
  - Tags (if any)
  - Notes (if any)
- **Files Changed panel:**
  - List of modified file paths, each with a count of edits
- **Action Timeline:** Vertical list of all actions, in order. Each action rendered as:

  **Reasoning actions:**
  - Muted text block with the reasoning content
  - Collapsible if longer than 200 chars (click to expand)

  **Tool Use actions:**
  - Icon/label: tool name (e.g., "Edit", "Bash", "Read", "Grep")
  - Summary line: key input parameter (file path, command, or pattern)
  - If file-modifying (Edit/Write): inline diff block with:
    - Red lines for removals (`-`)
    - Green lines for additions (`+`)
    - Monospace font, pre-formatted
  - Click to expand: full tool input JSON

  **Tool Result actions:**
  - Success (green check) or error (red X) indicator
  - Output text (truncated to 200 chars by default, click to expand)
  - Monospace for output content

### Styling

- Dark theme (dark background, light text) — standard dev tool aesthetic
- Monospace font for all code, diffs, and tool output
- Sans-serif for UI chrome (headers, labels, timestamps)
- Color coding:
  - Green: additions, success, completed status
  - Red: deletions, errors
  - Muted grey: reasoning text, timestamps
  - Blue: links, interactive elements
- Responsive: works at any browser width (no fixed widths)

---

## CLI Integration

### New subcommand in `src/cli.ts`

```
npx neurobuttr-mcp ui [--port PORT]
```

**Behavior:**
1. Resolve `cwd` → project hash
2. Auto-capture: run capture logic (parse uncaptured JSONL logs)
3. Start HTTP server on `localhost:PORT` (default: 3100)
4. Open the URL in the default browser (`open` on macOS, `xdg-open` on Linux, `start` on Windows)
5. Print: `Timeline UI running at http://localhost:3100 — Ctrl+C to stop`
6. Keep running until Ctrl+C

### Help text update

Add to the `printHelp()` output:
```
  ui [--port PORT]     — Open the timeline review UI in your browser (default: port 3100)
```

---

## File Structure

New files:

```
src/timeline/ui/
  server.ts           # node:http server, API routes, SSE, fs.watch
  index.html          # Single-page vanilla HTML/CSS/JS
```

### Build

Update `package.json` scripts to copy the HTML file to `dist/`:

```json
"postbuild": "chmod +x dist/cli.js && mkdir -p dist/timeline/ui && cp src/timeline/ui/index.html dist/timeline/ui/"
```

---

## Data Flow

```
Developer runs: npx neurobuttr-mcp ui
    → Auto-capture: parse ~/.claude/projects/{hash}/*.jsonl
        → Write session JSONs to ~/.neurobuttr/timeline/{hash}/
    → Start HTTP server on localhost:3100
    → Open browser
    → Browser fetches GET /api/sessions → renders session list
    → Developer clicks a session → fetches GET /api/sessions/:id → renders detail
    → Meanwhile: fs.watch() detects new session files
        → SSE push to browser → auto-refresh session list
```

---

## API Response Shapes

### GET /api/sessions

This is a transformed response — not the raw `TimelineIndex` from disk. The server reads `index.json` via `loadTimelineIndex()` and adds `projectPath` from the resolved `cwd` (stored at server startup).

```json
{
  "projectPath": "/Users/dev/my-project",
  "sessions": [
    {
      "id": "60b04454-9ee5-4dd4-81d0-2fb20eecbb51",
      "prompt": "Fix the auth bug in login flow",
      "model": "claude-opus-4-6",
      "startedAt": 1710340500000,
      "completedAt": 1710340800000,
      "status": "completed",
      "filesModified": ["src/auth.ts", "src/middleware.ts"],
      "actionCount": 47,
      "gitBranch": "main"
    }
  ]
}
```

### GET /api/sessions/:id

Returns the full `TimelineSession` object as defined in `src/timeline/types.ts`.

---

## Verification Plan

1. `npm run build` compiles without errors and copies `index.html` to `dist/timeline/ui/`
2. `npx neurobuttr-mcp ui` starts a server on localhost:3100
3. Browser opens and shows session list with captured sessions
4. Clicking a session shows the action timeline with reasoning and diffs
5. Diff coloring (red/green) renders correctly for Edit and Write actions
6. Expanding/collapsing long reasoning and tool output works
7. SSE: capturing a new session while UI is open causes the list to refresh
8. `Ctrl+C` cleanly shuts down the server

---

## Implementation Order

1. `server.ts` — HTTP server with API routes (session list + detail)
2. `index.html` — Session list view with cards
3. `index.html` — Session detail view with action timeline and diffs
4. `server.ts` — SSE endpoint + `fs.watch()`
5. `cli.ts` — Add `ui` subcommand with auto-capture + browser open
6. `package.json` — Update postbuild to copy HTML
7. End-to-end test: build, launch, verify in browser
