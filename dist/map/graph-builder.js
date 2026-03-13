// Graph builder — ported from Neurobuttr's app/src/lib/graph.ts
// Builds nodes + edges from session data for relationship map rendering.
import { extractNormalizedKeywords, extractWeightedKeywords, normalizeTopicsAcrossNodes, } from "./topic-classifier.js";
import { truncate } from "../utils.js";
// Compute nesting depth of a branch
function computeDepth(branch, branches) {
    if (!branch.parentBranchId)
        return 1;
    const parent = branches.find((b) => b.id === branch.parentBranchId);
    if (!parent)
        return 1;
    return computeDepth(parent, branches) + 1;
}
function groupIntoTurns(messages) {
    const turns = [];
    let i = 0;
    while (i < messages.length) {
        const msg = messages[i];
        if (msg.role === "user") {
            const next = messages[i + 1];
            if (next && next.role === "assistant") {
                turns.push({ userMessage: msg, assistantMessage: next });
                i += 2;
            }
            else {
                turns.push({ userMessage: msg, assistantMessage: null });
                i += 1;
            }
        }
        else if (msg.role === "assistant") {
            turns.push({ userMessage: null, assistantMessage: msg });
            i += 1;
        }
        else {
            i += 1;
        }
    }
    return turns;
}
export function buildGraph(session) {
    const nodes = [];
    const edges = [];
    const nodeKeywordsList = [];
    // --- Build spine from main thread ---
    const turns = groupIntoTurns(session.messages);
    const messageToSpine = new Map();
    const spineNodeIds = [];
    turns.forEach((turn, index) => {
        const spineId = `spine-${index}`;
        spineNodeIds.push(spineId);
        if (turn.userMessage)
            messageToSpine.set(turn.userMessage.id, spineId);
        if (turn.assistantMessage)
            messageToSpine.set(turn.assistantMessage.id, spineId);
        const userQ = turn.userMessage?.content || "";
        const assistantA = turn.assistantMessage?.content || "";
        const label = truncate(userQ || `Turn ${index + 1}`, 40);
        const questionSnippet = truncate(userQ, 80);
        const answerSnippet = truncate(assistantA, 80);
        const summary = answerSnippet
            ? `Q: "${questionSnippet}"\nA: ${answerSnippet}`
            : `Q: "${questionSnippet}"`;
        const keywords = extractNormalizedKeywords(userQ);
        nodeKeywordsList.push({ nodeId: spineId, keywords });
        nodes.push({
            id: spineId,
            type: "spine",
            depth: 0,
            label,
            summary,
            topic: "",
            messageCount: (turn.userMessage ? 1 : 0) + (turn.assistantMessage ? 1 : 0),
            resolved: false,
            anchorContext: null,
            anchorSnippet: null,
            spineIndex: index,
        });
    });
    // Spine edges (sequential)
    for (let i = 0; i < spineNodeIds.length - 1; i++) {
        edges.push({ source: spineNodeIds[i], target: spineNodeIds[i + 1] });
    }
    // --- Build branch nodes ---
    for (const branch of session.branches) {
        const depth = computeDepth(branch, session.branches);
        const userMsgs = branch.messages.filter((m) => m.role === "user");
        const assistantMsgs = branch.messages.filter((m) => m.role === "assistant");
        const firstQuestion = userMsgs[0]?.content || branch.anchorContext || "";
        const lastAnswer = assistantMsgs[assistantMsgs.length - 1]?.content || "";
        const label = truncate(branch.name || firstQuestion || "Exploration", 40);
        const questionSnippet = truncate(firstQuestion, 80);
        const answerSnippet = truncate(lastAnswer, 80);
        const summary = answerSnippet
            ? `"${questionSnippet}"\n→ ${answerSnippet}`
            : `"${questionSnippet}"`;
        let branchKeywords;
        if (branch.topic) {
            branchKeywords = [branch.topic];
        }
        else {
            const userText = userMsgs.map((m) => m.content).join(" ");
            branchKeywords = extractWeightedKeywords([
                { text: userText, weight: 3 },
                { text: branch.anchorContext || "", weight: 1 },
            ]);
        }
        nodeKeywordsList.push({ nodeId: branch.id, keywords: branchKeywords });
        nodes.push({
            id: branch.id,
            type: "branch",
            depth,
            label,
            summary,
            topic: "",
            messageCount: branch.messages.length,
            resolved: branch.resolved,
            anchorContext: branch.anchorContext,
            anchorSnippet: branch.anchorSnippet || null,
            branchId: branch.id,
        });
        // Connect to parent
        if (branch.parentBranchId) {
            edges.push({ source: branch.parentBranchId, target: branch.id });
        }
        else {
            const spineId = messageToSpine.get(branch.parentMessageId);
            if (spineId) {
                edges.push({ source: spineId, target: branch.id });
            }
            else if (spineNodeIds.length > 0) {
                edges.push({
                    source: spineNodeIds[spineNodeIds.length - 1],
                    target: branch.id,
                });
            }
        }
    }
    // --- Pass 2: Normalize topics ---
    const topicAssignments = normalizeTopicsAcrossNodes(nodeKeywordsList);
    const topicCounts = {};
    for (const node of nodes) {
        node.topic = topicAssignments[node.id] || "General";
        topicCounts[node.topic] = (topicCounts[node.topic] || 0) + 1;
    }
    // Filter invalid edges
    const nodeIds = new Set(nodes.map((n) => n.id));
    const validEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    const topics = Object.entries(topicCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    return {
        nodes,
        edges: validEdges,
        stats: {
            mainMessages: session.messages.length,
            branches: session.branches.length,
            insights: session.insights.length,
            topics,
        },
    };
}
//# sourceMappingURL=graph-builder.js.map