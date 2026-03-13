# neurobuttr-mcp

Git-like conversation branching for Claude Code. Branch off to explore tangents, switch back to your main thread, and visualize the conversation structure.

## Install

```bash
npx neurobuttr-mcp init
```

Then restart Claude Code. That's it — available in every project.

## What it does

When you're deep in a Claude Code conversation and want to explore a side topic without losing your place:

```
You: "Let's branch off and explore what if we use Rust instead"
     → Claude creates a branch, scopes the context, explores Rust

You: "Good findings. Remember that Rust eliminates our GC pause issue"
     → Claude saves the insight

You: "Let's go back to the main thread"
     → Claude switches back, main conversation untouched

You: "Show me the conversation map"
     → Claude generates a visual tree of all branches
```

## Tools

| Tool | What it does |
|------|-------------|
| `nb_branch` | Branch off to explore a tangent (like `git checkout -b`) |
| `nb_checkout` | Switch between branches and main (like `git checkout`) |
| `nb_log` | See all branches at a glance (like `git log --graph`) |
| `nb_status` | Current conversation state (like `git status`) |
| `nb_map` | Visual conversation map (writes `.mmd` file for Mermaid Preview) |
| `nb_resolve` | Mark a branch as done |
| `remember_insight` | Save a key finding from a branch back to main |
| `get_insights` | View all saved insights across branches |

You don't need to call these directly — just describe what you want in natural language.

## How it works

- Sessions are scoped per project directory (auto-detected from cwd)
- Branch context is temporally isolated — branches only see messages up to their branch point
- Insights persist globally and are visible from any branch
- Data stored locally at `~/.neurobuttr/sessions/`
- No external services, no API calls, fully offline

## Visual map

Install the [Mermaid Preview](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid) VS Code extension. When you ask for the conversation map, neurobuttr writes a `.neurobuttr/map.mmd` file you can preview as an interactive diagram.

## Uninstall

Remove the `neurobuttr` entry from `~/.claude.json` under `mcpServers`.

## License

MIT
