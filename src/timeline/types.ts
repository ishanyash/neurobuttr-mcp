// Timeline types — version control metadata for Claude Code sessions

export interface FileDiff {
  path: string;
  type: "edit" | "create" | "delete";
  patch: string; // unified diff format
}

// Discriminated union for timeline actions
interface BaseAction {
  index: number;
  timestamp: number;
}

export interface ReasoningAction extends BaseAction {
  type: "reasoning";
  reasoning: string;
}

export interface ToolUseAction extends BaseAction {
  type: "tool_use";
  toolName: string;
  toolInput: Record<string, unknown>;
  fileDiff: FileDiff | null;
}

export interface ToolResultAction extends BaseAction {
  type: "tool_result";
  toolUseId: string;
  toolOutput: string | null; // truncated if >10KB
  isError: boolean;
}

export type TimelineAction = ReasoningAction | ToolUseAction | ToolResultAction;

export type TimelineSessionStatus = "completed" | "error" | "rolled_back";

export interface TimelineSession {
  id: string; // UUID from the JSONL filename
  projectPath: string;
  projectHash: string;
  prompt: string; // first user message text
  model: string;
  claudeCodeVersion: string;
  startedAt: number; // timestamp ms
  completedAt: number; // timestamp ms
  status: TimelineSessionStatus;

  actions: TimelineAction[];

  gitBranch: string;
  gitCommitBefore: string | null;
  gitCommitAfter: string | null;

  filesRead: string[];
  filesModified: string[];

  summary: string; // auto-generated

  // Session branching
  parentSessionId: string | null;
  branchPoint: number | null;

  // User annotations
  tags: string[];
  notes: string;

  // Subagent sessions
  subagentSessions: TimelineSession[];
}

export interface TimelineIndexEntry {
  id: string;
  prompt: string; // truncated to 200 chars
  model: string;
  startedAt: number;
  completedAt: number;
  status: TimelineSessionStatus;
  filesModified: string[];
  actionCount: number;
  gitBranch: string;
}

export interface TimelineIndex {
  version: 1;
  sessions: TimelineIndexEntry[];
}
