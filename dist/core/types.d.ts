export type ActionType = "prompt" | "edit" | "bash" | "search" | "read" | "decision" | "insight" | "agent" | "other";
export interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    actionType?: ActionType;
    requiresApproval?: boolean;
    /** For agent tool calls, the subagent ID linking to subagent JSONL */
    agentId?: string;
    /** Which Claude Code chat session this message came from (JSONL filename stem) */
    sourceSessionId?: string;
    /** Original JSONL entry UUID — stable reference to the source data */
    sourceEntryUuid?: string;
    /** Short event key for referencing this event (e.g. "nb:a3f2c8") */
    eventKey?: string;
}
/** Metadata about a Claude Code chat session (one JSONL file = one chat) */
export interface ChatSession {
    id: string;
    label: string;
    color: string;
    startedAt: number;
    endedAt: number;
    messageCount: number;
}
export interface Branch {
    id: string;
    name: string;
    parentMessageId: string;
    parentBranchId?: string;
    anchorContext: string;
    anchorSnippet?: string;
    messages: Message[];
    resolved: boolean;
    topic?: string;
    createdAt: number;
}
export interface Insight {
    id: string;
    content: string;
    sourceBranchId: string;
    timestamp: number;
    merged: boolean;
}
export interface Session {
    id: string;
    projectPath: string;
    messages: Message[];
    branches: Branch[];
    insights: Insight[];
    chatSessions: ChatSession[];
    currentBranchId?: string;
    createdAt: number;
    updatedAt: number;
}
//# sourceMappingURL=types.d.ts.map