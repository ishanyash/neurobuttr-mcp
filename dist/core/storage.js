import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
const STORAGE_DIR = join(homedir(), ".neurobuttr", "sessions");
async function ensureDir() {
    await mkdir(STORAGE_DIR, { recursive: true });
}
function sessionPath(id) {
    return join(STORAGE_DIR, `${id}.json`);
}
/** Derive a stable session ID from a project path */
export function sessionIdFromPath(projectPath) {
    const hash = createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
    const dirName = projectPath.split("/").filter(Boolean).pop() || "default";
    // e.g. "my-project-a1b2c3d4e5f6"
    return `${dirName}-${hash}`;
}
export async function saveSession(session) {
    await ensureDir();
    await writeFile(sessionPath(session.id), JSON.stringify(session, null, 2));
}
export async function loadSession(id) {
    try {
        const data = await readFile(sessionPath(id), "utf-8");
        const session = JSON.parse(data);
        // Migrate: default merged to false for existing insights
        if (session.insights) {
            for (const insight of session.insights) {
                if (insight.merged === undefined) {
                    insight.merged = false;
                }
            }
        }
        // Migrate: add chatSessions array if missing
        if (!session.chatSessions) {
            session.chatSessions = [];
        }
        return session;
    }
    catch {
        return null;
    }
}
export async function listSessions() {
    await ensureDir();
    const files = await readdir(STORAGE_DIR);
    return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", ""));
}
export async function deleteSession(id) {
    try {
        await unlink(sessionPath(id));
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=storage.js.map