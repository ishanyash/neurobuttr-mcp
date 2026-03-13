import type { Session, Branch, Message, Insight, ActionType } from "./types.js";
import { saveSession, loadSession, sessionIdFromPath } from "./storage.js";
import { generateId, now } from "../utils.js";
import { classifyTopic } from "../map/topic-classifier.js";
import { notifyBridge } from "../bridge/bridge-client.js";

// --- Auto session resolution ---

/** Resolve the current session from a project path (cwd). Creates if needed. */
export async function resolveSession(projectPath: string): Promise<Session> {
  const sessionId = sessionIdFromPath(projectPath);
  const existing = await loadSession(sessionId);
  if (existing) return existing;

  const session: Session = {
    id: sessionId,
    projectPath,
    messages: [],
    branches: [],
    insights: [],
    chatSessions: [],
    createdAt: now(),
    updatedAt: now(),
  };
  await saveSession(session);
  return session;
}

/** Legacy compat — resolve by explicit ID */
export async function getOrCreateSession(sessionId: string): Promise<Session> {
  const existing = await loadSession(sessionId);
  if (existing) return existing;

  const session: Session = {
    id: sessionId,
    projectPath: "",
    messages: [],
    branches: [],
    insights: [],
    chatSessions: [],
    createdAt: now(),
    updatedAt: now(),
  };
  await saveSession(session);
  return session;
}

// --- Branch name generation ---

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 30)
    .replace(/-$/, "");
}

function generateBranchName(anchorContext: string, existingNames: string[]): string {
  let base = slugify(anchorContext);
  if (!base) base = "explore";

  let name = base;
  let counter = 2;
  while (existingNames.includes(name)) {
    name = `${base}-${counter}`;
    counter++;
  }
  return name;
}

/** Find a branch by name or ID */
function findBranch(session: Session, ref: string): Branch | undefined {
  return (
    session.branches.find((b) => b.name === ref) ||
    session.branches.find((b) => b.id === ref)
  );
}

// --- Message operations ---

export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  branchId?: string,
  actionType?: ActionType
): Promise<{ messageId: string }> {
  const session = await getOrCreateSession(sessionId);
  const message: Message = {
    id: generateId(),
    role,
    content,
    timestamp: now(),
    ...(actionType ? { actionType } : {}),
  };

  if (branchId) {
    const branch = findBranch(session, branchId);
    if (!branch) throw new Error(`Branch "${branchId}" not found`);
    branch.messages.push(message);

    if (role === "user" && !branch.topic) {
      branch.topic = classifyTopic(content, branch.anchorContext);
    }
  } else {
    session.messages.push(message);
  }

  session.updatedAt = now();
  await saveSession(session);

  notifyBridge({
    action: "message_added",
    data: {
      messageId: message.id,
      branchId: branchId,
      role,
      content,
      actionType,
    },
  });

  return { messageId: message.id };
}

// --- Branch operations ---

export async function createBranch(
  sessionId: string,
  anchorContext: string,
  parentMessageId?: string,
  parentBranchId?: string,
  branchName?: string,
  anchorSnippet?: string
): Promise<{ branchId: string; branchName: string; scopedContext: string }> {
  const session = await getOrCreateSession(sessionId);

  // Auto-pick the last message if none specified
  const resolvedParentMsgId =
    parentMessageId || session.messages[session.messages.length - 1]?.id || "";

  const existingNames = session.branches.map((b) => b.name);
  const name = branchName
    ? (existingNames.includes(branchName) ? generateBranchName(branchName, existingNames) : branchName)
    : generateBranchName(anchorContext, existingNames);

  const branch: Branch = {
    id: generateId(),
    name,
    parentMessageId: resolvedParentMsgId,
    parentBranchId,
    anchorContext,
    anchorSnippet: anchorSnippet || undefined,
    messages: [],
    resolved: false,
    topic: classifyTopic(anchorContext),
    createdAt: now(),
  };

  session.branches.push(branch);
  session.currentBranchId = branch.id;
  session.updatedAt = now();
  await saveSession(session);

  notifyBridge({
    action: "branch_created",
    data: {
      branchId: branch.id,
      branchName: branch.name,
      parentMessageId: branch.parentMessageId,
      parentBranchId: branch.parentBranchId,
      topic: anchorContext,
    },
  });

  const scopedContext = buildScopedContext(session, branch);
  return { branchId: branch.id, branchName: name, scopedContext };
}

export async function checkoutBranch(
  sessionId: string,
  branchRef: string // name, id, or "main"
): Promise<{ branchName: string; context: string }> {
  const session = await loadSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  if (branchRef === "main") {
    session.currentBranchId = undefined;
    session.updatedAt = now();
    await saveSession(session);

    notifyBridge({
      action: "checkout",
      data: { branchId: undefined },
    });

    const lastMessages = session.messages.slice(-6);
    const context = lastMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    return { branchName: "main", context: context || "Empty main thread." };
  }

  const branch = findBranch(session, branchRef);
  if (!branch) throw new Error(`Branch "${branchRef}" not found. Use nb_log to see available branches.`);

  session.currentBranchId = branch.id;
  session.updatedAt = now();
  await saveSession(session);

  notifyBridge({
    action: "checkout",
    data: { branchId: session.currentBranchId },
  });

  return { branchName: branch.name, context: buildScopedContext(session, branch) };
}

export async function getBranchContext(
  sessionId: string,
  branchId: string
): Promise<string> {
  const session = await loadSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const branch = findBranch(session, branchId);
  if (!branch) throw new Error(`Branch "${branchId}" not found`);

  return buildScopedContext(session, branch);
}

export async function resolveBranch(
  sessionId: string,
  branchId?: string,
  merge: boolean = false
): Promise<{ resolved: string; merged: boolean; insightCount: number }> {
  const session = await loadSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const targetId = branchId || session.currentBranchId;
  if (!targetId) {
    throw new Error("No branch to resolve (on main thread)");
  }

  const branch = findBranch(session, targetId);
  if (!branch) {
    throw new Error(`Branch not found: ${targetId}`);
  }

  if (branch.resolved) {
    throw new Error(`Branch "${branch.name}" is already resolved`);
  }

  let insightCount = 0;

  if (merge) {
    // Find and tag insights from this branch
    const branchInsights = session.insights.filter(
      (i) => i.sourceBranchId === branch.id
    );
    insightCount = branchInsights.length;

    for (const insight of branchInsights) {
      insight.merged = true;
    }

    // Append merge summary to main thread if there are insights
    if (insightCount > 0) {
      const summaryParts = branchInsights.map((i) =>
        i.content.length > 100 ? i.content.slice(0, 100) + "..." : i.content
      );
      const summaryMsg: Message = {
        id: generateId(),
        role: "assistant",
        content: `Merged from "${branch.name}": ${summaryParts.join("; ")}`,
        timestamp: now(),
        actionType: "decision",
      };
      session.messages.push(summaryMsg);
    }
  }

  branch.resolved = true;

  // Switch back to main
  if (session.currentBranchId === branch.id) {
    session.currentBranchId = undefined;
  }

  session.updatedAt = now();
  await saveSession(session);

  notifyBridge({
    action: "branch_resolved",
    data: { branchId: branch.id, merge },
  });

  return { resolved: branch.name, merged: merge, insightCount };
}

export async function listBranches(
  sessionId: string
): Promise<
  {
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
  }[]
> {
  const session = await loadSession(sessionId);
  if (!session) return [];

  return session.branches.map((b) => ({
    id: b.id,
    name: b.name,
    anchorContext: b.anchorContext,
    anchorSnippet: b.anchorSnippet || null,
    topic: b.topic || "General",
    messageCount: b.messages.length,
    resolved: b.resolved,
    isCurrent: session.currentBranchId === b.id,
    parentBranchId: b.parentBranchId,
    createdAt: b.createdAt,
  }));
}

// --- Insight operations ---

export async function rememberInsight(
  sessionId: string,
  branchId: string | undefined,
  content: string
): Promise<{ insightId: string }> {
  const session = await loadSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const ref = branchId || session.currentBranchId;
  if (!ref) throw new Error("No branch specified and not on any branch.");

  const branch = findBranch(session, ref);
  if (!branch) throw new Error(`Branch "${ref}" not found`);

  const insight: Insight = {
    id: generateId(),
    content,
    sourceBranchId: branch.id,
    timestamp: now(),
    merged: false,
  };

  session.insights.push(insight);
  session.updatedAt = now();
  await saveSession(session);

  notifyBridge({
    action: "insight_saved",
    data: {
      insightId: insight.id,
      content: insight.content,
      sourceBranchId: insight.sourceBranchId,
    },
  });

  return { insightId: insight.id };
}

export async function getInsights(
  sessionId: string
): Promise<
  { id: string; content: string; sourceBranch: string; timestamp: number }[]
> {
  const session = await loadSession(sessionId);
  if (!session) return [];

  return session.insights.map((i) => {
    const branch = session.branches.find((b) => b.id === i.sourceBranchId);
    return {
      id: i.id,
      content: i.content,
      sourceBranch: branch?.name || branch?.anchorContext || i.sourceBranchId,
      timestamp: i.timestamp,
    };
  });
}

// --- Status ---

export async function getStatus(
  sessionId: string
): Promise<{
  sessionId: string;
  currentBranch: string;
  mainMessages: number;
  totalBranches: number;
  activeBranches: number;
  resolvedBranches: number;
  insights: number;
}> {
  const session = await loadSession(sessionId);
  if (!session) {
    return {
      sessionId,
      currentBranch: "main",
      mainMessages: 0,
      totalBranches: 0,
      activeBranches: 0,
      resolvedBranches: 0,
      insights: 0,
    };
  }

  const currentBranch = session.currentBranchId
    ? (findBranch(session, session.currentBranchId)?.name || "unknown")
    : "main";

  return {
    sessionId: session.id,
    currentBranch,
    mainMessages: session.messages.length,
    totalBranches: session.branches.length,
    activeBranches: session.branches.filter((b) => !b.resolved).length,
    resolvedBranches: session.branches.filter((b) => b.resolved).length,
    insights: session.insights.length,
  };
}

// --- Context scoping (ported from Neurobuttr's buildSideThreadSystemPrompt) ---

function buildScopedContext(session: Session, branch: Branch): string {
  let parentMessages: Message[];
  if (branch.parentBranchId) {
    const parentBranch = session.branches.find(
      (b) => b.id === branch.parentBranchId
    );
    parentMessages = parentBranch?.messages ?? [];
  } else {
    parentMessages = session.messages;
  }

  let relevantMessages = parentMessages;
  if (branch.parentMessageId) {
    const parentIndex = parentMessages.findIndex(
      (m) => m.id === branch.parentMessageId
    );
    if (parentIndex >= 0) {
      relevantMessages = parentMessages.slice(0, parentIndex + 1);
    }
  }

  // Also include branch's own messages
  const branchMessages = branch.messages;

  const contextLines = relevantMessages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const branchLines = branchMessages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  let result = "";
  if (contextLines) {
    result += `Parent context (up to branch point):\n\n---\n${contextLines}\n---\n\n`;
  }
  if (branchLines) {
    result += `Branch "${branch.name}" conversation:\n\n---\n${branchLines}\n---\n\n`;
  }
  if (branch.anchorSnippet) {
    result += `Branched from snippet:\n> ${branch.anchorSnippet}\n\n`;
  }
  result += `Exploring: "${branch.anchorContext}"`;

  return result || `No prior context available.\n\nExploring: "${branch.anchorContext}"`;
}
