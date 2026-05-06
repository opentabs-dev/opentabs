/**
 * `opentabs tool` command — discover and invoke tools from the running server.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

/**
 * Loose content-part shape for defensive parsing of tool-call responses.
 * Diverges intentionally from the server's strict `ToolContentPart` discriminated
 * union (in `@opentabs-dev/shared` once exported, currently in mcp-server's
 * browser-tools/definition.ts): `type` is widened to `string` and the variant
 * fields are optional so a server emitting an unknown or partial part does not
 * crash the CLI before it can report it.
 */
interface ToolCallContentPart {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

interface ToolCallResult {
  content: ToolCallContentPart[];
  isError?: boolean;
}

/** Map a MIME type to a conventional file extension for saved image files */
const extForMime = (mimeType: string): string => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'bin';
};

/**
 * Render an MCP tool-call content array for display at the terminal.
 * Text parts are returned verbatim. Image parts are written to disk via the
 * injected `saveImage` callback and summarised as a line referencing the
 * saved path. Unknown or malformed parts are reported rather than silently
 * dropped, so the user sees that something non-text came back.
 */
const renderToolCallContent = (
  content: ToolCallContentPart[],
  saveImage: (data: string, mimeType: string, index: number) => string,
): string => {
  const lines: string[] = [];
  content.forEach((part, i) => {
    if (part.type === 'text') {
      if (typeof part.text !== 'string') {
        lines.push(`[malformed text content part at index ${i}]`);
        return;
      }
      lines.push(part.text);
      return;
    }
    if (part.type === 'image') {
      if (typeof part.data !== 'string' || typeof part.mimeType !== 'string') {
        lines.push(`[malformed image content part at index ${i}]`);
        return;
      }
      const path = saveImage(part.data, part.mimeType, i);
      const bytes = Math.floor((part.data.length * 3) / 4);
      lines.push(`[image: type=${part.mimeType}, ~${bytes} bytes, saved to ${path}]`);
      return;
    }
    lines.push(`[unsupported content part at index ${i}: type=${part.type}]`);
  });
  return lines.join('\n');
};

export { renderToolCallContent };

const handleToolCall = async (
  name: string,
  jsonArg: string | undefined,
  options: { port?: number; params?: string; instance?: string; tabId?: number },
): Promise<void> => {
  const port = resolvePort(options);

  // Parse arguments from positional JSON or --params flag (flag takes precedence)
  const rawJson = options.params ?? jsonArg;
  let args: Record<string, unknown> = {};
  if (rawJson) {
    try {
      args = JSON.parse(rawJson) as Record<string, unknown>;
    } catch {
      console.error(pc.red(`Invalid JSON: ${rawJson}`));
      process.exit(2);
    }
  }

  // Merge --instance and --tab-id into args
  if (options.instance) args.instance = options.instance;
  if (options.tabId !== undefined) args.tabId = options.tabId;

  const secret = await readAuthSecret();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers.Authorization = `Bearer ${secret}`;

  let res: Response;
  try {
    res = await fetch(`http://${DEFAULT_HOST}:${port}/tools/${encodeURIComponent(name)}/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ arguments: args }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (err: unknown) {
    if (isConnectionRefused(err)) {
      console.error(pc.red('Server is not running.'));
      console.error(`Start it with: ${pc.cyan('opentabs start')}`);
      process.exit(2);
    }
    console.error(pc.red(`Failed to call tool: ${toErrorMessage(err)}`));
    process.exit(2);
  }

  if (res.status === 401) {
    console.error(pc.red('Authentication failed. Is the server running with the same config?'));
    process.exit(2);
  }

  if (res.status === 429) {
    console.error(pc.red('Rate limited. Try again later.'));
    process.exit(2);
  }

  const result = (await res.json()) as ToolCallResult;

  // Save image content parts to tmpdir so their paths can be reported to the user.
  // The tool name is user-supplied and could contain path separators or characters
  // that are invalid on the host OS, so sanitize it before composing the filename
  // to prevent path traversal and unwritable paths. A failed write (e.g. full disk,
  // permissions) is wrapped so the caller gets a readable error rather than a crash.
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64) || 'tool';
  const saveImage = (data: string, mimeType: string, index: number): string => {
    const ext = extForMime(mimeType);
    const filename = `opentabs-${safeName}-${Date.now()}-${index}.${ext}`;
    const path = join(tmpdir(), filename);
    try {
      writeFileSync(path, Buffer.from(data, 'base64'));
    } catch (err) {
      throw new Error(
        `Failed to save image content part (mimeType=${mimeType}, target=${path}): ${toErrorMessage(err)}`,
      );
    }
    return path;
  };

  const output = renderToolCallContent(result.content, saveImage);

  if (result.isError) {
    console.error(output);
    process.exit(1);
  }

  // Pretty-print text-only output if it parses as JSON. Mixed or image-bearing
  // output is not JSON-parseable and is printed verbatim.
  const textOnly = result.content.length === 1 && result.content[0]?.type === 'text';
  if (textOnly) {
    try {
      const parsed: unknown = JSON.parse(output);
      console.log(JSON.stringify(parsed, null, 2));
      return;
    } catch {
      // fall through to plain print
    }
  }
  console.log(output);
};

const handleToolSchema = async (name: string, options: { port?: number }): Promise<void> => {
  const port = resolvePort(options);

  let tools: ToolEntry[];
  try {
    tools = await fetchTools(port);
  } catch (err: unknown) {
    if (isConnectionRefused(err)) {
      console.error(pc.red('Server is not running.'));
      console.error(`Start it with: ${pc.cyan('opentabs start')}`);
      process.exit(1);
    }
    console.error(pc.red(`Failed to fetch tools: ${toErrorMessage(err)}`));
    process.exit(1);
  }

  const tool = tools.find(t => t.name === name);
  if (!tool) {
    console.error(pc.red(`Tool "${name}" not found.`));
    console.error(`Run ${pc.cyan('opentabs tool list')} to see all available tools.`);
    process.exit(1);
  }

  console.log(
    JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }, null, 2),
  );
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

  toolCmd
    .command('schema')
    .description('Show the full input schema for a tool')
    .argument('<name>', 'Tool name (e.g., slack_send_message)')
    .option('--port <number>', 'Server port', parsePort)
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs tool schema slack_send_message
  $ opentabs tool schema browser_list_tabs`,
    )
    .action((name: string, _options: unknown, command: Command) => handleToolSchema(name, command.optsWithGlobals()));

  toolCmd
    .command('call')
    .description('Invoke a tool on the running server')
    .argument('<name>', 'Tool name (e.g., slack_send_message, browser_list_tabs)')
    .argument('[json]', 'Tool arguments as a JSON string')
    .option('--params <json>', 'Tool arguments as JSON (alternative to positional arg)')
    .option('--instance <name>', 'Target a named instance (for multi-instance plugins)')
    .option('--tab-id <id>', 'Target a specific browser tab by ID', Number.parseInt)
    .option('--port <number>', 'Server port', parsePort)
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs tool call slack_send_message '{"channel":"C123","text":"hi"}'
  $ opentabs tool call browser_list_tabs
  $ opentabs tool call slack_send_message --params '{"channel":"C123"}'
  $ opentabs tool call slack_read_messages --instance work --tab-id 42`,
    )
    .action((name: string, jsonArg: string | undefined, _options: unknown, command: Command) =>
      handleToolCall(name, jsonArg, command.optsWithGlobals()),
    );
};

export { registerToolCommand };
