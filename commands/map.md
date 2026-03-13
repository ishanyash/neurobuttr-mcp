# /map Command

Generate and display a conversation map showing the current branching structure.

## Behavior

When the user runs `/map`, do the following:

1. Call `nb_map()` to generate a conversation map (defaults to Mermaid format)
2. Present the map output inline
3. Add a brief summary highlighting:
   - Number of active vs resolved branches
   - Current branch position
   - Any unmerged insights
   - Branches that may need attention (stale, unresolved)

## Format Options

- `/map` → Default Mermaid format (also writes `.neurobuttr/map.mmd`)
- `/map ascii` → ASCII format for terminal display
- `/map json` → JSON format for programmatic use
