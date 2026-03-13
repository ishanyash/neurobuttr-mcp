import type { Session } from "./types.js";
/** Derive a stable session ID from a project path */
export declare function sessionIdFromPath(projectPath: string): string;
export declare function saveSession(session: Session): Promise<void>;
export declare function loadSession(id: string): Promise<Session | null>;
export declare function listSessions(): Promise<string[]>;
export declare function deleteSession(id: string): Promise<boolean>;
//# sourceMappingURL=storage.d.ts.map