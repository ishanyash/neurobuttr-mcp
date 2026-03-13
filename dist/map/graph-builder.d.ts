import type { Session } from "../core/types.js";
export interface MapNode {
    id: string;
    type: "spine" | "branch";
    depth: number;
    label: string;
    summary: string;
    topic: string;
    messageCount: number;
    resolved: boolean;
    anchorContext: string | null;
    anchorSnippet: string | null;
    branchId?: string;
    spineIndex?: number;
}
export interface MapEdge {
    source: string;
    target: string;
}
export declare function buildGraph(session: Session): {
    nodes: MapNode[];
    edges: MapEdge[];
    stats: {
        mainMessages: number;
        branches: number;
        insights: number;
        topics: {
            name: string;
            count: number;
        }[];
    };
};
//# sourceMappingURL=graph-builder.d.ts.map