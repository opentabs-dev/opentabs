/**
 * Dev orchestrator: runs tsc --build --watch + bun --hot together,
 * and auto-rebuilds/reloads the Chrome extension on source changes.
 *
 * 1. Starts `tsc --build --watch` to incrementally recompile all platform
 *    packages via project references.
 * 2. Waits for tsc's initial compilation to finish (detects the
 *    "Watching for file changes" line in tsc output).
 * 3. Runs the extension build pipeline (bundle + side panel + install).
 * 4. Starts the MCP server via `bun --hot platform/mcp-server/dist/index.js`.
 *    (Will be replaced by the Node.js proxy dev server in US-005.)
 * 5. On each subsequent tsc recompilation (detected via the "Watching for
 *    file changes" sentinel in tsc output), re-runs the extension pipeline
 *    (debounced) and sends a reload signal to the Chrome extension.
 * 6. Pipes all processes' stdout/stderr with prefixed labels.
 * 7. Cleans up on SIGINT/SIGTERM.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');

// ANSI color codes for prefixed output
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

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
    for (const line of lines) {
      if (line.length > 0) {
        output.write(`${coloredPrefix} ${line}\n`);
      }
    }
  }

  if (partial.length > 0) {
    output.write(`${coloredPrefix} ${partial}\n`);
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
    for (const line of lines) {
      if (line.length > 0) {
        output.write(`${coloredPrefix} ${line}\n`);
      }
      if (line.includes('Watching for file changes')) {
        onCompilationDone();
      }
    }
  }

  if (partial.length > 0) {
    output.write(`${coloredPrefix} ${partial}\n`);
  }
};

/**
 * Read the wsSecret from ~/.opentabs/config.json for authenticating
 * with the MCP server's /extension/reload endpoint.
 */
const readWsSecret = async (): Promise<string | null> => {
  try {
    const configPath = join(homedir(), '.opentabs', 'config.json');
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

/**
 * Send a reload signal to the Chrome extension via the MCP server's
 * /extension/reload endpoint. Handles cases where the server is not
 * running or the extension is not connected.
 */
const reloadExtension = async (): Promise<void> => {
  const coloredPrefix = `${YELLOW}${BOLD}[ext]${RESET}`;
  const port = process.env['PORT'] ?? '9515';
  const url = `http://localhost:${port}/extension/reload`;

  try {
    const secret = await readWsSecret();
    const headers: Record<string, string> = {};
    if (secret) {
      headers['Authorization'] = `Bearer ${secret}`;
    }

    const response = await fetch(url, { method: 'POST', headers });

    if (response.ok) {
      console.log(`${coloredPrefix} Extension reloaded.`);
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

const cleanup = (): void => {
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

// 4. Start MCP server with bun --hot (will be replaced by proxy dev server in US-005)
console.log(`${devPrefix} Starting MCP server (bun --hot)...`);
const mcpSpawn = spawnProcess(['bun', '--hot', 'platform/mcp-server/dist/index.js', '--dev'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(mcpSpawn.proc);

// Pipe MCP output
void pipeWithPrefix(mcpSpawn.stdout, '[mcp]', GREEN, process.stdout);
void pipeWithPrefix(mcpSpawn.stderr, '[mcp]', GREEN, process.stderr);

// Print startup banner
const port = process.env['PORT'] ?? '9515';
const extensionPath = join(homedir(), '.opentabs', 'extension') + '/';
const bannerLines = [
  '┌─────────────────────────────────────────────┐',
  '│  OpenTabs Dev Server                        │',
  '├─────────────────────────────────────────────┤',
  `│  MCP Server:  http://localhost:${port}/mcp`.padEnd(46) + '│',
  `│  Extension:   ${extensionPath}`.padEnd(46) + '│',
  '│  Mode:        dev (hot reload)              │',
  '├─────────────────────────────────────────────┤',
  `│  ${GREEN}${BOLD}Ready${RESET} — watching for changes...            │`,
  '└─────────────────────────────────────────────┘',
];
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
let extensionRebuildTimer: ReturnType<typeof setTimeout> | null = null;
let extensionBuildInProgress = false;
let rebuildRequestedDuringBuild = false;

const DEBOUNCE_MS = 300;

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
    void buildExtension()
      .then(async ok => {
        if (ok) await reloadExtension();
      })
      .finally(() => {
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
