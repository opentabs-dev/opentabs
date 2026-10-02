/**
 * `opentabs tool` command — discover and invoke tools from the running server.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { atomicWrite, DEFAULT_HOST, toErrorMessage } from '@opentabs-dev/shared';
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

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface ParamsSource {
  json: string;
  origin: string;
}

export const readParamsSource = async (
  jsonArg: string | undefined,
  params: string | undefined,
  paramsFile: string | undefined,
): Promise<ParamsSource | undefined> => {
  const sources: string[] = [];
  if (jsonArg !== undefined) sources.push('[json]');
  if (params !== undefined) sources.push('--params');
  if (paramsFile !== undefined) sources.push('--params-file');

  if (sources.length > 1) {
    console.error(pc.red(`Specify only one of: ${sources.join(', ')}`));
    process.exit(2);
  }

  if (paramsFile !== undefined) {
    if (paramsFile === '-') {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      return { json: Buffer.concat(chunks).toString('utf8'), origin: 'stdin' };
    }
    try {
      const json = await readFile(paramsFile, 'utf8');
      return { json, origin: paramsFile };
    } catch (err: unknown) {
      console.error(pc.red(`Failed to read params file ${paramsFile}: ${toErrorMessage(err)}`));
      process.exit(2);
    }
  }

  if (params !== undefined) return { json: params, origin: '--params' };
  if (jsonArg !== undefined) return { json: jsonArg, origin: '[json]' };
  return undefined;
};

/** A `--attach`/`--save` argument: a dot path into the JSON and a local file path. */
export interface FileMapping {
  field: string;
  segments: string[];
  path: string;
}

const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const BASE64_PATTERN = /^[A-Za-z0-9+/_-]*={0,2}$/;
const ARRAY_INDEX_PATTERN = /^(0|[1-9]\d*)$/;

const isContainer = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isValidSegment = (s: string): boolean =>
  s !== '' && !UNSAFE_SEGMENTS.has(s) && (!/^\d+$/.test(s) || ARRAY_INDEX_PATTERN.test(s));

/**
 * Parse `<field>=<file>`, where `<field>` is a dot path whose numeric segments
 * index arrays. The returned path is absolute.
 */
export const parseFileMapping = (spec: string, flag: string): FileMapping => {
  const eq = spec.indexOf('=');
  const field = spec.slice(0, eq);
  const path = spec.slice(eq + 1);
  const segments = field.split('.');
  if (eq <= 0 || !path || !segments.every(isValidSegment)) {
    throw new Error(`${flag} expects <field>=<file> with a dot-path field, got "${spec}"`);
  }
  return { field, segments, path: resolve(path) };
};

/**
 * Set `value` at `segments`, creating objects (or arrays, for numeric next segments)
 * along the way. Array indexes may append but not skip, since holes serialize as null,
 * and arrays reject named keys, which JSON.stringify drops.
 */
export const setField = (root: Record<string, unknown>, segments: string[], value: unknown): void => {
  const checkArrayKey = (node: unknown, key: string, depth: number): void => {
    if (!Array.isArray(node)) return;
    const parent = segments.slice(0, depth).join('.');
    if (!ARRAY_INDEX_PATTERN.test(key)) {
      throw new Error(`Cannot set "${segments.join('.')}": "${parent}" is an array, so "${key}" must be an index`);
    }
    if (Number(key) > node.length) {
      throw new Error(`Cannot set "${segments.join('.')}": index ${key} skips past the end of "${parent}"`);
    }
  };
  let node = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i] as string;
    checkArrayKey(node, key, i);
    let next = Object.hasOwn(node, key) ? node[key] : undefined;
    if (next === undefined) {
      next = /^\d+$/.test(segments[i + 1] as string) ? [] : {};
      node[key] = next;
    } else if (!isContainer(next)) {
      throw new Error(`Cannot set "${segments.join('.')}": "${segments.slice(0, i + 1).join('.')}" is not an object`);
    }
    node = next as Record<string, unknown>;
  }
  const last = segments.at(-1) as string;
  checkArrayKey(node, last, segments.length - 1);
  node[last] = value;
};

/**
 * Decode the base64 string at `mapping.field` in a tool result. Refuses when the
 * field's parent declares a non-base64 `encoding`, since short text is often valid base64.
 */
export const decodeBase64Field = (result: unknown, { field, segments }: FileMapping): Buffer => {
  let parent: unknown;
  let value: unknown = result;
  for (const key of segments) {
    if (!isContainer(value) || !Object.hasOwn(value, key))
      throw new Error(`--save: field "${field}" not found in result`);
    parent = value;
    value = value[key];
  }
  if (typeof value !== 'string') throw new Error(`--save: field "${field}" is not a string`);
  const encoding = isContainer(parent) && Object.hasOwn(parent, 'encoding') ? parent.encoding : 'base64';
  if (encoding !== 'base64') throw new Error(`--save: field "${field}" has a non-base64 encoding`);
  const compact = value.replace(/\s+/g, '');
  const bytes = Buffer.from(compact, 'base64');
  // Buffer.from silently drops dangling characters and stray bits, so require the input
  // to equal the canonical encoding of what it decoded to.
  const unpadded = compact.replace(/=+$/, '');
  const canonical = bytes.toString('base64url');
  if (
    !BASE64_PATTERN.test(compact) ||
    (unpadded !== compact && compact.length % 4 !== 0) ||
    unpadded.replace(/\+/g, '-').replace(/\//g, '_') !== canonical
  ) {
    throw new Error(`--save: field "${field}" is not valid base64`);
  }
  return bytes;
};

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

const handleToolCall = async (
  name: string,
  jsonArg: string | undefined,
  options: {
    port?: number;
    params?: string;
    paramsFile?: string;
    instance?: string;
    tabId?: number;
    attach?: string[];
    save?: string[];
    force?: boolean;
  },
): Promise<void> => {
  const port = resolvePort(options);

  const source = await readParamsSource(jsonArg, options.params, options.paramsFile);
  let args: Record<string, unknown> = {};
  if (source) {
    try {
      args = JSON.parse(source.json) as Record<string, unknown>;
    } catch (err: unknown) {
      const location =
        source.origin === 'stdin'
          ? 'on stdin'
          : source.origin === '--params' || source.origin === '[json]'
            ? ''
            : `in ${source.origin}`;
      const prefix = location ? `Invalid JSON ${location}` : 'Invalid JSON';
      console.error(pc.red(`${prefix}: ${toErrorMessage(err)}`));
      process.exit(2);
    }
  }

  // Merge --instance and --tab-id into args
  if (options.instance) args.instance = options.instance;
  if (options.tabId !== undefined) args.tabId = options.tabId;

  // File paths come only from argv, never from params or the tool result.
  let saves: FileMapping[] = [];
  try {
    for (const spec of options.attach ?? []) {
      const { segments, path } = parseFileMapping(spec, '--attach');
      setField(args, segments, (await readFile(path)).toString('base64'));
    }
    saves = (options.save ?? []).map(spec => parseFileMapping(spec, '--save'));
    // Check destinations before the call so a side-effecting tool never runs with nowhere to save.
    const seen = new Set<string>();
    for (const { path } of saves) {
      const key = process.platform === 'win32' ? path.toLowerCase() : path;
      if (seen.has(key)) throw new Error(`--save: ${path} is given more than once`);
      seen.add(key);
      if (!existsSync(dirname(path))) throw new Error(`--save: directory ${dirname(path)} does not exist`);
      if (!options.force && existsSync(path))
        throw new Error(`--save: ${path} already exists (use --force to overwrite)`);
    }
  } catch (err: unknown) {
    console.error(pc.red(toErrorMessage(err)));
    process.exit(2);
  }

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

  // Extract text content from the result
  const texts = result.content.filter(c => c.type === 'text').map(c => c.text);
  const output = texts.join('\n');

  if (result.isError) {
    console.error(output);
    process.exit(1);
  }

  if (saves.length > 0) {
    try {
      const parsed = JSON.parse(output) as Record<string, unknown>;
      // Decode every field before writing any file so a bad field leaves the disk untouched.
      const decoded = saves.map(s => ({ ...s, bytes: decodeBase64Field(parsed, s) }));
      for (const { segments, path, bytes } of decoded) {
        // Without --force, create exclusively in case the file appeared during the call.
        if (options.force) await atomicWrite(path, bytes);
        else
          await writeFile(path, bytes, { flag: 'wx' }).catch((err: unknown) => {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
            throw new Error(`--save: ${path} already exists (use --force to overwrite)`);
          });
        setField(parsed, segments, { savedTo: path, bytes: bytes.length });
      }
      console.log(JSON.stringify(parsed, null, 2));
    } catch (err: unknown) {
      console.error(pc.red(err instanceof SyntaxError ? '--save: tool result is not JSON' : toErrorMessage(err)));
      process.exit(2);
    }
    return;
  }

  // Print result to stdout — try to pretty-print if it's valid JSON
  try {
    const parsed: unknown = JSON.parse(output);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(output);
  }
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
    .argument('<name>', 'Tool name (e.g., slack__send_message)')
    .option('--port <number>', 'Server port', parsePort)
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs tool schema slack__send_message
  $ opentabs tool schema browser_list_tabs`,
    )
    .action((name: string, _options: unknown, command: Command) => handleToolSchema(name, command.optsWithGlobals()));

  toolCmd
    .command('call')
    .description('Invoke a tool on the running server')
    .argument('<name>', 'Tool name (e.g., slack__send_message, browser_list_tabs)')
    .argument('[json]', 'Tool arguments as a JSON string')
    .option('--params <json>', 'Tool arguments as JSON (alternative to positional arg)')
    .option(
      '--params-file <path>',
      'Read tool arguments as JSON from a file path (use - for stdin). Bypasses the argv size limit.',
    )
    .option('--instance <name>', 'Target a named instance (for multi-instance plugins)')
    .option('--tab-id <id>', 'Target a specific browser tab by ID', Number.parseInt)
    .option('--attach <field=file>', 'Base64-encode a file into an argument field (repeatable)', collect)
    .option('--save <field=file>', 'Base64-decode a result field into a file (repeatable)', collect)
    .option('--force', 'Overwrite existing files with --save')
    .option('--port <number>', 'Server port', parsePort)
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs tool call slack__send_message '{"channel":"C123","text":"hi"}'
  $ opentabs tool call browser_list_tabs
  $ opentabs tool call slack__send_message --params '{"channel":"C123"}'
  $ opentabs tool call slack__read_messages --instance work --tab-id 42
  $ opentabs tool call my-plugin__upload_photo --params-file payload.json
  $ cat payload.json | opentabs tool call my-plugin__upload_photo --params-file -
  $ opentabs tool call slack__upload_file '{"channel":"C123","filename":"a.pdf","is_base64":true}' --attach content=a.pdf
  $ opentabs tool call browser_screenshot_tab '{"tabId":42}' --save image=shot.png`,
    )
    .action((name: string, jsonArg: string | undefined, _options: unknown, command: Command) =>
      handleToolCall(name, jsonArg, command.optsWithGlobals()),
    );
};

export { registerToolCommand };
