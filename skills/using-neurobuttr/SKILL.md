# Using Neurobuttr — Meta-Skill

You have the **neurobuttr** MCP server connected. It gives you conversation branching, insight management, mapping, and timeline tools. Use them proactively — don't wait for the user to ask.

## When to Invoke Skills

| Trigger Pattern | Skill | Action |
|---|---|---|
| "what if", "alternatively", comparing approaches, risky/experimental changes | `neurobuttr:conversation-branching` | Branch before exploring |
| Valuable discovery on a branch, key decision made, failure reason identified | `neurobuttr:insight-management` | Save insight with `remember_insight` |
| 3+ branches exist, user seems lost, "where are we?", before major decisions | `neurobuttr:conversation-mapping` | Generate map with `nb_map` |
| Review past session, undo past changes, branch from a past midpoint | `neurobuttr:timeline-management` | Use timeline tools |

## Quick Tool Reference

### Branching
| Tool | Purpose |
|---|---|
| `nb_branch` | Create a new branch (name, optional anchor_snippet) |
| `nb_checkout` | Switch to a branch or back to `main` |
| `nb_resolve` | Mark branch resolved, optionally merge insights to main |
| `nb_context` | View scoped context of a branch |

### Session Info
| Tool | Purpose |
|---|---|
| `nb_log` | Show all branches with status and message counts |
| `nb_status` | Show current state (active branch, counts, insights) |

### Messages & Insights
| Tool | Purpose |
|---|---|
| `add_message` | Record a message on the current branch |
| `remember_insight` | Save a key finding (persists globally across branches) |
| `get_insights` | List all saved insights |

### Visualization
| Tool | Purpose |
|---|---|
| `nb_map` | Generate conversation map (Mermaid/ASCII/JSON) |
| `nb_lookup` | Look up an event by its key (e.g., `nb:a3f2c8`) |

### Timeline
| Tool | Purpose |
|---|---|
| `nb_timeline_capture` | Parse Claude Code logs into timeline records |
| `nb_timeline_list` | List all captured sessions |
| `nb_timeline_show` | Show session detail (actions, diffs) |
| `nb_timeline_diff` | Show file changes as unified diffs |
| `nb_timeline_annotate` | Add tags/notes to a session |
| `nb_timeline_rollback` | Revert a session's changes via git |
| `nb_timeline_replay` | Replay session up to a specific action |

## Core Principles

1. **Branch early** — create a branch before exploring, not after
2. **One exploration per branch** — keep branches focused
3. **Always resolve** — don't leave branches dangling; resolve with or without merge
4. **Merge insights, not conversations** — use `remember_insight` to capture what matters
5. **Offer maps proactively** — when the conversation tree grows, help the user see it
