export declare function extractNormalizedKeywords(text: string): string[];
export declare function extractWeightedKeywords(sources: {
    text: string;
    weight: number;
}[]): string[];
export declare function classifyTopic(text: string, anchorContext?: string): string;
interface NodeKeywords {
    nodeId: string;
    keywords: string[];
}
export declare function normalizeTopicsAcrossNodes(nodeKeywords: NodeKeywords[]): Record<string, string>;
export {};
//# sourceMappingURL=topic-classifier.d.ts.map