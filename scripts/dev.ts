/**
 * Dev orchestrator: runs tsc --build --watch + proxy hot reload together,
 * and auto-rebuilds/reloads the Chrome extension on source changes.
 *
 * 1. Starts `tsc --build --watch` to incrementally recompile all platform
 *    packages via project references.
 * 2. Waits for tsc's initial compilation to finish (detects the
 *    "Watching for file changes" line in tsc output).
 * 3. Runs the extension build pipeline (bundle + side panel + install).
 * 4. Starts the MCP server via the dev proxy (platform/mcp-server/dist/dev-proxy.js).
 *    The proxy holds client connections and restarts the MCP server worker on
 *    dist/ file changes via process restart.
 * 5. On each subsequent tsc recompilation (detected via the "Watching for
 *    file changes" sentinel in tsc output), re-runs the extension pipeline
 *    (debounced) and sends a reload signal to the Chrome extension.
 * 6. Pipes all processes' stdout/stderr with prefixed labels.
 * 7. Cleans up on SIGINT/SIGTERM.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { DEV_RELOAD_PORT } from './dev-reload-constants';
import { type DevReloadServer, startDevReloadServer } from './dev-reload-server';

const ROOT = resolve(import.meta.dirname, '..');

// ANSI color codes for prefixed output
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// Matches ANSI/VT escape sequences emitted by tsc --watch and other child processes.
// Built via String.fromCharCode to avoid no-control-regex lint violations.
const ANSI_RE = new RegExp(
  `[${String.fromCharCode(0x1b)}${String.fromCharCode(0x9b)}](?:\\[[0-9;]*[A-Za-z]|\\].*?(?:${String.fromCharCode(0x07)}|${String.fromCharCode(0x1b)}\\\\)|[()#][AB012]|c)`,
  'g',
);

/** Strip ANSI escape sequences and leading whitespace from a line of child process output. */
const sanitize = (s: string): string => s.replace(ANSI_RE, '').trimStart();

type Writable = { write(data: string): boolean };

/**
 * Read a stream line by line, writing each non-empty line with a prefix.
 * Returns a promise that resolves when the stream ends.
 */
const pipeWithPrefix = async (
  stream: ReadableStream<Uint8Array>,
  prefix: string,
  color: string,
  output: Writable,
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const coloredPrefix = `${color}${BOLD}${prefix}${RESET}`;
  let partial = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    partial += decoder.decode(value, { stream: true });
    const lines = partial.split('\n');
    partial = lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = sanitize(rawLine);
      if (line.length > 0) {
        output.write(`${coloredPrefix} ${line}\n`);
      }
    }
  }

  const trimmedPartial = sanitize(partial);
  if (trimmedPartial.length > 0) {
    output.write(`${coloredPrefix} ${trimmedPartial}\n`);
  }
};

/**
 * Pipe tsc stdout with a prefix, calling `onCompilationDone` each time
 * tsc finishes a compilation (detected by the "Watching for file changes"
 * sentinel). Fires on both the initial compilation and every incremental
 * recompilation.
 */
const pipeTscStdout = async (
  stream: ReadableStream<Uint8Array>,
  prefix: string,
  color: string,
  output: Writable,
  onCompilationDone: () => void,
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const coloredPrefix = `${color}${BOLD}${prefix}${RESET}`;
  let partial = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    partial += decoder.decode(value, { stream: true });
    const lines = partial.split('\n');
    partial = lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = sanitize(rawLine);
      if (line.length > 0) {
        output.write(`${coloredPrefix} ${line}\n`);
      }
      if (line.includes('Watching for file changes')) {
        onCompilationDone();
      }
    }
  }

  const trimmedPartial = sanitize(partial);
  if (trimmedPartial.length > 0) {
    output.write(`${coloredPrefix} ${trimmedPartial}\n`);
  }
};

/**
 * Read the wsSecret from ~/.opentabs/extension/auth.json for authenticating
 * with the MCP server's /extension/reload endpoint.
 */
const readWsSecret = async (): Promise<string | null> => {
  try {
    const configPath = join(homedir(), '.opentabs', 'extension', 'auth.json');
    const raw = await readFile(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const secret = (parsed as Record<string, unknown>).secret;
      if (typeof secret === 'string') return secret;
    }
  } catch {
    // Config may not exist yet
  }
  return null;
};

/**
 * Spawn a child process and return its exit promise plus Web-compatible
 * stdout/stderr streams.
 */
const spawnProcess = (
  cmd: string[],
  opts: { cwd: string; stdio: ['ignore', 'pipe', 'pipe'] },
): {
  proc: ChildProcess;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
} => {
  const [bin = '', ...args] = cmd;
  const proc = spawn(bin, args, { cwd: opts.cwd, stdio: opts.stdio });
  const stdout = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;
  const stderr = Readable.toWeb(proc.stderr) as ReadableStream<Uint8Array>;
  const exited = new Promise<number>(resolve => {
    proc.on('close', code => resolve(code ?? 0));
  });
  return { proc, stdout, stderr, exited };
};

/**
 * Run a shell command, streaming stdout/stderr with a prefix.
 * Returns the exit code.
 */
const runWithPrefix = async (cmd: string[], cwd: string, prefix: string, color: string): Promise<number> => {
  const { stdout, stderr, exited } = spawnProcess(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  void pipeWithPrefix(stdout, prefix, color, process.stdout);
  void pipeWithPrefix(stderr, prefix, color, process.stderr);
  return exited;
};

/**
 * Run the extension build pipeline: bundle background/offscreen,
 * build the side panel (React + Tailwind), and install to ~/.opentabs/extension/.
 */
const buildExtension = async (): Promise<boolean> => {
  const extDir = join(ROOT, 'platform', 'browser-extension');
  const prefix = '[ext]';
  const color = YELLOW;
  const coloredPrefix = `${color}${BOLD}${prefix}${RESET}`;

  console.log(`${coloredPrefix} Rebuilding extension...`);

  const bundleCode = await runWithPrefix(['npm', 'run', 'build:bundle'], extDir, prefix, color);
  if (bundleCode !== 0) {
    console.error(`${coloredPrefix} build:bundle failed (exit ${bundleCode})`);
    return false;
  }

  const sidePanelCode = await runWithPrefix(['npm', 'run', 'build:side-panel'], extDir, prefix, color);
  if (sidePanelCode !== 0) {
    console.error(`${coloredPrefix} build:side-panel failed (exit ${sidePanelCode})`);
    return false;
  }

  const installCode = await runWithPrefix(['npx', 'tsx', 'scripts/install-extension.ts'], ROOT, prefix, color);
  if (installCode !== 0) {
    console.error(`${coloredPrefix} install-extension failed (exit ${installCode})`);
    return false;
  }

  console.log(`${coloredPrefix} Extension built and installed.`);
  return true;
};

type RebuildTarget = 'side-panel' | 'extension';

const EXT_DIST = join(ROOT, 'platform', 'browser-extension', 'dist');

/**
 * Scan the browser-extension dist/ directory for .js files modified after
 * `since` and determine which build targets need rebuilding.
 *
 * Categorization:
 * - Files under `dist/side-panel/` → 'side-panel'
 * - `dist/background.js` and files under `dist/offscreen/` → 'extension'
 * - All other .js files (shared modules like bridge.js, messaging.js) → both targets
 *
 * Returns a Set of targets that need rebuilding, or an empty set if
 * no extension-related files changed.
 */
const determineChangedTargets = async (since: number): Promise<Set<RebuildTarget>> => {
  const targets = new Set<RebuildTarget>();
  await scanDir(EXT_DIST, since, targets);
  return targets;
};

/**
 * Recursively scan a directory for .js files newer than `since`,
 * categorizing each into 'side-panel' or 'extension' targets.
 */
const scanDir = async (dir: string, since: number, targets: Set<RebuildTarget>): Promise<void> => {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDir(fullPath, since, targets);
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) {
      const fileStat = await stat(fullPath);
      if (fileStat.mtimeMs <= since) continue;
      const rel = relative(EXT_DIST, fullPath);
      if (rel.startsWith('side-panel/')) {
        targets.add('side-panel');
      } else if (rel === 'background.js' || rel.startsWith('offscreen/')) {
        targets.add('extension');
      } else {
        // Shared code (bridge, messaging, message-router, etc.) — triggers both
        targets.add('side-panel');
        targets.add('extension');
      }
    }
  }
};

/**
 * Build only the side panel (React + Tailwind) and install to ~/.opentabs/extension/.
 */
const buildSidePanel = async (): Promise<boolean> => {
  const extDir = join(ROOT, 'platform', 'browser-extension');
  const prefix = '[ext]';
  const color = YELLOW;
  const coloredPrefix = `${color}${BOLD}${prefix}${RESET}`;

  console.log(`${coloredPrefix} Rebuilding side panel...`);

  const sidePanelCode = await runWithPrefix(['npm', 'run', 'build:side-panel'], extDir, prefix, color);
  if (sidePanelCode !== 0) {
    console.error(`${coloredPrefix} build:side-panel failed (exit ${sidePanelCode})`);
    return false;
  }

  const installCode = await runWithPrefix(['npx', 'tsx', 'scripts/install-extension.ts'], ROOT, prefix, color);
  if (installCode !== 0) {
    console.error(`${coloredPrefix} install-extension failed (exit ${installCode})`);
    return false;
  }

  return true;
};

/**
 * Build only the background/offscreen bundles and install to ~/.opentabs/extension/.
 */
const buildBackground = async (): Promise<boolean> => {
  const extDir = join(ROOT, 'platform', 'browser-extension');
  const prefix = '[ext]';
  const color = YELLOW;
  const coloredPrefix = `${color}${BOLD}${prefix}${RESET}`;

  console.log(`${coloredPrefix} Rebuilding background/offscreen...`);

  const bundleCode = await runWithPrefix(['npm', 'run', 'build:bundle'], extDir, prefix, color);
  if (bundleCode !== 0) {
    console.error(`${coloredPrefix} build:bundle failed (exit ${bundleCode})`);
    return false;
  }

  const installCode = await runWithPrefix(['npx', 'tsx', 'scripts/install-extension.ts'], ROOT, prefix, color);
  if (installCode !== 0) {
    console.error(`${coloredPrefix} install-extension failed (exit ${installCode})`);
    return false;
  }

  return true;
};

/**
 * Send a reload signal to the Chrome extension via the MCP server's
 * /extension/reload endpoint. Handles cases where the server is not
 * running or the extension is not connected.
 */
const reloadExtension = async (): Promise<void> => {
  const coloredPrefix = `${YELLOW}${BOLD}[ext]${RESET}`;
  const port = process.env.PORT ?? '9515';
  const url = `http://localhost:${port}/extension/reload`;

  try {
    const secret = await readWsSecret();
    const headers: Record<string, string> = {};
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
    }

    const response = await fetch(url, { method: 'POST', headers });

    if (response.ok) {
      console.log(`${coloredPrefix} Extension reloaded (full — via HTTP fallback).`);
    } else if (response.status === 503) {
      console.log(`${coloredPrefix} Extension not connected — reload skipped (will pick up changes on next connect).`);
    } else {
      console.warn(`${coloredPrefix} Reload request returned ${response.status}: ${await response.text()}`);
    }
  } catch {
    console.warn(`${coloredPrefix} MCP server not reachable — extension reload skipped.`);
  }
};

// Track child processes for cleanup
const children: ChildProcess[] = [];

let devReloadServer: DevReloadServer | null = null;

const cleanup = (): void => {
  devReloadServer?.close();
  for (const child of children) {
    if (process.platform === 'win32') {
      child.kill();
    } else {
      child.kill('SIGTERM');
    }
  }
};

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

if (process.platform !== 'win32') {
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
}

// Enable dev mode for extension build scripts. When set, build-side-panel.ts
// and build-extension.ts prepend WebSocket reload clients to their bundles,
// enabling granular hot reload (side panel refresh or full extension reload).
process.env.OPENTABS_DEV = '1';

// 0. Ensure lefthook git hooks are up to date. After pulling a lefthook
//    version bump, the hooks in .git/hooks/ can be stale (generated by the
//    old version). Running `lefthook install` at dev startup guarantees the
//    hooks match the installed version.
{
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('npx', ['lefthook', 'install'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    // Non-fatal — lefthook may not be installed yet (first clone before npm install)
  }
}

// 1. Start tsc --build --watch
const devPrefix = `${MAGENTA}${BOLD}[dev]${RESET}`;
console.log(`${devPrefix} Starting tsc --build --watch...`);
const tscSpawn = spawnProcess(['node_modules/.bin/tsc', '--build', '--watch'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(tscSpawn.proc);

// 2. Pipe tsc output and wait for initial compilation.
//    `pipeTscStdout` calls the callback every time tsc prints the
//    "Watching for file changes" sentinel (after initial + incremental builds).
//    The first call resolves the ready promise; subsequent calls schedule
//    extension rebuilds (connected in step 5).
let onTscRecompile: (() => void) | null = null;
let tscReadyResolve: (() => void) | null = null;
const tscReady = new Promise<void>(r => {
  tscReadyResolve = r;
});

void pipeTscStdout(tscSpawn.stdout, '[tsc]', CYAN, process.stdout, () => {
  if (tscReadyResolve) {
    tscReadyResolve();
    tscReadyResolve = null;
    return;
  }
  onTscRecompile?.();
});
void pipeWithPrefix(tscSpawn.stderr, '[tsc]', CYAN, process.stderr);

await tscReady;
console.log(`${devPrefix} tsc initial compilation complete.`);

// 3. Run the extension build pipeline once after initial tsc build
await buildExtension();

// 3b. Start the dev reload WebSocket relay server
devReloadServer = await startDevReloadServer(DEV_RELOAD_PORT);
if (devReloadServer) {
  console.log(`${devPrefix} Dev reload server listening on ws://localhost:${DEV_RELOAD_PORT}`);
} else {
  console.warn(`${devPrefix} Dev reload server disabled (port ${DEV_RELOAD_PORT} in use)`);
}

// 4. Start the dev proxy (holds client connections, restarts MCP server worker on dist/ changes)
console.log(`${devPrefix} Starting MCP server (dev proxy)...`);
const mcpSpawn = spawnProcess(['node', 'platform/mcp-server/dist/dev-proxy.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(mcpSpawn.proc);

// Pipe MCP output
void pipeWithPrefix(mcpSpawn.stdout, '[mcp]', GREEN, process.stdout);
void pipeWithPrefix(mcpSpawn.stderr, '[mcp]', GREEN, process.stderr);

// Print startup banner
const port = process.env.PORT ?? '9515';
const extensionPath = `${join(homedir(), '.opentabs', 'extension')}/`;
const devReloadText = devReloadServer
  ? `Dev Reload:  ws://localhost:${DEV_RELOAD_PORT}`
  : `Dev Reload:  disabled (port ${DEV_RELOAD_PORT} in use)`;
const contentLines = [
  { text: 'OpenTabs Dev Server', separatorAfter: true },
  { text: `MCP Server:  http://localhost:${port}/mcp` },
  { text: `Extension:   ${extensionPath}` },
  { text: devReloadText },
  { text: 'Mode:        dev (hot reload)', separatorAfter: true },
  { text: 'Ready — watching for changes...', display: `${GREEN}${BOLD}Ready${RESET} — watching for changes...` },
];
// 2 chars padding per side: "│  content  │"
const innerWidth = Math.max(...contentLines.map(l => l.text.length)) + 4;
const hr = '─'.repeat(innerWidth);
const bannerLines: string[] = [`┌${hr}┐`];
for (const line of contentLines) {
  const pad = ' '.repeat(innerWidth - 2 - line.text.length);
  bannerLines.push(`│  ${line.display ?? line.text}${pad}│`);
  if (line.separatorAfter) bannerLines.push(`├${hr}┤`);
}
bannerLines.push(`└${hr}┘`);
console.log(`\n${bannerLines.join('\n')}\n`);

// 5. Rebuild the extension on each tsc recompilation.
//
//    Previous approach watched browser-extension/dist/ for file changes, but
//    the extension build pipeline writes back into the same dist/ directory
//    (bundle step overwrites tsc output, side panel writes to dist/side-panel/),
//    causing an infinite rebuild loop.
//
//    Instead, we trigger rebuilds from tsc's own output: each time tsc prints
//    "Watching for file changes", it has finished writing all dist/ files for
//    the current compilation. This avoids the feedback loop entirely.
//
//    Change detection: track the timestamp of the last tsc compilation. After
//    each recompilation, scan browser-extension/dist/ for .js files newer than
//    the previous timestamp to determine which targets (side-panel, background)
//    need rebuilding. Only the affected targets are rebuilt and reloaded.
let extensionRebuildTimer: ReturnType<typeof setTimeout> | null = null;
let extensionBuildInProgress = false;
let rebuildRequestedDuringBuild = false;
let lastCompilationTimestamp = Date.now();

const DEBOUNCE_MS = 300;

/**
 * Run the targeted extension rebuild based on which dist/ files changed.
 * Falls back to a full rebuild if the relay server is unavailable.
 */
const runTargetedRebuild = async (): Promise<void> => {
  const coloredPrefix = `${YELLOW}${BOLD}[ext]${RESET}`;
  const compilationStart = lastCompilationTimestamp;
  lastCompilationTimestamp = Date.now();

  const targets = await determineChangedTargets(compilationStart);

  if (targets.size === 0) {
    // No extension files changed — skip rebuild entirely
    return;
  }

  const hasSidePanel = targets.has('side-panel');
  const hasBackground = targets.has('extension');

  if (hasSidePanel && hasBackground) {
    // Both targets changed — full rebuild
    const ok = await buildExtension();
    if (ok) {
      if (devReloadServer) {
        devReloadServer.broadcast('extension');
        console.log(`${coloredPrefix} Extension reloaded (full — background + UI changed)`);
      } else {
        await reloadExtension();
      }
    }
  } else if (hasBackground) {
    // Background/offscreen only
    const ok = await buildBackground();
    if (ok) {
      if (devReloadServer) {
        devReloadServer.broadcast('extension');
        console.log(`${coloredPrefix} Extension reloaded (full)`);
      } else {
        await reloadExtension();
      }
    }
  } else {
    // Side panel only
    const ok = await buildSidePanel();
    if (ok) {
      if (devReloadServer) {
        devReloadServer.broadcast('side-panel');
        console.log(`${coloredPrefix} Side panel refreshed (UI-only)`);
      } else {
        await reloadExtension();
      }
    }
  }
};

const scheduleExtensionRebuild = (): void => {
  if (extensionBuildInProgress) {
    // tsc finished another compilation while the build pipeline is still
    // running. Remember to rebuild again after the current build finishes.
    rebuildRequestedDuringBuild = true;
    return;
  }
  if (extensionRebuildTimer !== null) {
    clearTimeout(extensionRebuildTimer);
  }
  extensionRebuildTimer = setTimeout(() => {
    extensionRebuildTimer = null;
    extensionBuildInProgress = true;
    rebuildRequestedDuringBuild = false;
    void runTargetedRebuild().finally(() => {
      extensionBuildInProgress = false;
      if (rebuildRequestedDuringBuild) {
        rebuildRequestedDuringBuild = false;
        scheduleExtensionRebuild();
      }
    });
  }, DEBOUNCE_MS);
};

onTscRecompile = scheduleExtensionRebuild;

// Wait for either process to exit (shouldn't happen in normal operation)
const tscExit = tscSpawn.exited.then(code => ({ process: 'tsc', code }));
const mcpExit = mcpSpawn.exited.then(code => ({ process: 'mcp', code }));
const result = await Promise.race([tscExit, mcpExit]);

console.log(`${devPrefix} ${result.process} exited with code ${result.code}`);
cleanup();
process.exit(result.code);
