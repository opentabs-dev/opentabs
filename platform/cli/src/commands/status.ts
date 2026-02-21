/**
 * `opentabs status` command — shows server status and connected plugins.
 */

import { isConnectionRefused } from '../config.js';
import { parsePort, resolvePort } from '../parse-port.js';
import pc from 'picocolors';
import type { Command } from 'commander';

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

const pad = (label: string) => `  ${pc.cyan(label.padEnd(14))}`;

const formatUptime = (seconds: number): string => {
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

const handleStatus = async (options: StatusOptions): Promise<void> => {
  const port = resolvePort(options);
  const url = `http://localhost:${port}/health`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) {
      console.error(pc.red(`Error: MCP server returned HTTP ${res.status}.`));
      console.error('The server may be misconfigured. Check the server logs for details.');
      process.exit(1);
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      const mcpClients = Number(data.mcpClients) || 0;
      const plugins = Number(data.plugins) || 0;
      const toolCount = Number(data.toolCount) || 0;
      const uptime = Number(data.uptime) || 0;
      const pluginDetails = Array.isArray(data.pluginDetails) ? (data.pluginDetails as PluginDetail[]) : [];

      const serverSdkVersion = typeof data.sdkVersion === 'string' ? data.sdkVersion : null;

      console.log(pc.bold('OpenTabs MCP Server'));
      console.log(`${pad('Status')}${pc.green('running')}`);
      console.log(`${pad('Version')}${String(data.version)}`);
      if (serverSdkVersion) {
        console.log(`${pad('SDK')}${serverSdkVersion}`);
      }
      console.log(`${pad('Port')}${String(port)}`);
      console.log(`${pad('Uptime')}${formatUptime(uptime)}`);
      console.log(`${pad('Extension')}${data.extensionConnected ? pc.green('connected') : pc.yellow('not connected')}`);
      console.log(`${pad('MCP clients')}${mcpClients > 0 ? pc.green(String(mcpClients)) : pc.dim('0')}`);
      console.log(`${pad('Plugins')}${plugins > 0 ? pc.green(String(plugins)) : pc.yellow('0')}`);
      console.log(`${pad('Tools')}${toolCount > 0 ? pc.green(String(toolCount)) : pc.dim('0')}`);
      console.log(`${pad('Plugin reloads')}${String(data.reloadCount)}`);

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
      console.error(pc.red('Server not running'));
      console.error(pc.dim(startHint));
    } else if (isTimeout(err)) {
      console.error(pc.red('Server not responding (timed out after 3s)'));
      console.error(pc.dim(`The server at port ${port} did not respond in time.`));
    } else if (err instanceof SyntaxError) {
      console.error(pc.red('Server returned invalid response'));
      console.error(pc.dim('The health endpoint did not return valid JSON.'));
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`Error: ${message}`));
      console.error(pc.dim(startHint));
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

export { colorTabState, formatUptime, isTimeout, registerStatusCommand };
