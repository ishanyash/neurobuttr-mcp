# Neurobuttr Timeline — Design Spec

**Date:** 2026-03-13
**Status:** Draft

---

## Context

When developers use Claude Code, the agent reads files, reasons, edits code, runs commands, and iterates. Git captures *what* changed but not *why* — not the decision trail, alternatives considered, or intermediate failures. Asking the agent "what did you do?" pollutes the working context and risks hallucinated recollections.

**Timeline** adds a session-aware metadata layer on top of Git. It parses Claude Code's JSONL session logs, extracts the full reasoning trail (prompts, tool calls, diffs, reasoning text), and exposes it through MCP tools so developers can review agent work without disrupting the agent.

This extends the existing neurobuttr-mcp server — no separate CLI or web UI needed for MVP.

---

## Architecture

### Approach: Internal Module Split

Timeline lives in `src/timeline/` as a self-contained module within the existing neurobuttr-mcp package. The MCP server (`src/index.ts`) registers timeline tools alongside existing conversation branching tools. One install, one MCP server, two feature sets.

### Data Flow

```
Claude Code session
    → JSONL logs written to ~/.claude/projects/{project-hash}/{uuid}.jsonl
        → nb_timeline_capture parses logs
            → TimelineSession JSON written to ~/.neurobuttr/timeline/{project-hash}/
                → nb_timeline_list/show/diff/rollback/replay read from storage
```

### Storage

All timeline data lives at `~/.neurobuttr/timeline/{project-hash}/`:

```
~/.neurobuttr/timeline/
  {project-hash}/
    sessions/
      {session-id}.json      # Full TimelineSession object
    index.json               # Summary index for fast listing
```

The neurobuttr project hash is derived from the project path using `sessionIdFromPath()` from `src/core/storage.ts` (SHA-256 of path, truncated). No project-local directories.

### Claude Code Project Hash Discovery

Claude Code stores logs at `~/.claude/projects/{hash}/` where `{hash}` is the absolute path with `/` replaced by `-` (e.g., `/Users/ishanyash/Documents/personal_gh/neurobuttr-mcp` → `-Users-ishanyash-Documents-personal-gh-neurobuttr-mcp`).

The capture tool computes this hash from `cwd`:

```typescript
function claudeProjectHash(cwd: string): string {
  return cwd.replace(/\//g, "-");
}
```

This is distinct from the neurobuttr project hash used for storage. The capture tool uses the Claude Code hash to *find* logs, and the neurobuttr hash to *store* parsed sessions.

---

## Data Model

### TimelineSession

```typescript
interface TimelineSession {
  id: string;                    // UUID from the JSONL filename
  projectPath: string;
  projectHash: string;
  prompt: string;                // First user message text
  model: string;                 // e.g. "claude-opus-4-6"
  claudeCodeVersion: string;     // e.g. "2.1.71"
  startedAt: number;             // timestamp ms
  completedAt: number;           // timestamp ms
  status: "completed" | "error" | "rolled_back";

  actions: TimelineAction[];     // Ordered list of agent operations

  gitBranch: string;             // Branch at session start
  gitCommitBefore: string | null;
  gitCommitAfter: string | null;

  filesRead: string[];           // All files the agent read
  filesModified: string[];       // Files actually changed

  summary: string;               // Auto-generated: prompt excerpt + stats

  // Session branching
  parentSessionId: string | null;
  branchPoint: number | null;    // Action index where branch diverged

  // User annotations
  tags: string[];
  notes: string;

  // Subagent sessions (if any)
  subagentSessions: TimelineSession[];
}
```

### TimelineAction (Discriminated Union)

```typescript
interface BaseAction {
  index: number;                 // Sequential position
  timestamp: number;
}

interface ReasoningAction extends BaseAction {
  type: "reasoning";
  reasoning: string;             // Assistant text between tool calls
}

interface ToolUseAction extends BaseAction {
  type: "tool_use";
  toolName: string;              // e.g. "Edit", "Write", "Bash", "Grep"
  toolInput: Record<string, any>;
  fileDiff: FileDiff | null;     // Present for Edit/Write tools
}

interface ToolResultAction extends BaseAction {
  type: "tool_result";
  toolUseId: string;             // Links to the tool_use that produced this
  toolOutput: string | null;     // Truncated if >10KB
  isError: boolean;
}

type TimelineAction = ReasoningAction | ToolUseAction | ToolResultAction;

interface FileDiff {
  path: string;
  type: "edit" | "create" | "delete";
  patch: string;                 // Unified diff format
}
```

### TimelineIndex

```typescript
interface TimelineIndex {
  version: 1;                   // Bump on schema changes
  sessions: TimelineIndexEntry[];
}

interface TimelineIndexEntry {
  id: string;
  prompt: string;               // Truncated to 200 chars
  model: string;
  startedAt: number;
  completedAt: number;
  status: "completed" | "error" | "rolled_back";
  filesModified: string[];
  actionCount: number;
  gitBranch: string;
}
```

---

## JSONL Parser

Located at `src/timeline/parser.ts`. Reads Claude Code's logs and produces `TimelineSession` objects.

### Input Format

Claude Code writes one JSONL file per session at `~/.claude/projects/{project-hash}/{uuid}.jsonl`. Each line is a JSON object with fields:

- `type`: "user" | "assistant" | "queue-operation" | "file-history-snapshot"
- `uuid`: message UUID
- `parentUuid`: parent message UUID
- `timestamp`: ISO 8601
- `sessionId`: session UUID
- `message.role`: "user" | "assistant"
- `message.content[]`: array of `{type: "text", text}`, `{type: "tool_use", name, input}`, `{type: "tool_result", content, is_error}`
- `message.model`: LLM model (assistant messages only)
- `version`: Claude Code version
- `gitBranch`: active git branch

### Parsing Algorithm

1. **Discover JSONL files** in `~/.claude/projects/{project-hash}/`
2. **Read each file** line by line, parse JSON
3. **Filter** to `type: "user"` and `type: "assistant"` entries
4. **Sort** by timestamp
5. **Extract prompt** from first user entry's `message.content[0].text`
6. **Walk entries chronologically**, building `TimelineAction[]`:
   - Assistant entry with `text` content block → `reasoning` action
   - Assistant entry with `tool_use` content block → `tool_use` action (name, input)
   - User entry with `tool_result` content block → `tool_result` action, linked to preceding `tool_use`
7. **Compute diffs** for file-modifying tool calls:
   - `Edit` tool: `old_string` → `new_string` at `file_path` → unified diff
   - `Write` tool: full file creation at `file_path`
   - `Bash` tool: capture command + output (diffs from git if needed)
8. **Collect metadata**: model, version, gitBranch, timestamps, file lists
9. **Detect already-captured sessions** by checking `index.json` — skip duplicates
10. **Skip active sessions**: If the last entry's timestamp is within 30 seconds of now, skip the file (session likely still running). Also skip if the last line is not valid JSON (file still being written).
11. **Version check**: Read the `version` field from entries. Log a warning if the format is unrecognized but attempt parsing anyway with graceful fallback — extract what we can and mark any parsing failures in the session record.
12. **Skip empty sessions**: Sessions with zero `tool_use` actions are skipped (user opened Claude Code but didn't do meaningful work).

### Diff Computation

Located at `src/timeline/diff-computer.ts`.

For `Edit` tool calls, the input contains `file_path`, `old_string`, `new_string`. We generate a unified diff showing the replacement in context. This doesn't require reading the actual file — the tool input has everything needed.

For `Write` tool calls, we show the content as a file creation (`--- /dev/null` → `+++ b/path`).

For `Bash` tool calls that modify files, we note the command but don't compute diffs (the user can check git for those).

### Subagent Handling

If a JSONL file `{uuid}.jsonl` has a corresponding directory `{uuid}/subagents/`, the parser reads each `agent-*.jsonl` file inside using the same parsing algorithm. These become nested `subagentSessions[]` on the parent `TimelineSession`. Subagent entries have `agentId` and `isSidechain: true` fields.

For MVP, subagent sessions are parsed but displayed as a flat list within the parent session's `nb_timeline_show` output. No separate navigation.

---

## MCP Tools

### nb_timeline_annotate

Add tags or notes to a captured session.

**Parameters:**
- `session_id` (string, required)
- `cwd` (string, optional)
- `tags` (string[], optional): Tags to add (appended to existing)
- `note` (string, optional): Note text (replaces existing)

**Returns:** Updated session summary.

### nb_timeline_capture

Parse uncaptured Claude Code session logs and store them.

**Parameters:**
- `cwd` (string, optional): Project directory. Auto-detected from `PROJECT_CWD` env.
- `all` (boolean, optional): Capture all uncaptured sessions. Default: capture only the latest.

**Returns:** Summary of captured sessions (count, prompts, files changed).

**Logic:**
1. Compute project hash from `cwd`
2. Find JSONL files in `~/.claude/projects/{project-hash}/`
3. Check `index.json` for already-captured session IDs
4. Parse uncaptured JSONL files into `TimelineSession` objects
5. Write session JSON files to `~/.neurobuttr/timeline/{project-hash}/sessions/`
6. Update `index.json`

### nb_timeline_list

List captured sessions for the current project.

**Parameters:**
- `cwd` (string, optional)
- `limit` (number, optional): Max sessions to return. Default: 10.
- `file_filter` (string, optional): Only show sessions that touched this file path.

**Returns:** Formatted list with: prompt (truncated), date, model, files changed count, status.

### nb_timeline_show

Show detailed session information — actions, reasoning, diffs.

**Parameters:**
- `session_id` (string, required)
- `cwd` (string, optional)
- `action_range` (string, optional): e.g. "0-10" to show only actions 0-10. Default: all.

**Returns:** Full action timeline with reasoning annotations and inline diffs.

### nb_timeline_diff

Show all file changes in a session as a unified diff.

**Parameters:**
- `session_id` (string, required)
- `cwd` (string, optional)
- `file_filter` (string, optional): Only show diffs for this file.

**Returns:** Unified diff of all file modifications, grouped by file.

### nb_timeline_rollback

Revert all changes from a session.

**Parameters:**
- `session_id` (string, required)
- `cwd` (string, optional)

**Logic:**
1. Load the session
2. Check preconditions:
   - Working tree must be clean (`git status --porcelain` is empty)
   - If `gitCommitAfter` exists, verify the commit is in current branch history
3. If `gitCommitAfter` exists and is reachable from HEAD, create a `git revert` commit
4. If changes were uncommitted, attempt `git apply --reverse --check` (dry run) first. If it fails (files were modified since the session), report the conflict and abort — don't force it.
5. Mark session status as `rolled_back`
6. Return summary of reverted changes

**Failure modes:**
- Dirty working tree → refuse, tell user to commit or stash first
- Files modified since session → report which files conflict, suggest manual resolution
- Commit not in history (e.g., branch was rebased) → refuse with explanation

**Returns:** List of files reverted, new git state.

### nb_timeline_replay

Show session state at a specific action index — for lightweight branching.

**Parameters:**
- `session_id` (string, required)
- `at_action` (number, required): Action index to replay up to.
- `cwd` (string, optional)

**Returns:**
- All actions up to `at_action` with reasoning and diffs
- List of files modified up to that point
- Context summary the user can paste into a new Claude Code prompt to "branch" from that point

---

## File Structure

```
src/
  timeline/
    types.ts                # TimelineSession, TimelineAction, FileDiff, TimelineIndex
    parser.ts               # JSONL log parser — reads ~/.claude/projects/
    diff-computer.ts        # Compute unified diffs from Edit/Write tool inputs
    storage.ts              # Read/write ~/.neurobuttr/timeline/{project-hash}/ (reuses sessionIdFromPath from core/storage.ts)
    tools/
      capture-tools.ts      # nb_timeline_capture
      review-tools.ts       # nb_timeline_list, nb_timeline_show, nb_timeline_diff
      annotate-tools.ts     # nb_timeline_annotate
      rollback-tools.ts     # nb_timeline_rollback
      replay-tools.ts       # nb_timeline_replay
  core/                     # Existing conversation branching (unchanged)
  tools/                    # Existing MCP tools (unchanged)
  map/                      # Existing map visualization (unchanged)
  index.ts                  # Updated: registers timeline tools alongside existing tools
  cli.ts                    # Updated: `init` command sets up timeline storage dir too
```

---

## Verification Plan

### Manual Testing

1. **Capture:** Run a Claude Code session on a test project, then call `nb_timeline_capture`. Verify session JSON is written with correct prompt, actions, diffs, and metadata.

2. **List:** Call `nb_timeline_list` after capturing multiple sessions. Verify chronological order, truncated prompts, file counts.

3. **Show:** Call `nb_timeline_show` with a session ID. Verify action timeline shows reasoning, tool calls, and inline diffs in order.

4. **Diff:** Call `nb_timeline_diff` with a session ID. Verify unified diff output matches actual file changes.

5. **Rollback:** Make a commit via Claude Code, capture it, then call `nb_timeline_rollback`. Verify files are reverted and session is marked `rolled_back`.

6. **Replay:** Call `nb_timeline_replay` at action index N. Verify only actions 0-N are shown and context summary is useful for starting a new session.

### Edge Cases

- Empty sessions (user started Claude Code but didn't do anything)
- Sessions with only reasoning, no tool calls
- Sessions with subagents
- Very large sessions (100+ actions) — verify truncation works
- Sessions where the JSONL file is still being written (agent is running)
- Multiple sessions on the same project captured at once

### Build Verification

```bash
npm run build              # TypeScript compiles without errors
npm start                  # MCP server starts and all tools are registered
```

---

## Implementation Order

1. **Types** (`types.ts`) — define all interfaces
2. **Diff computer** (`diff-computer.ts`) — pure function, no I/O
3. **Parser** (`parser.ts`) — JSONL reading + action extraction
4. **Storage** (`storage.ts`) — read/write session files + index
5. **Capture tool** (`capture-tools.ts`) — wire parser + storage
6. **Review tools** (`review-tools.ts`) — list, show, diff
7. **Rollback tool** (`rollback-tools.ts`) — git revert logic
8. **Replay tool** (`replay-tools.ts`) — lightweight branching
9. **Register in index.ts** — add all tools to MCP server
10. **Update cli.ts** — create timeline storage dir on init
11. **Test end-to-end** on real Claude Code sessions
