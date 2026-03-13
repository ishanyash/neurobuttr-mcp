/**
 * Import conversation history from Claude Code JSONL logs into a neurobuttr session.
 * Called by the bridge server on startup to populate the metro map with past activity.
 *
 * - Parses user prompts and tool calls from the main session
 * - Infers `requiresApproval` from tool type
 * - Discovers subagent JSONL files and imports them as branches
 */
import type { Session } from "../core/types.js";
/**
 * Import all Claude Code sessions for this project into the neurobuttr session.
 * Each JSONL file becomes a separate "chat session" (metro line).
 * Only imports if the session currently has no messages (fresh start).
 * Returns the number of messages imported.
 */
export declare function importSessionHistory(session: Session): Promise<number>;
//# sourceMappingURL=import-history.d.ts.map