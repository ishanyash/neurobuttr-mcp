# /branch Command

Create a new conversation branch for exploring an alternative approach.

## Behavior

When the user runs `/branch`, do the following:

1. If the user provided a branch name as an argument (e.g., `/branch try-new-api`), use that name
2. If no name was provided, infer a descriptive name from the current conversation context
3. Call `nb_branch({ name: "<branch-name>" })` to create the branch
4. Confirm the branch was created and explain that the user is now on the new branch
5. Ask what they'd like to explore on this branch

## Examples

- `/branch` → Infer name from context, create branch
- `/branch approach-redis` → Create branch named "approach-redis"
- `/branch investigate-perf` → Create branch named "investigate-perf"
