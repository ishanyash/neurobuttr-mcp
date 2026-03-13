#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerBranchTools } from "./tools/branch-tools.js";
import { registerMessageTools } from "./tools/message-tools.js";
import { registerSessionTools } from "./tools/session-tools.js";
import { registerMapTools } from "./tools/map-tools.js";
import { registerLookupTools } from "./tools/lookup-tools.js";
import { registerTimelineCaptureTools } from "./timeline/tools/capture-tools.js";
import { registerTimelineReviewTools } from "./timeline/tools/review-tools.js";
import { registerTimelineAnnotateTools } from "./timeline/tools/annotate-tools.js";
import { registerTimelineRollbackTools } from "./timeline/tools/rollback-tools.js";
import { registerTimelineReplayTools } from "./timeline/tools/replay-tools.js";
const server = new McpServer({
    name: "neurobuttr-mcp",
    version: "0.2.0",
});
// Register conversation branching tools
registerBranchTools(server);
registerMessageTools(server);
registerSessionTools(server);
registerMapTools(server);
registerLookupTools(server);
// Register timeline tools
registerTimelineCaptureTools(server);
registerTimelineReviewTools(server);
registerTimelineAnnotateTools(server);
registerTimelineRollbackTools(server);
registerTimelineReplayTools(server);
// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=index.js.map