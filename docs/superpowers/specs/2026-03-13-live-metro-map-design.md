# Live Metro Map — Design Spec

## Goal

Add a live, interactive metro-map UI to neurobuttr-mcp that visualizes Claude Code conversation branching in real time. Developers see their conversation structure — main thread, branches, merges, insights — as a subway-style map in the browser, with two-way sync so actions on the map affect the Claude session and vice versa.

## Problem

The existing branching tools (`nb_branch`, `nb_checkout`, `nb_resolve`, `nb_map`) work, but branching is invisible — you have to ask Claude to show the map, which pollutes the context. There's no persistent visual, no interactivity, and no way to see the conversation evolving live. The Mermaid/ASCII output is static and requires a separate extension.

## Core Concept

**Think of it as a metro/subway map for your coding conversation:**

- The **main line** flows left to right — each station is an action (prompt, edit, search, command)
- **Branches** curve off the main line when you explore a tangent
- **Merge points** show where branch insights flowed back to main
- **Dead-ends** show explored-and-discarded branches
- The map updates live as you work — new stations appear, branches grow

The key value: a non-technical person can look at the map and understand "the developer asked this, Claude explored that direction, found this insight, and brought it back."

---

## Architecture

```
┌─────────────────┐         WebSocket          ┌──────────────────┐
│   Metro Map UI  │◄══════════════════════════►│   Bridge Server   │
│  (browser tab)  │    real-time both ways     │  (node process)   │
└─────────────────┘                            └────────┬──────────┘
                                                        │
                                                 Session state
                                                 held in memory
                                                        │
                                                        ▼
┌─────────────────┐      MCP tool calls        ┌──────────────────┐
│   Claude Code   │───────────────────────────►│   MCP Server      │
│   (agent)       │◄───────────────────────────│   (neurobuttr)    │
└─────────────────┘      tool responses        └────────┬──────────┘
                                                        │
                                                 reads/writes via
                                                 bridge WS client
                                                        │
                                                        ▼
                                               ┌──────────────────┐
                                               │  Session JSON     │
                                               │  (disk, backup)   │
                                               └──────────────────┘
```

### Three Components

**1. Bridge Server** (`src/bridge/`)

A single `node:http` + `ws` process. It:
- Holds the session state in memory (write-through to disk on every mutation)
- Serves the map HTML on `GET /`
- Accepts WebSocket connections from the browser and MCP tools
- Broadcasts state patches to all connected clients
- Runs on `127.0.0.1:3200` (configurable via `--port`)

**2. MCP Tools** (modified `src/core/session-manager.ts`)

The existing tools (`nb_branch`, `nb_checkout`, `nb_resolve`, `add_message`, etc.) are modified to:
- Connect to the bridge via WebSocket when it's running
- Send mutations through the bridge instead of writing to disk directly
- Fall back to direct file I/O when the bridge isn't running (graceful degradation — everything still works without the UI)

**3. Metro Map UI** (`src/bridge/ui/`)

A vanilla HTML/CSS/JS single-page app served by the bridge:
- Connects to the bridge via WebSocket
- Renders the metro map as an interactive SVG
- Supports zoom/pan (SVG transforms, no dependencies)
- Sends user actions (create branch, checkout, resolve, merge) back through WebSocket
- Shows branch detail sidebar, insight chips, hover cards

### New Dependency

`ws` — the standard Node.js WebSocket library. Zero transitive dependencies, battle-tested, required for the bridge.

### Data Migration

Existing sessions on disk have `Insight` objects without the `merged` field. The session loader (`loadSession` and the bridge's session initialization) must default `merged: false` on any insight missing the field. No migration script needed — handled at load time.

### Session Resolution

The `map` CLI command resolves the session from `process.cwd()` using the existing `sessionIdFromPath()` function, same as all other tools. The session ID is passed to the bridge server on startup. The bridge serves exactly one session at a time.

### Relationship to Timeline UI

The existing timeline UI (`npx neurobuttr-mcp ui`, port 3100) is a separate feature for reviewing captured Claude Code session logs. The metro map (`npx neurobuttr-mcp map`, port 3200) visualizes live conversation branching. Both can run simultaneously on different ports. They serve different purposes and do not interact.

---

## Action Type Tracking

The existing `Message` type has `role` and `content` but no structured action type. To render distinct station shapes, we need to classify what each message represents.

### Approach: Tag at Source

When `addMessage()` is called, the caller passes an optional `actionType` field. The MCP tools already know the action type (they're the ones calling Edit, Bash, etc.), so tagging happens naturally at the call site.

### `ActionType` Enum

```typescript
type ActionType =
  | "prompt"       // User message
  | "edit"         // Edit / Write tool
  | "bash"         // Bash tool
  | "search"       // Grep / Glob tool
  | "read"         // Read tool
  | "decision"     // Branch / checkout / resolve
  | "insight"      // Insight saved
  | "agent"        // Agent subagent dispatch
  | "other";       // Fallback
```

Added to the `Message` interface as `actionType?: ActionType`. Defaults to `"other"` if not set (backward compatible — existing messages without the field render as generic circles).

---

## Station Design System

The map uses a monochrome palette with a single accent. Shape encodes action type. Glow distinguishes agent from user.

### Shapes (action type)

| Shape | Action | `actionType` value |
|-------|--------|-------------------|
| Circle | Edit / Write (file changed) | `"edit"` |
| Square (rounded) | Bash (command executed) | `"bash"` |
| Triangle (equilateral) | Grep / Glob (search) | `"search"` |
| Circle (dashed) | Read (file read, no change) | `"read"` |
| Diamond (hollow) | Decision (branch / checkout / resolve) | `"decision"` |
| Diamond (filled) | Insight (saved finding) | `"insight"` |
| Circle | User prompt | `"prompt"` |
| Circle | Fallback | `"other"` |

### Color (who did it)

| Element | Style |
|---------|-------|
| User stations | Stroke `#6e7681` (gray), no glow, solid. Still anchors. |
| Agent stations | Stroke `#58a6ff` (blue), SVG drop-shadow glow. Pops like an LED. |
| Read stations | Stroke `#58a6ff`, dashed, softer glow. Passive action. |
| Main line | `#58a6ff` at low opacity |
| Branch lines | Same blue, curved paths using SVG cubic beziers |
| Merge points | `#238636` (green) with glow |

### Station Size

Stations are small markers (r=5-6 for circles, 10-12px for squares/triangles). The lines and flow are the hero — stations are waypoints, not destinations.

### Interaction

- **Hover** a station → tooltip card appears with action detail (file path, command, search pattern)
- **Click** a branch station → sidebar opens with branch context, activity trace, insights, merge/resolve buttons
- **Click** "+ Branch" in top bar → creates a new branch from current HEAD
- **Zoom/Pan** → scroll to zoom, drag to pan (SVG viewBox transforms)

---

## Metro Map Layout

### Main Line

Flows horizontally left to right. Each user prompt and agent action is a station along this line. Time moves rightward.

### Branches

When a branch is created, a curved path forks off the main line (upward or downward, alternating to avoid overlap). The branch has its own stations. Branch label appears at the fork point.

### Branch End States

| State | Visual |
|-------|--------|
| Active | Line continues, end station glows (pulsing) |
| Resolved | Line ends with hollow circle (explored, discarded) |
| Merged | Line curves back to main, green merge station on main line |

### Nested Branches

A branch can fork off another branch. The sub-branch curves further from the main line (greater vertical offset). Visual depth is limited to 3 levels.

### Layout Algorithm

1. Main line stations are spaced evenly along the x-axis
2. Branch fork points align with their parent station's x position
3. Branches curve using cubic bezier: `M fork C control1 control2 branchStart H branchEnd`
4. Upward branches use negative y-offset, downward use positive (alternating)
5. Merge curves: `M branchEnd C control1 control2 mergePoint` back to main line

### Layout Constants (implementer may tune)

| Constant | Value | Description |
|----------|-------|-------------|
| Station spacing | 50px | Horizontal distance between stations on a line |
| Branch y-offset | 80px | Vertical offset per nesting level |
| Bezier control offset | 30px | Control point distance for curve smoothness |
| Max nesting depth | 3 | Visual limit for nested branches |
| Station radius | 5-6px | Circle radius / shape bounding box |

When station count exceeds the viewport, the canvas scrolls horizontally (pan). No compression or station hiding — the map grows rightward.

---

## Bridge Protocol

### MCP Tools → Bridge

Sent when a tool mutates session state:

```typescript
type BridgeAction =
  | { action: "branch_created"; data: { branchId: string; branchName: string; parentMessageId: string; parentBranchId?: string; topic: string } }
  | { action: "checkout"; data: { branchId?: string } }  // undefined = main
  | { action: "message_added"; data: { messageId: string; branchId?: string; role: "user" | "assistant"; content: string; actionType: ActionType } }
  | { action: "branch_resolved"; data: { branchId: string; merge: boolean } }
  | { action: "insight_saved"; data: { insightId: string; content: string; sourceBranchId: string } }
  | { action: "insight_merged"; data: { branchId: string; insightIds: string[] } };
```

### Browser → Bridge

Sent when user interacts with the map:

```typescript
type UIAction =
  | { action: "create_branch"; data: { topic: string } }
  | { action: "checkout"; data: { branchId?: string } }
  | { action: "resolve"; data: { branchId: string } }
  | { action: "merge_insights"; data: { branchId: string } };
```

### Bridge → All Clients

On initial connection:
```typescript
{ type: "state", session: Session }
```

On every mutation:
```typescript
{ type: "patch", action: string, data: Record<string, unknown> }
```

### Bridge Client Connection Lifecycle

The bridge client (`bridge-client.ts`) maintains a **persistent singleton WebSocket connection** with lazy reconnection. On first use, it attempts to connect to `ws://127.0.0.1:{port}/ws`. If the connection succeeds, it stays open for the lifetime of the MCP server process. If the connection fails or drops, subsequent calls fall back to direct file I/O and retry the connection on the next call. No retry loops or polling — just attempt once per tool invocation.

### Graceful Degradation

If the bridge isn't running, MCP tools fall back to direct file I/O. This means:
- All existing functionality works without the bridge
- The bridge/UI is purely additive — opt-in by running `npx neurobuttr-mcp map`
- No startup ordering dependency

### UI Disconnection Handling

When the browser WebSocket connection drops:
- Live indicator changes to red dot + "Disconnected" text
- Map becomes read-only (action buttons disabled)
- Auto-retry every 2 seconds
- On reconnect, bridge sends full `{ type: "state" }` message to re-sync

---

## Insight Merge

This is the "PR merge" of conversation branching.

### During a Branch

Claude or the user saves insights via `remember_insight`. These are key findings, decisions, or conclusions from the exploration. Each insight is stored globally in `session.insights[]` with a `merged: boolean` field (default `false`) and a `sourceBranchId`.

### Merge Action

When the user clicks **Merge** on the map (or calls `nb_resolve` with `merge: true`):

1. All insights from the branch are tagged `merged: true`
2. A merge summary message is appended to the main thread with `role: "assistant"` and `actionType: "decision"`: `"Merged from [branch-name]: [insight 1], [insight 2]..."` — each insight truncated to 100 chars. Skipped if the branch has zero insights.
3. The branch is marked `resolved: true`
4. On the map, the branch line curves back and reconnects to the main line at the current HEAD with a green merge station

### Updated `nb_resolve` Tool Schema

The existing `nb_resolve` tool gains an optional `merge` parameter:

```typescript
{
  branch: z.string().optional(),
  merge: z.boolean().optional().describe("Merge insights to main before resolving (default: false)"),
  cwd: z.string().optional(),
}
```

### Where Merge Logic Lives

The merge logic is added to `session-manager.ts` as a new `resolveBranchWithMerge(sessionId, branchId, merge)` function (or by extending the existing `resolveBranch` with an options parameter). This function:
1. Finds all insights with `sourceBranchId === branchId`
2. If `merge: true`: sets `merged: true` on each, appends merge summary message to main
3. Marks branch `resolved: true`
4. Saves session

The tool handler in `branch-tools.ts` simply passes the `merge` flag through to the session manager.

### Resolve Without Merge

When the user clicks **Resolve** (no merge):

1. Branch is marked `resolved: true`
2. Insights remain saved but not injected into main context
3. On the map, the branch line ends (dead-end, hollow circle)

### What Merge Is NOT

- Does not replay branch messages into main thread
- Does not modify files or run git operations
- Purely about context — main thread gains the distilled findings so Claude can reference them going forward

---

## UI Components

### Top Bar
- Logo + project name
- Live connection indicator (green dot when bridge connected)
- Branch count, total action count
- "+ Branch" button

### Metro Map Canvas
- Full SVG metro map, pannable and zoomable
- Takes up most of the viewport
- Dark background (`#0a0e14`)

### Station Hover Card
- Appears on hover near the station
- Shows: action type, detail (file path / command / search pattern), timestamp
- For branch stations: shows checkout / resolve / merge actions

### Branch Sidebar (right)
- Opens when a branch is clicked
- Shows: branch name, anchor context, activity trace (list of actions with icons), insights, resolve/merge buttons
- Activity trace uses the same shape/color system as the map

### Insight Panel (bottom)
- Shows insight chips along the bottom
- Each chip shows: insight text, source branch, merged/pending status
- Gradient fade from transparent to background

---

## CLI Integration

```bash
npx neurobuttr-mcp map              # Launch bridge + open browser (port 3200)
npx neurobuttr-mcp map --port 4000  # Custom port
```

The `map` command:
1. Starts the bridge server
2. Opens the browser to `http://localhost:{port}`
3. Keeps running until Ctrl+C

If port is already in use (`EADDRINUSE`), prints an error with suggestion: `Port 3200 is already in use. Try: npx neurobuttr-mcp map --port 3300` and exits with code 1.

---

## File Structure

```
src/bridge/
├── server.ts          # HTTP server + WebSocket hub + session state
├── protocol.ts        # Message types and serialization
├── bridge-client.ts   # WS client used by MCP tools to connect to bridge
└── ui/
    └── index.html     # Metro map SPA (vanilla HTML/CSS/JS + inline SVG)
```

### Modified Files

- `src/core/session-manager.ts` — add bridge client integration (try WS, fall back to file), add `actionType` parameter to `addMessage`, add merge logic to `resolveBranch`
- `src/core/storage.ts` — add load-time defaulting for `insight.merged` (set `false` if missing)
- `src/core/types.ts` — add `merged` field to `Insight` type, add `ActionType` type, add optional `actionType` to `Message`
- `src/cli.ts` — add `map` command, update help text
- `src/tools/branch-tools.ts` — add `merge` parameter to `nb_resolve`
- `package.json` — add `ws` dependency, update postbuild to copy HTML

---

## Scope Boundaries

### In Scope
- Bridge server with WebSocket hub
- Metro map SVG rendering with station design system
- Two-way sync (MCP ↔ bridge ↔ browser)
- Zoom/pan interaction
- Branch create/checkout/resolve/merge from map
- Insight merge behavior
- Graceful degradation (works without bridge)
- `map` CLI command

### Out of Scope
- Multi-project view (one project at a time)
- Session replay / timeline integration
- Git operations from the map
- Authentication / remote access
- Mobile layout
- Persisted map layout positions
