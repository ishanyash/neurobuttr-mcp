import type { FileDiff } from "./types.js";

const MAX_DIFF_CONTEXT_LINES = 3;

/**
 * Compute a unified diff for an Edit tool call (old_string → new_string).
 */
export function computeEditDiff(
  filePath: string,
  oldString: string,
  newString: string
): FileDiff {
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");

  const hunks: string[] = [];
  hunks.push(`--- a/${filePath}`);
  hunks.push(`+++ b/${filePath}`);
  hunks.push(
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`
  );

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
export function computeCreateDiff(
  filePath: string,
  content: string
): FileDiff {
  const lines = content.split("\n");
  const hunks: string[] = [];
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
export function computeDiffFromToolUse(
  toolName: string,
  toolInput: Record<string, unknown>
): FileDiff | null {
  if (toolName === "Edit") {
    const filePath = toolInput.file_path as string | undefined;
    const oldString = toolInput.old_string as string | undefined;
    const newString = toolInput.new_string as string | undefined;
    if (filePath && oldString !== undefined && newString !== undefined) {
      return computeEditDiff(filePath, oldString, newString);
    }
  }

  if (toolName === "Write") {
    const filePath = toolInput.file_path as string | undefined;
    const content = toolInput.content as string | undefined;
    if (filePath && content !== undefined) {
      return computeCreateDiff(filePath, content);
    }
  }

  return null;
}
