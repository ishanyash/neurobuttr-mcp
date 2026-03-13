export interface FileDiff {
    path: string;
    type: "edit" | "create" | "delete";
    patch: string;
}
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
    toolOutput: string | null;
    isError: boolean;
}
export type TimelineAction = ReasoningAction | ToolUseAction | ToolResultAction;
export type TimelineSessionStatus = "completed" | "error" | "rolled_back";
export interface TimelineSession {
    id: string;
    projectPath: string;
    projectHash: string;
    prompt: string;
    model: string;
    claudeCodeVersion: string;
    startedAt: number;
    completedAt: number;
    status: TimelineSessionStatus;
    actions: TimelineAction[];
    gitBranch: string;
    gitCommitBefore: string | null;
    gitCommitAfter: string | null;
    filesRead: string[];
    filesModified: string[];
    summary: string;
    parentSessionId: string | null;
    branchPoint: number | null;
    tags: string[];
    notes: string;
    subagentSessions: TimelineSession[];
}
export interface TimelineIndexEntry {
    id: string;
    prompt: string;
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
export {};
//# sourceMappingURL=types.d.ts.map