# Conversation Branching Skill

## When to Branch — Hard Rules

**ALWAYS create a branch when:**
- The user says "what if", "alternatively", "let's try", "could we instead"
- Comparing 2+ approaches to solving a problem
- About to make risky or experimental changes
- Going on a tangent or side investigation
- The user asks to explore something without committing to it

**DO NOT branch when:**
- The conversation is linear and straightforward
- The user is giving direct instructions with no alternatives
- You're just answering a question (no exploration involved)

## The "Comparing Approaches" Workflow

This is the most common multi-branch pattern:

1. **Branch per approach** — Create a branch for each approach being compared
   ```
   nb_branch({ name: "approach-redux" })
   nb_branch({ name: "approach-zustand" })
   ```

2. **Explore on each branch** — Switch between branches to explore each approach
   ```
   nb_checkout({ branch_name: "approach-redux" })
   # ... explore redux approach ...
   remember_insight({ content: "Redux requires more boilerplate but has better devtools" })

   nb_checkout({ branch_name: "approach-zustand" })
   # ... explore zustand approach ...
   remember_insight({ content: "Zustand is simpler but lacks middleware ecosystem" })
   ```

3. **Resolve with merge** — When done exploring, resolve branches and merge insights
   ```
   nb_checkout({ branch_name: "approach-redux" })
   nb_resolve({ merge_insights: true })

   nb_checkout({ branch_name: "approach-zustand" })
   nb_resolve({ merge_insights: true })
   ```

4. **Compare on main** — Back on main, use `get_insights` to compare and recommend
   ```
   nb_checkout({ branch_name: "main" })
   get_insights()
   # Now present a comparison using all gathered insights
   ```

## Navigation Commands

| Action | Tool Call |
|---|---|
| Create a branch | `nb_branch({ name: "descriptive-name" })` |
| Switch branches | `nb_checkout({ branch_name: "target-branch" })` |
| Return to main | `nb_checkout({ branch_name: "main" })` |
| See branch history | `nb_log()` |
| See current state | `nb_status()` |
| See branch context | `nb_context({ branch_name: "branch-name" })` |

## Branch Naming Conventions

Use descriptive, kebab-case names that indicate the exploration purpose:
- `approach-X` — for comparing solutions (e.g., `approach-redis`, `approach-postgres`)
- `investigate-X` — for debugging/research (e.g., `investigate-memory-leak`)
- `try-X` — for experimental changes (e.g., `try-new-api`)
- `tangent-X` — for side investigations (e.g., `tangent-auth-flow`)

## Principles

1. **Branch early** — Create the branch BEFORE starting exploration, not after you're deep in
2. **One focus per branch** — Each branch should explore one thing; create another for a different angle
3. **Always resolve** — Every branch should eventually be resolved; don't leave them dangling
4. **Announce branches** — Tell the user when you create or switch branches so they stay oriented
5. **Merge insights, not conversations** — The branch conversation stays on the branch; only insights carry forward
