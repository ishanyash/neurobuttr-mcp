import type { BridgeAction } from "./protocol.js";
/**
 * Notify the bridge of a session mutation.
 * Non-blocking, fire-and-forget. If bridge isn't running, silently no-ops.
 */
export declare function notifyBridge(action: BridgeAction): void;
//# sourceMappingURL=bridge-client.d.ts.map