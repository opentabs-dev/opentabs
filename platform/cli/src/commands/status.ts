/**
 * `opentabs status` command — shows server status and connected plugins.
 */

import { readFile, unlink } from 'node:fs/promises';
import { DEFAULT_HOST, toErrorMessage } from '@opentabs-dev/shared';
import type { Command } from 'commander';
import pc from 'picocolors';
import { getPidFilePath, isConnectionRefused, parsePidFile, readAuthSecret } from '../config.js';
import { parsePort, resolvePort } from '../parse-port.js';

interface StatusOptions {
  port?: number;
  json?: boolean;
}

interface PluginDetail {
  name: string;
  displayName: string;
  toolCount: number;
  tabState: string;
  source?: string;
  sdkVersion?: string | null;
}

interface FailedPluginEntry {
  path: string;
  error: string;
}

const pad = (label: string) => `  ${pc.cyan(label.padEnd(16))}`;

const formatUptime = (seconds: number): string => {
  seconds = Math.floor(seconds);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return `${hours}h ${mins}m`;
  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  return `${days}d ${hrs}h`;
};

const colorTabState = (tabState: string): string => {
  if (tabState === 'ready') return pc.green(tabState);
  if (tabState === 'unavailable') return pc.yellow(tabState);
  return pc.dim(tabState);
};

const isTimeout = (err: unknown): boolean => err instanceof DOMException && err.name === 'TimeoutError';

/**
 * Returns true when a non-2xx HTTP response likely indicates the port is running
 * a different service rather than an OpenTabs server.
 *
 * - 4xx (excluding 401, which is handled separately): a different service responded.
 * - Non-JSON content type (e.g., text/html from Next.js): not OpenTabs.
 */
const isNonOpenTabsHttpError = (status: number, contentType: string | null): boolean => {
  // 4xx except 401 (401 means the server IS OpenTabs but auth failed): likely a different service
  if (status >= 400 && status < 500 && status !== 401) return true;
  // Non-JSON content type (e.g., text/html from Next.js) strongly indicates not OpenTabs
  if (contentType !== null && !contentType.includes('application/json') && !contentType.includes('text/plain'))
    return true;
  return false;
};

const handleStatus = async (options: StatusOptions): Promise<void> => {
  const port = resolvePort(options);
  const url = `http://${DEFAULT_HOST}:${port}/health`;

  const secret = await readAuthSecret();

  try {
    const headers: Record<string, string> = {};
    if (secret) headers.Authorization = `Bearer ${secret}`;

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(3_000) });
    if (res.status === 401) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'auth_failed', error: 'Authentication failed' }));
      } else {
        console.error(pc.red('Authentication failed.'));
        console.error(
          pc.dim(
            'The secret in ~/.opentabs/extension/auth.json may not match the running server.\n' +
              'Try restarting the server or running: opentabs config rotate-secret --confirm',
          ),
        );
      }
      process.exit(1);
    }

    if (!res.ok) {
      const contentType = res.headers.get('content-type');
      if (isNonOpenTabsHttpError(res.status, contentType)) {
        if (options.json) {
          console.log(JSON.stringify({ status: 'not_found', error: `No OpenTabs server found on port ${port}` }));
        } else {
          console.error(pc.red(`No OpenTabs server found on port ${port}.`));
          console.error(pc.dim('The port may be in use by another service.'));
        }
      } else {
        if (options.json) {
          console.log(JSON.stringify({ status: 'error', error: `MCP server returned HTTP ${res.status}` }));
        } else {
          console.error(pc.red(`Error: MCP server returned HTTP ${res.status}.`));
          console.error(pc.dim('The server may be misconfigured. Check the server logs for details.'));
        }
      }
      process.exit(1);
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.status !== 'string' || typeof data.version !== 'string' || typeof data.toolCount !== 'number') {
      if (options.json) {
        console.log(JSON.stringify({ status: 'not_found', error: `No OpenTabs server found on port ${port}` }));
      } else {
        console.error(pc.red(`No OpenTabs server found on port ${port}.`));
        console.error(pc.dim('The port may be in use by another service.'));
      }
      process.exit(1);
    }
    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      const mcpClients = Number(data.mcpClients) || 0;
      const plugins = Number(data.plugins) || 0;
      const toolCount = data.toolCount || 0;
      const browserToolCount = typeof data.browserToolCount === 'number' ? data.browserToolCount : null;
      const pluginToolCount = typeof data.pluginToolCount === 'number' ? data.pluginToolCount : null;
      const uptime = Number(data.uptime) || 0;
      const pluginDetails = Array.isArray(data.pluginDetails) ? (data.pluginDetails as PluginDetail[]) : [];

      const serverSdkVersion = typeof data.sdkVersion === 'string' ? data.sdkVersion : null;

      console.log(pc.bold('OpenTabs MCP Server'));
      console.log(`${pad('Status')}${pc.green('running')}`);
      console.log(`${pad('Version')}${data.version}`);
      if (serverSdkVersion) {
        console.log(`${pad('SDK')}${serverSdkVersion}`);
      }
      console.log(`${pad('Port')}${String(port)}`);
      const pidPath = getPidFilePath();
      try {
        const pidFileData = parsePidFile(await readFile(pidPath, 'utf-8'));
        if (pidFileData !== null) {
          try {
            process.kill(pidFileData.pid, 0);
            console.log(`${pad('PID')}${pidFileData.pid} ${pc.dim('(background)')}`);
          } catch {
            // Stale PID file — clean up silently
            await unlink(pidPath).catch(() => {});
          }
        }
      } catch {
        // No PID file — foreground mode, skip
      }
      console.log(`${pad('Uptime')}${formatUptime(uptime)}`);
      console.log(`${pad('Extension')}${data.extensionConnected ? pc.green('connected') : pc.yellow('not connected')}`);
      console.log(`${pad('MCP clients')}${mcpClients > 0 ? pc.green(String(mcpClients)) : pc.dim('0')}`);
      console.log(`${pad('Plugins')}${plugins > 0 ? pc.green(String(plugins)) : pc.yellow('0')}`);
      if (browserToolCount !== null && pluginToolCount !== null) {
        console.log(
          `${pad('Browser tools')}${browserToolCount > 0 ? pc.green(String(browserToolCount)) : pc.dim('0')}`,
        );
        console.log(`${pad('Plugin tools')}${pluginToolCount > 0 ? pc.green(String(pluginToolCount)) : pc.dim('0')}`);
      } else {
        console.log(`${pad('Tools')}${toolCount > 0 ? pc.green(String(toolCount)) : pc.dim('0')}`);
      }
      console.log(`${pad('Plugin reloads')}${typeof data.reloadCount === 'number' ? String(data.reloadCount) : '0'}`);

      if (mcpClients === 0) {
        console.log('');
        console.log(
          pc.dim('  No MCP clients connected. Run opentabs config show --show-secret for setup instructions.'),
        );
      }

      if (pluginDetails.length > 0) {
        console.log('');
        console.log(pc.bold('  Plugins'));
        for (const p of pluginDetails) {
          const state = colorTabState(p.tabState);
          const tools = pc.dim(`${p.toolCount} tool${p.toolCount === 1 ? '' : 's'}`);
          const sourceLabel = p.source === 'local' ? ` ${pc.dim('(local)')}` : ` ${pc.dim('(npm)')}`;
          const sdkWarning = p.sdkVersion === null ? ` ${pc.yellow('⚠ no SDK version')}` : '';
          console.log(
            `    ${p.displayName}${sourceLabel} ${pc.dim('—')} ${state} ${pc.dim('·')} ${tools}${sdkWarning}`,
          );
        }
      }

      const failedPlugins = Array.isArray(data.failedPlugins) ? (data.failedPlugins as FailedPluginEntry[]) : [];
      if (failedPlugins.length > 0) {
        console.log('');
        console.log(pc.bold('  Failed Plugins'));
        for (const f of failedPlugins) {
          console.log(`    ${pc.red(f.path)} ${pc.dim('—')} ${f.error}`);
        }
      }
    }
  } catch (err: unknown) {
    const startHint = `Start it with: opentabs start${port !== 9515 ? ` --port ${port}` : ''}`;

    if (isConnectionRefused(err)) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'not_running', error: 'Server not running' }));
      } else {
        console.error(pc.red('Server not running'));
        console.error(pc.dim(startHint));
      }
    } else if (isTimeout(err)) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'timeout', error: 'Server not responding (timed out after 3s)' }));
      } else {
        console.error(pc.red('Server not responding (timed out after 3s)'));
        console.error(pc.dim(`The server at port ${port} did not respond in time.`));
      }
    } else if (err instanceof SyntaxError) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'invalid_response', error: 'Server returned invalid response' }));
      } else {
        console.error(pc.red('Server returned invalid response'));
        console.error(pc.dim('The health endpoint did not return valid JSON.'));
      }
    } else {
      const message = toErrorMessage(err);
      if (options.json) {
        console.log(JSON.stringify({ status: 'error', error: message }));
      } else {
        console.error(pc.red(`Error: ${message}`));
        console.error(pc.dim(startHint));
      }
    }

    process.exit(1);
  }
};

const registerStatusCommand = (program: Command): void => {
  program
    .command('status')
    .description('Show server status and connected plugins')
    .option('--port <number>', 'Server port to check (default: 9515)', parsePort)
    .option('--json', 'Output raw JSON from the health endpoint')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs status
  $ opentabs status --json
  $ opentabs status --port 3000`,
    )
    .action((_options: StatusOptions, command: Command) => handleStatus(command.optsWithGlobals()));
};

export { colorTabState, formatUptime, handleStatus, isNonOpenTabsHttpError, isTimeout, registerStatusCommand };
