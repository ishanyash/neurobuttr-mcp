import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { Session } from "./types.js";

const STORAGE_DIR = join(homedir(), ".neurobuttr", "sessions");

async function ensureDir(): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
}

function sessionPath(id: string): string {
  return join(STORAGE_DIR, `${id}.json`);
}

/** Derive a stable session ID from a project path */
export function sessionIdFromPath(projectPath: string): string {
  const hash = createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
  const dirName = projectPath.split("/").filter(Boolean).pop() || "default";
  // e.g. "my-project-a1b2c3d4e5f6"
  return `${dirName}-${hash}`;
}

export async function saveSession(session: Session): Promise<void> {
  await ensureDir();
  await writeFile(sessionPath(session.id), JSON.stringify(session, null, 2));
}

export async function loadSession(id: string): Promise<Session | null> {
  try {
    const data = await readFile(sessionPath(id), "utf-8");
    const session = JSON.parse(data) as Session;
    // Migrate: default merged to false for existing insights
    if (session.insights) {
      for (const insight of session.insights) {
        if (insight.merged === undefined) {
          (insight as { merged: boolean }).merged = false;
        }
      }
    }
    // Migrate: add chatSessions array if missing
    if (!session.chatSessions) {
      (session as Session).chatSessions = [];
    }
    return session;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<string[]> {
  await ensureDir();
  const files = await readdir(STORAGE_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

export async function deleteSession(id: string): Promise<boolean> {
  try {
    await unlink(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}
