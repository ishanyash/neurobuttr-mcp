import type { Session, ActionType } from "../core/types.js";

// MCP tools → Bridge
export type BridgeAction =
  | {
      action: "branch_created";
      data: {
        branchId: string;
        branchName: string;
        parentMessageId: string;
        parentBranchId?: string;
        topic: string;
      };
    }
  | { action: "checkout"; data: { branchId?: string } }
  | {
      action: "message_added";
      data: {
        messageId: string;
        branchId?: string;
        role: "user" | "assistant";
        content: string;
        actionType?: ActionType;
      };
    }
  | { action: "branch_resolved"; data: { branchId: string; merge: boolean } }
  | {
      action: "insight_saved";
      data: { insightId: string; content: string; sourceBranchId: string };
    };

// Browser → Bridge
export type UIAction =
  | { action: "create_branch"; data: { topic: string } }
  | { action: "checkout"; data: { branchId?: string } }
  | { action: "resolve"; data: { branchId: string } }
  | { action: "merge_insights"; data: { branchId: string } };

// Bridge → All Clients
export type BridgeMessage =
  | { type: "state"; session: Session }
  | { type: "patch"; action: string; data: Record<string, unknown> };
