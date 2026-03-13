# Insight Management Skill

## When to Save Insights

**ALWAYS call `remember_insight` when you discover:**
- A key finding that answers the exploration question
- A decision and its rationale ("We chose X because Y")
- A failure reason ("Approach X doesn't work because Y")
- A pattern or best practice relevant to the project
- A trade-off worth remembering ("X is faster but Y is more maintainable")
- A dependency or constraint ("This requires Node 18+")

**DO NOT save insights for:**
- Trivial observations ("The file exists")
- Intermediate steps that only matter within the branch
- Information already well-known to the user

## Writing Good Insights

Insights must be **standalone** — readable and useful without branch context.

**Good insights:**
- "React Query v5 requires wrapping mutations in `useMutation` hooks; direct `fetch` calls bypass the cache invalidation"
- "The auth middleware checks JWT expiry but not revocation; adding a Redis blocklist would fix this"
- "Approach A (Redux Toolkit) adds ~12KB gzipped; Approach B (Zustand) adds ~1.5KB. Both solve the state problem equally well"

**Bad insights:**
- "This doesn't work" (no context — what doesn't work? why?)
- "See the code above" (insights must be standalone)
- "Interesting" (not actionable)

## When to Merge on Resolve

Use `nb_resolve({ merge_insights: true })` when:
- The branch discovered genuinely useful information
- The insights should inform the main conversation going forward
- You're comparing approaches and need findings visible on main

Use `nb_resolve({ merge_insights: false })` when:
- The branch was a dead end with no useful findings
- The exploration was purely mechanical (e.g., testing if something compiles)
- Insights are already captured and visible where needed

## Cross-Branch Review

Before making a recommendation, use `get_insights()` to review all insights across all branches. This ensures you don't miss findings from earlier explorations.

Pattern:
```
get_insights()
# Review all insights
# Present a summary comparing approaches with evidence from insights
# Recommend a path forward
```
