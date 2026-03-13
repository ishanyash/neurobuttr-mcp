import type { MapNode, MapEdge } from "./graph-builder.js";
interface GraphData {
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
}
interface InsightData {
    content: string;
    sourceBranch: string;
}
export declare function renderMermaid(graph: GraphData, insights?: InsightData[]): string;
export declare function renderAscii(graph: GraphData, insights?: InsightData[]): string;
export declare function renderJson(graph: GraphData, insights?: InsightData[]): string;
export declare function renderMap(graph: GraphData, format?: "mermaid" | "ascii" | "json", insights?: InsightData[]): string;
export {};
//# sourceMappingURL=map-renderer.d.ts.map