// Renders graph data as Mermaid (.mmd file), ASCII, or JSON.
import { truncate } from "../utils.js";
// --- Mermaid (.mmd file format — no markdown fences) ---
export function renderMermaid(graph, insights = []) {
    const { nodes, edges, stats } = graph;
    if (nodes.length === 0)
        return "graph TD\n  empty[No data yet]";
    const lines = ["graph TD"];
    // Sanitize text for Mermaid (escape quotes, remove newlines)
    const sanitize = (s) => s.replace(/"/g, "'").replace(/\n/g, " ");
    // Node definitions
    for (const node of nodes) {
        const label = sanitize(truncate(node.label, 35));
        if (node.type === "spine") {
            const idx = (node.spineIndex ?? 0) + 1;
            lines.push(`  ${node.id}["${idx}. ${label}"]`);
        }
        else {
            const suffix = node.resolved ? " done" : "";
            const msgCount = `${node.messageCount} msgs`;
            const topic = node.topic && node.topic !== "General" ? ` | ${node.topic}` : "";
            const snippetTag = node.anchorSnippet ? " | snippet" : "";
            lines.push(`  ${node.id}["${label}<br/>${msgCount}${topic}${snippetTag}${suffix}"]`);
        }
    }
    lines.push("");
    // Edges
    for (const edge of edges) {
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (targetNode?.type === "branch") {
            lines.push(`  ${edge.source} -. branch .-> ${edge.target}`);
        }
        else {
            lines.push(`  ${edge.source} --> ${edge.target}`);
        }
    }
    // Styling
    lines.push("");
    for (const node of nodes) {
        if (node.type === "spine") {
            lines.push(`  style ${node.id} fill:#0D9488,stroke:#14B8A6,color:#fff`);
        }
        else if (node.resolved) {
            lines.push(`  style ${node.id} fill:#22C55E,stroke:#4ADE80,color:#fff`);
        }
        else {
            lines.push(`  style ${node.id} fill:#0891B2,stroke:#06B6D4,color:#fff`);
        }
    }
    // Insights as a subgraph if any exist
    if (insights.length > 0) {
        lines.push("");
        lines.push("  subgraph Insights");
        lines.push("    direction LR");
        for (let i = 0; i < insights.length; i++) {
            const content = sanitize(truncate(insights[i].content, 50));
            lines.push(`    insight${i}(["${content}"])`);
            lines.push(`    style insight${i} fill:#F59E0B,stroke:#FBBF24,color:#000`);
        }
        lines.push("  end");
    }
    return lines.join("\n");
}
// --- ASCII ---
export function renderAscii(graph, insights = []) {
    const { nodes, edges, stats } = graph;
    if (nodes.length === 0)
        return "No data yet.";
    const lines = [];
    lines.push(`Main Thread (${stats.mainMessages} messages, ${stats.branches} branches)`);
    // Build adjacency: parent → children
    const children = new Map();
    for (const edge of edges) {
        const list = children.get(edge.source) || [];
        list.push(edge.target);
        children.set(edge.source, list);
    }
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    // Render spine nodes with their branch children
    const spineNodes = nodes
        .filter((n) => n.type === "spine")
        .sort((a, b) => (a.spineIndex ?? 0) - (b.spineIndex ?? 0));
    for (let i = 0; i < spineNodes.length; i++) {
        const spine = spineNodes[i];
        const isLast = i === spineNodes.length - 1;
        const prefix = isLast ? "└─" : "├─";
        const label = truncate(spine.label, 50);
        lines.push(`${prefix} [${(spine.spineIndex ?? 0) + 1}] ${label}`);
        // Render branch children recursively
        const branchChildren = children.get(spine.id) || [];
        renderBranchChildren(branchChildren, nodeMap, children, lines, isLast ? "   " : "│  ", 0);
    }
    // Insights
    if (insights.length > 0) {
        lines.push("");
        lines.push(`Insights (${insights.length}): ${insights.map((i) => `"${truncate(i.content, 40)}"`).join(", ")}`);
    }
    // Topics
    if (stats.topics.length > 0) {
        const topicStr = stats.topics
            .slice(0, 5)
            .map((t) => `${t.name} (${t.count})`)
            .join(", ");
        lines.push(`Topics: ${topicStr}`);
    }
    return lines.join("\n");
}
function renderBranchChildren(childIds, nodeMap, children, lines, indent, depth) {
    for (let i = 0; i < childIds.length; i++) {
        const node = nodeMap.get(childIds[i]);
        if (!node || node.type === "spine")
            continue;
        const isLast = i === childIds.length - 1;
        const prefix = isLast ? "└─" : "├─";
        const resolved = node.resolved ? ", resolved ✓" : "";
        const topic = node.topic && node.topic !== "General" ? ` [${node.topic}]` : "";
        const label = truncate(node.label, 40);
        lines.push(`${indent}${prefix} 🔀 ${label} (${node.messageCount} msgs${resolved})${topic}`);
        if (node.anchorSnippet) {
            const snippetPreview = truncate(node.anchorSnippet, 60);
            lines.push(`${indent}${isLast ? "   " : "│  "}   📌 "${snippetPreview}"`);
        }
        // Recurse into nested branches
        const nested = children.get(node.id) || [];
        if (nested.length > 0) {
            renderBranchChildren(nested, nodeMap, children, lines, indent + (isLast ? "   " : "│  "), depth + 1);
        }
    }
}
// --- JSON ---
export function renderJson(graph, insights = []) {
    return JSON.stringify({
        nodes: graph.nodes,
        edges: graph.edges,
        stats: graph.stats,
        insights,
    }, null, 2);
}
// --- Unified renderer ---
export function renderMap(graph, format = "ascii", insights = []) {
    switch (format) {
        case "mermaid":
            return renderMermaid(graph, insights);
        case "json":
            return renderJson(graph, insights);
        case "ascii":
        default:
            return renderAscii(graph, insights);
    }
}
//# sourceMappingURL=map-renderer.js.map