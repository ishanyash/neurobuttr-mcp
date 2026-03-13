import type { FileDiff } from "./types.js";
/**
 * Compute a unified diff for an Edit tool call (old_string → new_string).
 */
export declare function computeEditDiff(filePath: string, oldString: string, newString: string): FileDiff;
/**
 * Compute a diff for a Write tool call (full file creation).
 */
export declare function computeCreateDiff(filePath: string, content: string): FileDiff;
/**
 * Extract a FileDiff from a tool_use action if it's a file-modifying tool.
 * Returns null for non-file-modifying tools.
 */
export declare function computeDiffFromToolUse(toolName: string, toolInput: Record<string, unknown>): FileDiff | null;
//# sourceMappingURL=diff-computer.d.ts.map