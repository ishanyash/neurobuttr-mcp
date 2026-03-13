import type { TimelineSession, TimelineIndex, TimelineIndexEntry } from "./types.js";
/**
 * Derive the neurobuttr project hash from a project path.
 * Reuses the same approach as core/storage.ts.
 */
export declare function timelineProjectHash(projectPath: string): string;
/**
 * Save a timeline session to disk.
 */
export declare function saveTimelineSession(session: TimelineSession): Promise<void>;
/**
 * Load a timeline session by ID.
 */
export declare function loadTimelineSession(projectHash: string, sessionId: string): Promise<TimelineSession | null>;
/**
 * Load the timeline index for a project.
 */
export declare function loadTimelineIndex(projectHash: string): Promise<TimelineIndex>;
/**
 * Get the set of already-captured session IDs for a project.
 */
export declare function getCapturedIds(projectHash: string): Promise<Set<string>>;
/**
 * Add a session to the index (atomic write via temp file + rename).
 */
export declare function addToIndex(projectHash: string, entry: TimelineIndexEntry): Promise<void>;
/**
 * Update a session in the index (e.g., after rollback changes status).
 */
export declare function updateIndexEntry(projectHash: string, sessionId: string, updates: Partial<TimelineIndexEntry>): Promise<void>;
/**
 * Build an index entry from a session.
 */
export declare function sessionToIndexEntry(session: TimelineSession): TimelineIndexEntry;
/**
 * Ensure the timeline storage directory exists.
 */
export declare function ensureTimelineStorage(): Promise<void>;
//# sourceMappingURL=storage.d.ts.map