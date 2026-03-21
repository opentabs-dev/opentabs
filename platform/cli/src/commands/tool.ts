/**
 * `opentabs tool` command — discover and invoke tools from the running server.
 */

import { DEFAULT_HOST, toErrorMessage } from '@opentabs-dev/shared';
import type { Command } from 'commander';
import pc from 'picocolors';
import { isConnectionRefused, readAuthSecret } from '../config.js';
import { parsePort, resolvePort } from '../parse-port.js';

interface ToolEntry {
  name: string;
  description: string;
  plugin: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Fetch the tool list from the running server's GET /tools endpoint.
 */
const fetchTools = async (port: number, plugin?: string): Promise<ToolEntry[]> => {
  const secret = await readAuthSecret();
  const headers: Record<string, string> = {};
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const url = new URL(`http://${DEFAULT_HOST}:${port}/tools`);
  if (plugin) url.searchParams.set('plugin', plugin);

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(5_000),
  });

  if (res.status === 401) {
    console.error(pc.red('Authentication failed. Is the server running with the same config?'));
    process.exit(1);
  }

  if (!res.ok) {
    console.error(pc.red(`Server returned ${res.status}: ${res.statusText}`));
    process.exit(1);
  }

  return (await res.json()) as ToolEntry[];
};

interface ToolListOptions {
  port?: number;
  json?: boolean;
  plugin?: string;
}

const handleToolList = async (options: ToolListOptions): Promise<void> => {
  const port = resolvePort(options);

  let tools: ToolEntry[];
  try {
    tools = await fetchTools(port, options.plugin);
  } catch (err: unknown) {
    if (isConnectionRefused(err)) {
      console.error(pc.red('Server is not running.'));
      console.error(`Start it with: ${pc.cyan('opentabs start')}`);
      process.exit(1);
    }
    console.error(pc.red(`Failed to fetch tools: ${toErrorMessage(err)}`));
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(tools, null, 2));
    return;
  }

  if (tools.length === 0) {
    if (options.plugin) {
      console.log(pc.dim(`No tools found for plugin "${options.plugin}".`));
    } else {
      console.log(pc.dim('No tools available.'));
    }
    return;
  }

  // Group tools by plugin
  const groups = new Map<string, ToolEntry[]>();
  for (const tool of tools) {
    const group = groups.get(tool.plugin) ?? [];
    group.push(tool);
    groups.set(tool.plugin, group);
  }

  // Find the longest tool name for alignment
  const maxNameLen = Math.max(...tools.map(t => t.name.length));

  console.log();
  console.log(pc.bold('Available Tools'));
  console.log();

  for (const [plugin, pluginTools] of groups) {
    const count = pluginTools.length;
    console.log(`  ${pc.bold(plugin)} ${pc.dim(`— ${count} tool${count === 1 ? '' : 's'}`)}`);

    for (const tool of pluginTools) {
      const padding = ' '.repeat(maxNameLen - tool.name.length);
      const desc = tool.description || '';
      console.log(`    ${pc.cyan(tool.name)}${padding}  ${pc.dim(desc)}`);
    }

    console.log();
  }
};

const registerToolCommand = (program: Command): void => {
  const toolCmd = program
    .command('tool')
    .description('Discover and invoke plugin tools')
    .action(() => {
      toolCmd.help();
    });

  toolCmd
    .command('list')
    .alias('ls')
    .description('List available tools from the running server')
    .option('--port <number>', 'Server port', parsePort)
    .option('--json', 'Output full tool schemas as JSON')
    .option('--plugin <name>', 'Filter by plugin name')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs tool list
  $ opentabs tool list --json
  $ opentabs tool list --plugin slack
  $ opentabs tool list --plugin browser`,
    )
    .action((_options: ToolListOptions, command: Command) => handleToolList(command.optsWithGlobals()));
};

export { registerToolCommand };
