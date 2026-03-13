#!/usr/bin/env node

/**
 * CLI for neurobuttr-mcp setup.
 *
 * Usage:
 *   npx neurobuttr-mcp init    — Configure MCP server globally in ~/.claude.json
 *   npx neurobuttr-mcp         — Run the MCP server (default, used by Claude Code)
 */

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const command = args[0];

if (command === "init") {
  await init();
} else if (command === "ui") {
  await launchUI();
} else if (command === "map") {
  await launchMap();
} else if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else {
  // Default: run MCP server
  await import("./index.js");
}

function printHelp(): void {
  console.log(`
neurobuttr-mcp — Conversation branching & timeline for Claude Code

Commands:
  init         Set up neurobuttr MCP server globally (adds to ~/.claude.json)
  ui [--port]  Open timeline review UI in browser (default: port 3100)
  map [--port] Open live metro map in browser (default: port 3200)
  help         Show this help message

No command:
  Runs the MCP server (used by Claude Code internally)

Quick start:
  npx neurobuttr-mcp init

Then restart Claude Code. You'll have these tools in EVERY project:

  Conversation Branching:
    nb_branch   — Branch off to explore a tangent
    nb_checkout — Switch between branches and main
    nb_log      — See all branches at a glance
    nb_status   — Current conversation state
    nb_map      — Visual conversation map
    nb_resolve  — Mark a branch as done
    remember_insight — Save a finding from a branch
    get_insights     — View all saved insights

  Timeline (session version control):
    nb_timeline_capture  — Parse Claude Code logs into session records
    nb_timeline_list     — List captured sessions
    nb_timeline_show     — Show session detail (actions, reasoning, diffs)
    nb_timeline_diff     — Show all file changes as unified diffs
    nb_timeline_annotate — Add tags/notes to a session
    nb_timeline_rollback — Revert a session's changes
    nb_timeline_replay   — Replay session to a point (lightweight branching)
`);
}

async function init(): Promise<void> {
  const home = homedir();
  const claudeConfigPath = join(home, ".claude.json");
  const serverPath = join(__dirname, "index.js");

  // Read existing ~/.claude.json
  let config: Record<string, unknown> = {};
  try {
    const data = await readFile(claudeConfigPath, "utf-8");
    config = JSON.parse(data);
  } catch {
    // No existing config — we'll create one
  }

  const mcpServers = (config.mcpServers || {}) as Record<string, unknown>;

  if (mcpServers.neurobuttr) {
    console.log("neurobuttr is already configured in ~/.claude.json");
    console.log("Restart Claude Code to pick up any changes.");
    return;
  }

  mcpServers.neurobuttr = {
    type: "stdio",
    command: "node",
    args: [serverPath],
  };

  config.mcpServers = mcpServers;

  await writeFile(claudeConfigPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Updated ${claudeConfigPath}`);
  console.log(`Added neurobuttr MCP server (available in all projects)`);

  // Ensure storage directories exist
  await mkdir(join(home, ".neurobuttr", "sessions"), { recursive: true });
  await mkdir(join(home, ".neurobuttr", "timeline"), { recursive: true });

  // Add .neurobuttr/ to global gitignore so map files don't pollute repos
  await ensureGlobalGitignore(home);

  console.log(`
Setup complete! Restart Claude Code to start using conversation branches and timeline.

Tip: Install "Mermaid Preview" VS Code extension for visual conversation maps.
     nb_map writes to .neurobuttr/map.mmd — preview it live in VS Code.

Try saying:
  "let's branch off and explore [topic]"
  "capture the timeline for this session"
  "show me what the last session did"
`);
}

async function launchUI(): Promise<void> {
  const { startTimelineServer } = await import("./timeline/ui/server.js");
  const projectPath = process.cwd();

  // Parse --port flag
  const portIdx = args.indexOf("--port");
  const port = portIdx >= 0 && args[portIdx + 1]
    ? parseInt(args[portIdx + 1], 10)
    : 3100;

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error("Invalid port number. Use: npx neurobuttr-mcp ui --port 3100");
    process.exit(1);
  }

  await startTimelineServer(projectPath, port);

  // Open browser
  const url = `http://localhost:${port}`;
  const { exec } = await import("node:child_process");
  const openCmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start" :
    "xdg-open";
  exec(`${openCmd} ${url}`);
}

async function launchMap(): Promise<void> {
  const { startBridgeServer } = await import("./bridge/server.js");
  const projectPath = process.cwd();

  // Parse --port flag
  const portIdx = args.indexOf("--port");
  const port =
    portIdx >= 0 && args[portIdx + 1]
      ? parseInt(args[portIdx + 1], 10)
      : 3200;

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error("Invalid port number. Use: npx neurobuttr-mcp map --port 3200");
    process.exit(1);
  }

  await startBridgeServer(projectPath, port);

  // Open browser
  const url = `http://localhost:${port}`;
  const { exec } = await import("node:child_process");
  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${openCmd} ${url}`);
}

async function ensureGlobalGitignore(home: string): Promise<void> {
  // Use ~/.config/git/ignore (the standard global gitignore location)
  const gitConfigDir = join(home, ".config", "git");
  const globalIgnorePath = join(gitConfigDir, "ignore");

  await mkdir(gitConfigDir, { recursive: true });

  let content = "";
  try {
    content = await readFile(globalIgnorePath, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  if (content.includes(".neurobuttr")) {
    return; // Already there
  }

  const entry = "\n# neurobuttr conversation maps (local only)\n.neurobuttr/\n";
  await appendFile(globalIgnorePath, entry);
  console.log(`Added .neurobuttr/ to global gitignore (${globalIgnorePath})`);
}
