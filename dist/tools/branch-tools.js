import { z } from "zod";
import { resolveSession, createBranch, checkoutBranch, resolveBranch, getBranchContext, } from "../core/session-manager.js";
export function registerBranchTools(server) {
    // nb_branch — like `git branch` or `git checkout -b`
    server.tool("nb_branch", `Create a new conversation branch to explore a tangent (like "git checkout -b"). When the user selects specific text to explore, pass it as anchor_snippet. Automatically branches from the current point unless parent_message_id is specified.`, {
        topic: z
            .string()
            .describe('What to explore, e.g. "what if we use Rust instead?" or "explore caching strategies"'),
        anchor_snippet: z
            .string()
            .optional()
            .describe('Exact text the user highlighted/selected to branch from. Pass verbatim from IDE selection.'),
        parent_message_id: z
            .string()
            .optional()
            .describe('ID of a specific message to branch from (defaults to last message if omitted).'),
        name: z
            .string()
            .optional()
            .describe('Short branch name (auto-generated from topic if omitted), e.g. "rust-alternative"'),
        cwd: z
            .string()
            .optional()
            .describe("Project directory (auto-detected from environment if omitted)"),
    }, async ({ topic, anchor_snippet, parent_message_id, name, cwd }) => {
        try {
            const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
            const session = await resolveSession(projectPath);
            const result = await createBranch(session.id, topic, parent_message_id, undefined, name, anchor_snippet);
            const snippetNote = anchor_snippet
                ? ` Anchored to: "${anchor_snippet.length > 60 ? anchor_snippet.slice(0, 60) + "..." : anchor_snippet}".`
                : "";
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            branch: result.branchName,
                            message: `Switched to new branch "${result.branchName}". You're now exploring: "${topic}".${snippetNote} Use nb_checkout main to return.`,
                            scopedContext: result.scopedContext,
                        }),
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // nb_checkout — like `git checkout`
    server.tool("nb_checkout", `Switch to a different branch or back to main (like "git checkout"). Use "main" to return to the main conversation thread. Use a branch name to switch to an existing branch.`, {
        branch: z
            .string()
            .describe('Branch name to switch to, or "main" to return to the main thread'),
        cwd: z
            .string()
            .optional()
            .describe("Project directory (auto-detected from environment if omitted)"),
    }, async ({ branch, cwd }) => {
        try {
            const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
            const session = await resolveSession(projectPath);
            const result = await checkoutBranch(session.id, branch);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            branch: result.branchName,
                            message: `Switched to ${result.branchName === "main" ? "main thread" : `branch "${result.branchName}"`}.`,
                            context: result.context,
                        }),
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // nb_resolve — like closing/merging a branch
    server.tool("nb_resolve", `Mark the current branch as resolved/completed and switch back to main (like finishing a feature branch). Optionally specify a branch name to resolve a different branch.`, {
        branch: z
            .string()
            .optional()
            .describe("Branch name or ID to resolve (default: current branch)"),
        merge: z
            .boolean()
            .optional()
            .describe("Merge insights to main before resolving (default: false)"),
        cwd: z
            .string()
            .optional()
            .describe("Project directory (auto-detected if omitted)"),
    }, async ({ branch, merge, cwd }) => {
        try {
            const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
            const session = await resolveSession(projectPath);
            const result = await resolveBranch(session.id, branch, merge || false);
            let msg = `Resolved branch "${result.resolved}".`;
            if (result.merged) {
                msg += ` Merged ${result.insightCount} insight(s) to main.`;
            }
            msg += " Switched back to main.";
            return {
                content: [{ type: "text", text: msg }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // nb_context — view the scoped context of a branch
    server.tool("nb_context", `View the full conversation context for a specific branch, including parent context and branch messages.`, {
        branch: z
            .string()
            .describe("Branch name or ID to view context for"),
        cwd: z
            .string()
            .optional()
            .describe("Project directory (auto-detected from environment if omitted)"),
    }, async ({ branch, cwd }) => {
        try {
            const projectPath = cwd || process.env.PROJECT_CWD || process.cwd();
            const session = await resolveSession(projectPath);
            const context = await getBranchContext(session.id, branch);
            return {
                content: [{ type: "text", text: context }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=branch-tools.js.map