const MAX_DIFF_CONTEXT_LINES = 3;
/**
 * Compute a unified diff for an Edit tool call (old_string → new_string).
 */
export function computeEditDiff(filePath, oldString, newString) {
    const oldLines = oldString.split("\n");
    const newLines = newString.split("\n");
    const hunks = [];
    hunks.push(`--- a/${filePath}`);
    hunks.push(`+++ b/${filePath}`);
    hunks.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);
    for (const line of oldLines) {
        hunks.push(`-${line}`);
    }
    for (const line of newLines) {
        hunks.push(`+${line}`);
    }
    return {
        path: filePath,
        type: "edit",
        patch: hunks.join("\n"),
    };
}
/**
 * Compute a diff for a Write tool call (full file creation).
 */
export function computeCreateDiff(filePath, content) {
    const lines = content.split("\n");
    const hunks = [];
    hunks.push(`--- /dev/null`);
    hunks.push(`+++ b/${filePath}`);
    hunks.push(`@@ -0,0 +1,${lines.length} @@`);
    for (const line of lines) {
        hunks.push(`+${line}`);
    }
    return {
        path: filePath,
        type: "create",
        patch: hunks.join("\n"),
    };
}
/**
 * Extract a FileDiff from a tool_use action if it's a file-modifying tool.
 * Returns null for non-file-modifying tools.
 */
export function computeDiffFromToolUse(toolName, toolInput) {
    if (toolName === "Edit") {
        const filePath = toolInput.file_path;
        const oldString = toolInput.old_string;
        const newString = toolInput.new_string;
        if (filePath && oldString !== undefined && newString !== undefined) {
            return computeEditDiff(filePath, oldString, newString);
        }
    }
    if (toolName === "Write") {
        const filePath = toolInput.file_path;
        const content = toolInput.content;
        if (filePath && content !== undefined) {
            return computeCreateDiff(filePath, content);
        }
    }
    return null;
}
//# sourceMappingURL=diff-computer.js.map