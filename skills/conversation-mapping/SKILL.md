# Conversation Mapping Skill

## When to Offer a Map

**Proactively offer `nb_map` when:**
- 3 or more branches exist in the session
- The user seems lost or asks "where are we?"
- Before making a major decision that depends on prior explorations
- The user asks for an overview or summary of what's been explored
- Resolving the final branch in a multi-branch comparison

**Don't generate a map when:**
- Only 1-2 branches exist (a simple status check suffices)
- The conversation is linear with no branching

## Presenting Map Output

When showing a map, highlight:
1. **Active branches** — what's still being explored
2. **Resolved branches** — what's been concluded
3. **Unmerged insights** — findings that haven't been carried to main yet
4. **Current position** — which branch the user is currently on

Example presentation:
```
Here's your conversation map:

[Mermaid diagram or ASCII output]

Summary:
- 2 active branches: `approach-redis`, `approach-postgres`
- 1 resolved (merged): `investigate-schema` — found that JSON columns work for this use case
- You're currently on: `approach-redis`
- 3 unmerged insights across active branches
```

## Map Formats

| Format | When to Use |
|---|---|
| `mermaid` (default) | Best for VS Code (writes `.neurobuttr/map.mmd` for preview) |
| `ascii` | When the user is in a terminal without Mermaid preview |
| `json` | When programmatic access to the graph is needed |

## nb_log vs nb_map

| Tool | Use When |
|---|---|
| `nb_log` | Quick status check — list branches with status and message counts |
| `nb_map` | Visual overview — see the conversation tree structure with relationships |

Use `nb_log` for quick orientation. Use `nb_map` when the structure itself matters.
