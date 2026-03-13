import type { Session, ActionType } from "./types.js";
/** Resolve the current session from a project path (cwd). Creates if needed. */
export declare function resolveSession(projectPath: string): Promise<Session>;
/** Legacy compat — resolve by explicit ID */
export declare function getOrCreateSession(sessionId: string): Promise<Session>;
export declare function addMessage(sessionId: string, role: "user" | "assistant", content: string, branchId?: string, actionType?: ActionType): Promise<{
    messageId: string;
}>;
export declare function createBranch(sessionId: string, anchorContext: string, parentMessageId?: string, parentBranchId?: string, branchName?: string, anchorSnippet?: string): Promise<{
    branchId: string;
    branchName: string;
    scopedContext: string;
}>;
export declare function checkoutBranch(sessionId: string, branchRef: string): Promise<{
    branchName: string;
    context: string;
}>;
export declare function getBranchContext(sessionId: string, branchId: string): Promise<string>;
export declare function resolveBranch(sessionId: string, branchId?: string, merge?: boolean): Promise<{
    resolved: string;
    merged: boolean;
    insightCount: number;
}>;
export declare function listBranches(sessionId: string): Promise<{
    id: string;
    name: string;
    anchorContext: string;
    anchorSnippet: string | null;
    topic: string;
    messageCount: number;
    resolved: boolean;
    isCurrent: boolean;
    parentBranchId?: string;
    createdAt: number;
}[]>;
export declare function rememberInsight(sessionId: string, branchId: string | undefined, content: string): Promise<{
    insightId: string;
}>;
export declare function getInsights(sessionId: string): Promise<{
    id: string;
    content: string;
    sourceBranch: string;
    timestamp: number;
}[]>;
export declare function getStatus(sessionId: string): Promise<{
    sessionId: string;
    currentBranch: string;
    mainMessages: number;
    totalBranches: number;
    activeBranches: number;
    resolvedBranches: number;
    insights: number;
}>;
//# sourceMappingURL=session-manager.d.ts.map