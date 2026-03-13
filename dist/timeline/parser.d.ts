import type { TimelineSession } from "./types.js";
/**
 * Compute Claude Code's project hash from a directory path.
 * Claude Code uses the absolute path with '/' replaced by '-'.
 */
export declare function claudeProjectHash(cwd: string): string;
/**
 * Find all JSONL session files for a project in Claude Code's log directory.
 */
export declare function findSessionFiles(claudeHash: string): Promise<string[]>;
/**
 * Parse a single JSONL file into a TimelineSession.
 * Returns null if the session is empty, active, or unparseable.
 */
export declare function parseJSONLFile(filePath: string, projectPath: string, projectHash: string): Promise<TimelineSession | null>;
/**
 * Find uncaptured session files (not in the capturedIds set).
 */
export declare function filterUncaptured(filePaths: string[], capturedIds: Set<string>): string[];
//# sourceMappingURL=parser.d.ts.map