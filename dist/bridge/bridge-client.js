import WebSocket from "ws";
const DEFAULT_PORT = 3200;
let connection = null;
let connected = false;
function getPort() {
    const envPort = process.env.NEUROBUTTR_BRIDGE_PORT;
    return envPort ? parseInt(envPort, 10) : DEFAULT_PORT;
}
function ensureConnection() {
    if (connection && connected) {
        return connection;
    }
    // Clean up stale connection
    if (connection) {
        try {
            connection.close();
        }
        catch {
            // ignore
        }
        connection = null;
        connected = false;
    }
    try {
        const port = getPort();
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        // Set a short timeout for connection
        const timeout = setTimeout(() => {
            if (!connected) {
                ws.close();
                connection = null;
            }
        }, 500);
        ws.on("open", () => {
            connected = true;
            clearTimeout(timeout);
        });
        ws.on("close", () => {
            connected = false;
            connection = null;
        });
        ws.on("error", () => {
            connected = false;
            connection = null;
        });
        connection = ws;
        return null; // Not connected yet on first call
    }
    catch {
        return null;
    }
}
/**
 * Notify the bridge of a session mutation.
 * Non-blocking, fire-and-forget. If bridge isn't running, silently no-ops.
 */
export function notifyBridge(action) {
    const ws = ensureConnection();
    if (ws && connected) {
        try {
            ws.send(JSON.stringify({ type: "bridge_action", payload: action }));
        }
        catch {
            // Bridge unavailable, continue with file I/O
        }
    }
}
//# sourceMappingURL=bridge-client.js.map