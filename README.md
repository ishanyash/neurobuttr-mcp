<p align="center">
  <img src="https://img.shields.io/npm/v/neurobuttr-mcp?style=flat-square&color=f59e0b" alt="npm version" />
  <img src="https://img.shields.io/npm/l/neurobuttr-mcp?style=flat-square&color=10b981" alt="license" />
  <img src="https://img.shields.io/badge/MCP-compatible-7c3aed?style=flat-square" alt="MCP compatible" />
  <img src="https://img.shields.io/badge/runtime-Node.js_18+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 18+" />
  <img src="https://img.shields.io/badge/TypeScript-5.7+-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<h1 align="center">neurobuttr-mcp</h1>

<p align="center">
  <strong>Git-like conversation branching, relationship mapping & session timeline for Claude Code.</strong>
</p>

<p align="center">
  Branch off to explore tangents. Switch back to your main thread.<br/>
  Capture session history. Visualize everything as an interactive metro map.
</p>

---

## Quick Start

```bash
npx neurobuttr-mcp init
```

Restart Claude Code. That's it — available in **every project**, globally.

---

## Why neurobuttr?

When you're deep in a Claude Code conversation and want to explore a side topic — a different architecture, an alternative library, a risky refactor — you shouldn't have to lose your place. neurobuttr gives your conversations the same branching power that git gives your code.

```
You: "Let's branch off and explore what if we use Rust instead"
     → Creates a branch, scopes the context, explores Rust

You: "Good findings. Remember that Rust eliminates our GC pause issue"
     → Saves the insight, accessible from any branch

You: "Let's go back to the main thread"
     → Switches back — main conversation untouched

You: "Show me the conversation map"
     → Generates a visual tree of all branches and insights
```

No external services. No API calls. **Fully offline.** Data stays on your machine at `~/.neurobuttr/`.

---

## Features

### Conversation Branching

Create, switch, and resolve conversation branches just like git branches. Each branch gets its own temporally-isolated context — it only sees messages up to the point where it branched off.

### Insight Memory

Save key findings from any branch back to the main thread. Insights persist globally and are visible from any branch, acting as a shared knowledge base across explorations.

### Visual Conversation Maps

Generate Mermaid diagrams, ASCII trees, or JSON graph data to visualize your entire conversation structure — branches, insights, topics, and their relationships.

### Session Timeline

Parse and review Claude Code session logs as structured timelines. See exactly what the agent did: prompts, tool calls, reasoning, and file diffs. Annotate sessions, roll back changes, or replay from any point.

### Live Metro Map UI

Launch an interactive browser-based metro map that updates in real-time via WebSocket as your conversation evolves.

### Timeline Review UI

Browse captured sessions in a GitHub-style commit history view with full action breakdowns, file modifications, and metadata.

---

## Installation

### Prerequisites

- **Node.js** 18 or later
- **Claude Code** CLI

### Install globally via npx

```bash
npx neurobuttr-mcp init
```

This command:

1. Adds `neurobuttr` to `~/.claude.json` under `mcpServers`
2. Creates storage directories at `~/.neurobuttr/sessions/` and `~/.neurobuttr/timeline/`
3. Adds `.neurobuttr/` to your global gitignore

Then **restart Claude Code** to activate.

### Install from source

```bash
git clone https://github.com/ishanyash/neurobuttr-mcp.git
cd neurobuttr-mcp
npm install
npm run build
npx neurobuttr-mcp init
```

---

## Tools Reference

You don't need to call these directly — just describe what you want in natural language and Claude will use the right tool.

### Conversation Branching

| Tool | Description | Git Analogy |
|------|-------------|-------------|
| `nb_branch` | Create a new branch to explore a tangent | `git checkout -b` |
| `nb_checkout` | Switch between branches or back to main | `git checkout` |
| `nb_resolve` | Mark a branch as done, optionally merge insights | Closing a PR |
| `nb_context` | View the full scoped context of a branch | `git log` on a branch |

### Session Overview

| Tool | Description | Git Analogy |
|------|-------------|-------------|
| `nb_log` | Show all branches with status, topics, message counts | `git log --graph` |
| `nb_status` | Current branch, message counts, active branches | `git status` |

### Messages & Insights

| Tool | Description | Git Analogy |
|------|-------------|-------------|
| `add_message` | Record a message on the current branch or main | Adding a commit |
| `remember_insight` | Save a key finding from a branch | `git stash` for knowledge |
| `get_insights` | List all insights across all branches | Viewing stashed items |

### Visualization

| Tool | Description |
|------|-------------|
| `nb_map` | Generate a conversation map (Mermaid `.mmd`, ASCII, or JSON) |
| `nb_lookup` | Look up an event by its key from the metro map UI |

### Session Timeline

| Tool | Description |
|------|-------------|
| `nb_timeline_capture` | Parse Claude Code logs into structured timeline records |
| `nb_timeline_list` | List captured sessions with metadata and filters |
| `nb_timeline_show` | Show full session detail — actions, reasoning, diffs |
| `nb_timeline_diff` | Show all file changes as unified diffs |
| `nb_timeline_annotate` | Add tags or notes to a captured session |
| `nb_timeline_rollback` | Revert a session's file changes (git revert or reverse-apply) |
| `nb_timeline_replay` | Replay a session up to a specific action for lightweight branching |

---

## CLI Commands

```
neurobuttr-mcp — Conversation branching & timeline for Claude Code

Commands:
  init            Set up neurobuttr MCP server globally
  ui [--port N]   Open timeline review UI in browser (default: port 3100)
  map [--port N]  Open live metro map in browser (default: port 3200)
  help            Show help message
```

### Launch the Metro Map

```bash
npx neurobuttr-mcp map
```

Opens an interactive browser-based conversation map at `http://localhost:3200` with real-time WebSocket updates.

### Launch the Timeline UI

```bash
npx neurobuttr-mcp ui
```

Opens a session history viewer at `http://localhost:3100` for browsing captured Claude Code sessions.

---

## Usage Examples

### Exploring alternative approaches

```
You: "Let's branch off and explore a Redis-based caching approach"
     → nb_branch creates "approach-redis", scopes context

You: "This looks promising — remember that Redis gives us sub-ms reads"
     → remember_insight saves the finding

You: "Now let's try a local cache approach"
     → nb_checkout main, then nb_branch creates "approach-local-cache"

You: "Let's compare both approaches"
     → nb_log shows all branches; get_insights shows saved findings
```

### Investigating a bug

```
You: "Branch off to investigate the memory leak"
     → nb_branch creates "investigate-memory-leak"

You: "Found it — the event listener isn't being cleaned up. Remember this."
     → remember_insight saves the root cause

You: "Back to main, let's fix it"
     → nb_checkout main, fix applied with context from the insight
```

### Reviewing session history

```
You: "Capture the timeline for this session"
     → nb_timeline_capture parses Claude Code logs

You: "Show me what the last session did"
     → nb_timeline_show displays actions, reasoning, and diffs

You: "That refactor broke things — roll it back"
     → nb_timeline_rollback reverts the session's changes

You: "Replay that session up to action 5 and try a different approach"
     → nb_timeline_replay provides context to branch from that point
```

### Branch naming conventions

| Pattern | Use Case | Example |
|---------|----------|---------|
| `approach-*` | Comparing solutions | `approach-redis`, `approach-sqlite` |
| `investigate-*` | Debugging / research | `investigate-memory-leak` |
| `try-*` | Experimental changes | `try-streaming-api` |
| `tangent-*` | Side investigations | `tangent-auth-flow` |

---

## Visual Map

Install the [Mermaid Preview](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid) VS Code extension. When you ask for the conversation map, neurobuttr writes a `.neurobuttr/map.mmd` file you can preview as an interactive diagram.

You can also run `npx neurobuttr-mcp map` to open the live metro map in your browser — it updates in real-time as the conversation evolves.

---

## Architecture

```
neurobuttr-mcp
├── src/
│   ├── index.ts              MCP server entry point (stdio transport)
│   ├── cli.ts                CLI: init, ui, map, help
│   ├── core/
│   │   ├── types.ts          Data types (Session, Branch, Message, Insight)
│   │   ├── session-manager.ts  Branch/session/insight logic
│   │   └── storage.ts        JSON file persistence (~/.neurobuttr/sessions/)
│   ├── tools/
│   │   ├── branch-tools.ts   nb_branch, nb_checkout, nb_resolve, nb_context
│   │   ├── session-tools.ts  nb_log, nb_status
│   │   ├── message-tools.ts  add_message, remember_insight, get_insights
│   │   ├── map-tools.ts      nb_map
│   │   └── lookup-tools.ts   nb_lookup
│   ├── map/
│   │   ├── graph-builder.ts  Builds node/edge graph from session data
│   │   ├── map-renderer.ts   Renders Mermaid, ASCII, or JSON output
│   │   └── topic-classifier.ts  NLP keyword extraction & topic normalization
│   ├── timeline/
│   │   ├── tools/            Timeline capture, review, annotate, rollback, replay
│   │   ├── parser.ts         Claude Code JSONL log parser
│   │   ├── diff-computer.ts  Unified diff generation for file changes
│   │   ├── storage.ts        Timeline-specific persistence
│   │   ├── types.ts          Timeline data types
│   │   └── ui/               Timeline review web UI
│   └── bridge/
│       ├── server.ts         HTTP + WebSocket server for live metro map
│       ├── bridge-client.ts  MCP → bridge real-time notification client
│       ├── protocol.ts       Bridge message types
│       └── ui/               Interactive metro map web UI
├── agents/
│   └── branch-reviewer.md    Agent spec for reviewing multi-branch explorations
├── commands/
│   ├── branch.md             /branch slash command
│   └── map.md                /map slash command
└── skills/
    ├── conversation-branching/  Branching workflow skill
    ├── conversation-mapping/    Mapping skill
    ├── insight-management/      Insight management skill
    ├── timeline-management/     Timeline skill
    └── using-neurobuttr/        Meta-skill for all neurobuttr tools
```

### How it works

- **Sessions** are scoped per project directory (derived from `cwd` via SHA-256 hash)
- **Branch context** is temporally isolated — branches only see messages up to their branch point
- **Insights** persist globally within a session and are visible from any branch
- **Data** is stored locally as JSON at `~/.neurobuttr/sessions/`
- **Timeline data** lives at `~/.neurobuttr/timeline/`
- **The MCP server** communicates over stdio, registered globally in `~/.claude.json`
- **The metro map UI** uses WebSocket for real-time updates as branches are created and switched
- **Topic classification** uses NLP keyword extraction with curated dictionaries and stemming

---

## Slash Commands

neurobuttr ships with built-in slash commands for common workflows:

| Command | Action |
|---------|--------|
| `/branch [name]` | Create a new branch (auto-names from context if no name given) |
| `/map [format]` | Generate conversation map (default: Mermaid, options: `ascii`, `json`) |

---

## Agents

### Branch Reviewer

The `branch-reviewer` agent reviews multi-branch explorations and recommends the best approach. It gathers insights, inspects each branch's context, and produces a comparison table with cleanup suggestions.

---

## Data Storage

All data is stored locally on your machine:

| Path | Contents |
|------|----------|
| `~/.neurobuttr/sessions/` | Session data (branches, messages, insights) as JSON |
| `~/.neurobuttr/timeline/` | Captured timeline records |
| `~/.claude.json` | MCP server registration |
| `.neurobuttr/map.mmd` | Per-project Mermaid conversation map (gitignored) |

---

## Uninstall

Remove the `neurobuttr` entry from `~/.claude.json` under `mcpServers`:

```bash
# Or manually edit ~/.claude.json and remove the "neurobuttr" key from "mcpServers"
```

Optionally remove stored data:

```bash
rm -rf ~/.neurobuttr
```

---

## License

[MIT](LICENSE)
