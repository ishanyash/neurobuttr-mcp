import { readFile, writeFile, mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { sessionIdFromPath } from "../core/storage.js";
import type {
  TimelineSession,
  TimelineIndex,
  TimelineIndexEntry,
} from "./types.js";

const TIMELINE_BASE = join(homedir(), ".neurobuttr", "timeline");

function projectDir(projectHash: string): string {
  return join(TIMELINE_BASE, projectHash);
}

function sessionsDir(projectHash: string): string {
  return join(projectDir(projectHash), "sessions");
}

function indexPath(projectHash: string): string {
  return join(projectDir(projectHash), "index.json");
}

function sessionPath(projectHash: string, sessionId: string): string {
  return join(sessionsDir(projectHash), `${sessionId}.json`);
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * Derive the neurobuttr project hash from a project path.
 * Reuses the same approach as core/storage.ts.
 */
export function timelineProjectHash(projectPath: string): string {
  return sessionIdFromPath(projectPath);
}

/**
 * Save a timeline session to disk.
 */
export async function saveTimelineSession(
  session: TimelineSession
): Promise<void> {
  const dir = sessionsDir(session.projectHash);
  await ensureDir(dir);
  await writeFile(
    sessionPath(session.projectHash, session.id),
    JSON.stringify(session, null, 2)
  );
}

/**
 * Load a timeline session by ID.
 */
export async function loadTimelineSession(
  projectHash: string,
  sessionId: string
): Promise<TimelineSession | null> {
  try {
    const data = await readFile(sessionPath(projectHash, sessionId), "utf-8");
    return JSON.parse(data) as TimelineSession;
  } catch {
    return null;
  }
}

/**
 * Load the timeline index for a project.
 */
export async function loadTimelineIndex(
  projectHash: string
): Promise<TimelineIndex> {
  try {
    const data = await readFile(indexPath(projectHash), "utf-8");
    return JSON.parse(data) as TimelineIndex;
  } catch {
    return { version: 1, sessions: [] };
  }
}

/**
 * Get the set of already-captured session IDs for a project.
 */
export async function getCapturedIds(
  projectHash: string
): Promise<Set<string>> {
  const index = await loadTimelineIndex(projectHash);
  return new Set(index.sessions.map((s) => s.id));
}

/**
 * Add a session to the index (atomic write via temp file + rename).
 */
export async function addToIndex(
  projectHash: string,
  entry: TimelineIndexEntry
): Promise<void> {
  const dir = projectDir(projectHash);
  await ensureDir(dir);

  const index = await loadTimelineIndex(projectHash);

  // Don't add duplicates
  if (index.sessions.some((s) => s.id === entry.id)) {
    return;
  }

  index.sessions.push(entry);
  // Sort by startedAt descending (newest first)
  index.sessions.sort((a, b) => b.startedAt - a.startedAt);

  // Atomic write: write to temp, then rename
  const tempPath = indexPath(projectHash) + ".tmp";
  await writeFile(tempPath, JSON.stringify(index, null, 2));
  await rename(tempPath, indexPath(projectHash));
}

/**
 * Update a session in the index (e.g., after rollback changes status).
 */
export async function updateIndexEntry(
  projectHash: string,
  sessionId: string,
  updates: Partial<TimelineIndexEntry>
): Promise<void> {
  const index = await loadTimelineIndex(projectHash);
  const entry = index.sessions.find((s) => s.id === sessionId);
  if (entry) {
    Object.assign(entry, updates);
    const tempPath = indexPath(projectHash) + ".tmp";
    await writeFile(tempPath, JSON.stringify(index, null, 2));
    await rename(tempPath, indexPath(projectHash));
  }
}

/**
 * Build an index entry from a session.
 */
export function sessionToIndexEntry(
  session: TimelineSession
): TimelineIndexEntry {
  return {
    id: session.id,
    prompt: session.prompt.length > 200
      ? session.prompt.slice(0, 200) + "..."
      : session.prompt,
    model: session.model,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    status: session.status,
    filesModified: session.filesModified,
    actionCount: session.actions.length,
    gitBranch: session.gitBranch,
  };
}

/**
 * Ensure the timeline storage directory exists.
 */
export async function ensureTimelineStorage(): Promise<void> {
  await ensureDir(TIMELINE_BASE);
}
