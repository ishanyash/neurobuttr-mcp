# Timeline Management Skill

## Capture Workflow

Use `nb_timeline_capture` to parse Claude Code session logs into structured timeline records.

```
# Capture the current session
nb_timeline_capture()

# Capture all available sessions
nb_timeline_capture({ all: true })
```

**When to capture:**
- At the end of a significant work session
- Before the user closes Claude Code (if they mention they're wrapping up)
- When the user asks to review what was done

## Review Workflow

Follow this sequence to review past sessions:

1. **List sessions** — Get an overview of all captured sessions
   ```
   nb_timeline_list()
   ```

2. **Show detail** — Drill into a specific session
   ```
   nb_timeline_show({ session_id: "..." })
   ```

3. **View diffs** — See the actual file changes
   ```
   nb_timeline_diff({ session_id: "..." })
   ```

## Rollback Workflow

**Prerequisites — always check before rollback:**
- The session has a `commitHash` (git-based rollback)
- The working tree is clean (`git status` shows no uncommitted changes)
- The user has confirmed they want to revert

**Steps:**
1. Show the user what will be reverted:
   ```
   nb_timeline_show({ session_id: "..." })
   nb_timeline_diff({ session_id: "..." })
   ```

2. **Ask for confirmation** — Rollback is destructive. Always confirm.

3. Execute rollback:
   ```
   nb_timeline_rollback({ session_id: "..." })
   ```

**Warnings to surface:**
- "This will create a new revert commit undoing the changes from session X"
- "If other sessions built on top of this one, their changes may conflict"
- "Consider creating a branch first if you want to preserve current state"

## Replay / Branch-from-Past Workflow

Use `nb_timeline_replay` to re-execute a session up to a specific action point, enabling "what if I had stopped here and done something different?"

```
# Replay up to action index 5
nb_timeline_replay({ session_id: "...", up_to_action: 5 })
```

**When to use replay:**
- The user wants to branch from a past decision point
- Exploring "what if we had taken a different approach at step X"
- Recovering partial work from a session that went wrong

## Annotation Patterns

Use `nb_timeline_annotate` to add metadata to captured sessions for future reference.

```
# Add tags for categorization
nb_timeline_annotate({ session_id: "...", tags: ["refactor", "auth"] })

# Add notes for context
nb_timeline_annotate({ session_id: "...", notes: "Refactored auth flow; broke SSO — see follow-up session" })
```

**Good annotation practices:**
- Tag sessions by domain area (e.g., `auth`, `api`, `frontend`, `database`)
- Tag sessions by type (e.g., `bugfix`, `feature`, `refactor`, `investigation`)
- Add notes explaining outcomes, especially for sessions that were rolled back or abandoned
