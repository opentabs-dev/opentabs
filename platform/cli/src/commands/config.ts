/**
 * `opentabs config` command — view and manage configuration.
 */

import { getMcpClientConfigs, printMcpClientConfigs } from './start.js';
import {
  atomicWriteConfig,
  getConfigPath,
  getExtensionDir,
  isConnectionRefused,
  readAuthSecret,
  readConfig,
} from '../config.js';
import { notifyServer } from '../notify-server.js';
import { resolvePort } from '../parse-port.js';
import { atomicWrite, DEFAULT_HOST, DEFAULT_PORT, generateSecret, toErrorMessage } from '@opentabs-dev/shared';
import pc from 'picocolors';
import { existsSync } from 'node:fs';
import { access, mkdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Command } from 'commander';

const handleConfigPath = (): void => {
  console.log(getConfigPath());
};

interface ConfigShowOptions {
  json?: boolean;
  showSecret?: boolean;
}

const maskSecret = (secret: string): string => {
  if (secret.length > 8) return secret.slice(0, 4) + '...' + secret.slice(-4);
  return '****';
};

const CANONICAL_CONFIG_SECTIONS = ['localPlugins', 'tools', 'browserToolPolicy', 'permissions'] as const;

/**
 * Normalize a raw config object for display: ensures expected sections always appear
 * in canonical order (localPlugins, tools, browserToolPolicy, permissions) regardless
 * of whether they were written to the config file. Does not modify the file.
 */
const normalizeConfigForDisplay = (config: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  // Non-canonical keys (e.g., port) first, in their original config order
  for (const key of Object.keys(config)) {
    if (!(CANONICAL_CONFIG_SECTIONS as readonly string[]).includes(key)) {
      normalized[key] = config[key];
    }
  }
  // Canonical sections always appear in defined order with defaults for absent keys
  normalized['localPlugins'] = config['localPlugins'] ?? [];
  normalized['tools'] = config['tools'] ?? {};
  normalized['browserToolPolicy'] = config['browserToolPolicy'] ?? {};
  normalized['permissions'] = config['permissions'] ?? {};
  return normalized;
};

const handleConfigShow = async (options: ConfigShowOptions & { port?: number }): Promise<void> => {
  const configPath = getConfigPath();
  const result = await readConfig(configPath);

  if (!result.config) {
    if (result.error === 'invalid') {
      console.error(pc.red(`Invalid config at ${configPath}: ${result.message}`));
    } else {
      console.error(pc.red(`No config found at ${configPath}`));
    }
    console.error('Run opentabs start to auto-create config.');
    process.exit(1);
  }

  const config = result.config;
  const normalized = normalizeConfigForDisplay(config);
  const secret = await readAuthSecret();
  const displaySecret = secret ? (options.showSecret ? secret : maskSecret(secret)) : null;

  if (options.json) {
    let mcpClients: Record<string, { name: string; file: string; json: Record<string, unknown> }> | undefined;
    if (options.showSecret) {
      const port = resolvePort(options);
      const mcpUrl = `http://127.0.0.1:${port}/mcp`;
      mcpClients = Object.fromEntries(
        getMcpClientConfigs(mcpUrl, secret).map(({ label, file, json }) => [label, { name: label, file, json }]),
      );
    }
    const output = {
      ...normalized,
      ...(displaySecret ? { secret: displaySecret } : {}),
      ...(mcpClients !== undefined ? { mcpClients } : {}),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(pc.bold('OpenTabs Config'));
    console.log(pc.dim(configPath));
    console.log('');

    for (const [key, value] of Object.entries(normalized)) {
      if (key === 'localPlugins' && Array.isArray(value)) {
        console.log(`  ${pc.cyan('localPlugins')}`);
        if (value.length === 0) {
          console.log(`    ${pc.dim('(none)')}`);
        } else {
          for (const p of value) {
            console.log(`    - ${String(p)}`);
          }
        }
      } else if (key === 'tools' && typeof value === 'object' && value !== null) {
        const entries = Object.entries(value as Record<string, unknown>);
        console.log(`  ${pc.cyan('tools')}`);
        if (entries.length === 0) {
          console.log(`    ${pc.dim('(none)')}`);
        } else {
          for (const [toolName, enabled] of entries) {
            const indicator = enabled ? pc.green('enabled') : pc.red('disabled');
            console.log(`    ${toolName}: ${indicator}`);
          }
        }
      } else if (key === 'browserToolPolicy' && typeof value === 'object' && value !== null) {
        const entries = Object.entries(value as Record<string, unknown>);
        console.log(`  ${pc.cyan('browserToolPolicy')}`);
        if (entries.length === 0) {
          console.log(`    ${pc.dim('(none)')}`);
        } else {
          for (const [toolName, enabled] of entries) {
            const indicator = enabled ? pc.green('enabled') : pc.red('disabled');
            console.log(`    ${toolName}: ${indicator}`);
          }
        }
      } else if (key === 'permissions' && typeof value === 'object' && value !== null) {
        const perms = value as Record<string, unknown>;
        console.log(`  ${pc.cyan('permissions')}`);

        const trustedDomains = Array.isArray(perms.trustedDomains) ? (perms.trustedDomains as unknown[]) : [];
        console.log(`    trustedDomains`);
        if (trustedDomains.length === 0) {
          console.log(`      ${pc.dim('(none)')}`);
        } else {
          for (const d of trustedDomains) {
            console.log(`      - ${String(d)}`);
          }
        }

        const sensitiveDomains = Array.isArray(perms.sensitiveDomains) ? (perms.sensitiveDomains as unknown[]) : [];
        console.log(`    sensitiveDomains`);
        if (sensitiveDomains.length === 0) {
          console.log(`      ${pc.dim('(none)')}`);
        } else {
          for (const d of sensitiveDomains) {
            console.log(`      - ${String(d)}`);
          }
        }

        const toolPolicyEntries =
          typeof perms.toolPolicy === 'object' && perms.toolPolicy !== null && !Array.isArray(perms.toolPolicy)
            ? Object.entries(perms.toolPolicy as Record<string, unknown>)
            : [];
        console.log(`    toolPolicy`);
        if (toolPolicyEntries.length === 0) {
          console.log(`      ${pc.dim('(none)')}`);
        } else {
          for (const [toolName, policy] of toolPolicyEntries) {
            console.log(`      ${toolName}: ${String(policy)}`);
          }
        }

        const domainToolPolicyEntries =
          typeof perms.domainToolPolicy === 'object' &&
          perms.domainToolPolicy !== null &&
          !Array.isArray(perms.domainToolPolicy)
            ? Object.entries(perms.domainToolPolicy as Record<string, unknown>)
            : [];
        console.log(`    domainToolPolicy`);
        if (domainToolPolicyEntries.length === 0) {
          console.log(`      ${pc.dim('(none)')}`);
        } else {
          for (const [domain, toolsPolicy] of domainToolPolicyEntries) {
            console.log(`      ${domain}`);
            if (typeof toolsPolicy === 'object' && toolsPolicy !== null && !Array.isArray(toolsPolicy)) {
              for (const [toolName, policy] of Object.entries(toolsPolicy as Record<string, unknown>)) {
                console.log(`        ${toolName}: ${String(policy)}`);
              }
            }
          }
        }
      } else {
        const display =
          typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : JSON.stringify(value);
        console.log(`  ${pc.cyan(key)}  ${display}`);
      }
    }

    if (displaySecret) {
      console.log('');
      console.log(`  ${pc.cyan('secret')}  ${pc.dim(displaySecret)}`);
    }

    if (options.showSecret && secret) {
      const port = resolvePort(options);
      const mcpUrl = `http://127.0.0.1:${port}/mcp`;
      console.log('');
      console.log(pc.dim('  MCP client config (add to your client):'));
      console.log('');
      printMcpClientConfigs(mcpUrl, secret, false, false);
    }
  }
};

const TOOL_PREFIX = 'tool.';
const BROWSER_TOOL_PREFIX = 'browser-tool.';
const LOCAL_PLUGINS_ADD = 'localPlugins.add';
const LOCAL_PLUGINS_REMOVE = 'localPlugins.remove';
const PORT_KEY = 'port';

const SUPPORTED_KEYS = `Supported keys:
  tool.<plugin>_<tool>    Enable/disable a plugin tool (value: enabled | disabled)
  browser-tool.<name>     Enable/disable a browser tool (value: enabled | disabled)
  port                    Set the server port (value: 1-65535)
  localPlugins.add        Add a local plugin path (value: absolute or relative path)
  localPlugins.remove     Remove a local plugin path (value: path to remove)`;

const loadConfig = async (): Promise<{ config: Record<string, unknown>; configPath: string }> => {
  const configPath = getConfigPath();
  const result = await readConfig(configPath);
  if (!result.config) {
    if (result.error === 'invalid') {
      console.error(pc.red(`Invalid config at ${configPath}: ${result.message}`));
    } else {
      console.error(pc.red(`No config found at ${configPath}`));
    }
    console.error('Run opentabs start to auto-create config.');
    process.exit(1);
  }
  return { config: result.config, configPath };
};

interface HealthPluginDetail {
  name: string;
  displayName: string;
  tools: string[];
}

interface HealthResponse {
  pluginDetails?: HealthPluginDetail[];
  browserToolNames?: string[];
  disabledBrowserTools?: string[];
}

const fetchToolNames = async (port: number): Promise<string[] | null> => {
  try {
    const secret = await readAuthSecret();
    const headers: Record<string, string> = {};
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    const res = await fetch(`http://${DEFAULT_HOST}:${port}/health`, {
      headers,
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as HealthResponse;
    if (!Array.isArray(data.pluginDetails)) return null;
    return data.pluginDetails.flatMap(p => p.tools);
  } catch {
    return null;
  }
};

const fetchBrowserToolNames = async (port: number): Promise<string[] | null> => {
  try {
    const secret = await readAuthSecret();
    const headers: Record<string, string> = {};
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    const res = await fetch(`http://${DEFAULT_HOST}:${port}/health`, {
      headers,
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as HealthResponse;
    if (!Array.isArray(data.browserToolNames)) return null;
    return data.browserToolNames;
  } catch {
    return null;
  }
};

const handleListTools = async (options: { port?: number }): Promise<void> => {
  const port = resolvePort(options);
  const tools = await fetchToolNames(port);

  if (!tools) {
    console.error(pc.yellow('Cannot reach the MCP server to list available tools.'));
    console.error(`Start it with: ${pc.bold('opentabs start')}`);
    console.error('');
    console.error('Tool names use the format <plugin>_<tool>, e.g. slack_send_message');
    console.error(pc.dim('You can also list installed plugins with: opentabs plugin list'));
    process.exit(1);
  }

  if (tools.length === 0) {
    console.log(pc.dim('No plugin tools available (no plugins installed).'));
    console.log(pc.dim('Browser tools are managed with: opentabs config set browser-tool.<name> enabled|disabled'));
    return;
  }

  console.log(pc.bold('Available tools:'));
  for (const name of tools) {
    console.log(`  ${name}`);
  }
  console.log('');
  console.log(pc.dim('Usage: opentabs config set tool.<name> enabled|disabled'));
};

const handleListBrowserTools = async (options: { port?: number }): Promise<void> => {
  const port = resolvePort(options);
  const tools = await fetchBrowserToolNames(port);

  if (!tools) {
    console.error(pc.yellow('Cannot reach the MCP server to list available browser tools.'));
    console.error(`Start it with: ${pc.bold('opentabs start')}`);
    process.exit(1);
  }

  if (tools.length === 0) {
    console.log(pc.dim('No browser tools available (extension not connected).'));
    return;
  }

  console.log(pc.bold('Available browser tools:'));
  for (const name of tools) {
    console.log(`  ${name}`);
  }
  console.log('');
  console.log(pc.dim('Usage: opentabs config set browser-tool.<name> enabled|disabled'));
};

/**
 * Apply an enabled/disabled change to a policy map.
 * When enabled (the default), the entry is removed so defaults are not persisted.
 * When disabled, the entry is explicitly set to false.
 * Returns whether the entry was removed (true) or set to false (false).
 */
const applyPolicyEntry = (map: Record<string, boolean>, key: string, enabled: boolean): void => {
  if (enabled) {
    Reflect.deleteProperty(map, key);
  } else {
    map[key] = false;
  }
};

const handleSetTool = async (key: string, value: string, options: { port?: number }): Promise<void> => {
  const toolName = key.slice(TOOL_PREFIX.length);
  if (!toolName || !toolName.includes('_')) {
    console.error(pc.red(`Invalid tool name: ${toolName || '(empty)'}`));
    console.error('Tool names use the format <plugin>_<tool>, e.g. slack_send_message');
    console.error(`Run ${pc.bold('opentabs config set tool.')} to list available tools.`);
    process.exit(1);
  }

  if (value !== 'enabled' && value !== 'disabled') {
    console.error(pc.red(`Invalid value: ${value}`));
    console.error('Value must be "enabled" or "disabled".');
    process.exit(1);
  }

  const { config, configPath } = await loadConfig();

  if (!config.tools || typeof config.tools !== 'object' || Array.isArray(config.tools)) {
    config.tools = {};
  }
  const tools = config.tools as Record<string, boolean>;
  const enabled = value === 'enabled';
  applyPolicyEntry(tools, toolName, enabled);
  if (Object.keys(tools).length === 0) {
    delete config.tools;
  }

  await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');

  const indicator = enabled ? pc.green('enabled') : pc.red('disabled');
  console.log(`${toolName}: ${indicator}`);

  const port = resolvePort(options);
  const registeredTools = await fetchToolNames(port);
  if (registeredTools && !registeredTools.includes(toolName)) {
    console.log(
      pc.yellow(`Warning: "${toolName}" does not match any registered tool. Check the name or start the server.`),
    );
  } else if (!registeredTools) {
    console.log(
      pc.dim(`Note: Could not validate tool name (server not running). Verify with: opentabs config set tool.`),
    );
  }

  await notifyServer({ port: options.port, warnIfNotRunning: true });
};

const handleSetBrowserTool = async (key: string, value: string, options: { port?: number }): Promise<void> => {
  let toolName = key.slice(BROWSER_TOOL_PREFIX.length);
  if (!toolName) {
    console.error(pc.red('Invalid browser tool name: (empty)'));
    console.error('Browser tool names start with "browser_" or "extension_", e.g. browser_execute_script');
    process.exit(1);
  }
  if (!toolName.startsWith('browser_') && !toolName.startsWith('extension_')) {
    toolName = `browser_${toolName}`;
  }

  if (value !== 'enabled' && value !== 'disabled') {
    console.error(pc.red(`Invalid value: ${value}`));
    console.error('Value must be "enabled" or "disabled".');
    process.exit(1);
  }

  const { config, configPath } = await loadConfig();

  if (
    !config.browserToolPolicy ||
    typeof config.browserToolPolicy !== 'object' ||
    Array.isArray(config.browserToolPolicy)
  ) {
    config.browserToolPolicy = {};
  }
  const policy = config.browserToolPolicy as Record<string, boolean>;
  const enabled = value === 'enabled';
  applyPolicyEntry(policy, toolName, enabled);
  if (Object.keys(policy).length === 0) {
    delete config.browserToolPolicy;
  }

  await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');

  const indicator = enabled ? pc.green('enabled') : pc.red('disabled');
  console.log(`${toolName}: ${indicator}`);

  const port = resolvePort(options);
  const registeredBrowserTools = await fetchBrowserToolNames(port);
  if (registeredBrowserTools && !registeredBrowserTools.includes(toolName)) {
    console.log(
      pc.yellow(
        `Warning: "${toolName}" does not match any registered browser tool. Check the name or start the server.`,
      ),
    );
  } else if (!registeredBrowserTools) {
    console.log(
      pc.dim(`Note: Could not validate tool name (server not running). Verify with: opentabs config set browser-tool.`),
    );
  }

  await notifyServer({ port: options.port, warnIfNotRunning: true });
};

const handleSetPort = async (value: string, options: { port?: number }): Promise<void> => {
  const newPort = Number(value);
  if (!Number.isInteger(newPort) || newPort < 1 || newPort > 65535) {
    console.error(pc.red(`Invalid port: ${value}`));
    console.error('Port must be an integer between 1 and 65535.');
    process.exit(1);
  }

  const { config, configPath } = await loadConfig();
  const oldPort = typeof config.port === 'number' ? config.port : DEFAULT_PORT;

  if (newPort === DEFAULT_PORT) {
    delete config.port;
  } else {
    config.port = newPort;
  }

  await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`port: ${pc.cyan(String(newPort))}`);

  if (newPort !== oldPort) {
    // Port is changing: notify the server on the actual running port (old port),
    // unless the user explicitly passed --port to indicate where the server is.
    const runningPort = options.port ?? oldPort;
    await notifyServer({
      port: runningPort,
      warnIfNotRunning: true,
      successMessage: pc.yellow(`Server running on port ${runningPort}. Restart to apply port change.`),
    });
  }
};

/**
 * Resolve a stored plugin path to its absolute form for comparison.
 * Handles both absolute paths and relative paths (resolved against configDir).
 */
const resolveStoredPluginPath = (storedPath: string, configDir: string): string => {
  if (storedPath.startsWith('~/')) return resolve(homedir(), storedPath.slice(2));
  if (isAbsolute(storedPath)) return storedPath;
  return resolve(configDir, storedPath);
};

const handleSetLocalPluginsAdd = async (value: string, options: { port?: number; force?: boolean }): Promise<void> => {
  const expandedValue = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  const pluginPath = resolve(expandedValue);
  const { config, configPath } = await loadConfig();

  if (!Array.isArray(config.localPlugins)) {
    config.localPlugins = [];
  }
  const plugins = config.localPlugins as string[];
  const configDir = dirname(configPath);

  const alreadyRegistered = plugins.some(p => resolveStoredPluginPath(p, configDir) === pluginPath);
  if (alreadyRegistered) {
    console.log(`${pc.dim('Already registered:')} ${pluginPath}`);
    return;
  }

  if (!existsSync(pluginPath)) {
    if (!options.force) {
      console.error(pc.red(`Error: Path does not exist: ${pluginPath}`));
      process.exit(1);
    }
    plugins.push(pluginPath);
    await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`${pc.green('Added:')} ${pluginPath}`);
    console.log(pc.yellow(`Warning: Path does not exist: ${pluginPath}`));
  } else {
    plugins.push(pluginPath);
    await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`${pc.green('Added:')} ${pluginPath}`);
    if (!existsSync(join(pluginPath, 'package.json'))) {
      console.log(pc.yellow(`Warning: No package.json found at ${pluginPath}. Plugin may not load.`));
    }
  }

  await notifyServer({ port: options.port, warnIfNotRunning: true });
};

const handleSetLocalPluginsRemove = async (value: string, options: { port?: number }): Promise<void> => {
  const expandedValue = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  const pluginPath = resolve(expandedValue);
  const { config, configPath } = await loadConfig();

  if (!Array.isArray(config.localPlugins)) {
    console.error(pc.red(`Path not found in localPlugins: ${pluginPath}`));
    process.exit(1);
  }
  const plugins = config.localPlugins as string[];
  const configDir = dirname(configPath);

  // Find by resolved absolute path to handle mixed path formats
  const index = plugins.findIndex(p => resolveStoredPluginPath(p, configDir) === pluginPath);

  if (index === -1) {
    console.error(pc.red(`Path not found in localPlugins: ${pluginPath}`));
    process.exit(1);
  }

  plugins.splice(index, 1);
  await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`${pc.green('Removed:')} ${pluginPath}`);
  await notifyServer({ port: options.port, warnIfNotRunning: true });
};

const levenshtein = (a: string, b: string): number => {
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const curr = [i] as number[];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[n] ?? 0;
};

const KNOWN_KEYS = ['tool.', 'browser-tool.', PORT_KEY, LOCAL_PLUGINS_ADD, LOCAL_PLUGINS_REMOVE];

const suggestKey = (input: string): string | null => {
  let best: string | null = null;
  let bestDistance = Infinity;

  for (const known of KNOWN_KEYS) {
    // For prefix keys (ending with '.'), compare against the prefix portion of the input
    const inputPart = known.endsWith('.') ? input.slice(0, input.indexOf('.') + 1) || input : input;
    const distance = levenshtein(inputPart, known);
    if (distance < bestDistance && distance <= 2) {
      bestDistance = distance;
      best = known;
    }
  }

  if (!best) return null;

  // For prefix keys, append the user's suffix to show a complete suggestion
  if (best.endsWith('.') && input.includes('.')) {
    return best + input.slice(input.indexOf('.') + 1);
  }
  return best;
};

const handleConfigSet = async (
  key: string,
  value: string | undefined,
  options: { port?: number; force?: boolean },
): Promise<void> => {
  if (key === TOOL_PREFIX) {
    return handleListTools(options);
  }
  if (key === BROWSER_TOOL_PREFIX) {
    return handleListBrowserTools(options);
  }

  if (value === undefined || value === '') {
    console.error(pc.red('Missing value.'));
    console.error(SUPPORTED_KEYS);
    process.exit(1);
  }

  if (key.startsWith(TOOL_PREFIX)) {
    return handleSetTool(key, value, options);
  }
  if (key.startsWith(BROWSER_TOOL_PREFIX)) {
    return handleSetBrowserTool(key, value, options);
  }
  if (key === PORT_KEY) {
    return handleSetPort(value, options);
  }
  if (key === LOCAL_PLUGINS_ADD) {
    return handleSetLocalPluginsAdd(value, options);
  }
  if (key === LOCAL_PLUGINS_REMOVE) {
    return handleSetLocalPluginsRemove(value, options);
  }

  console.error(pc.red(`Unknown config key: ${key}`));

  const suggestion = suggestKey(key);
  if (suggestion) {
    console.error(`Did you mean ${pc.bold(suggestion)}?`);
    console.error('');
  }

  console.error(SUPPORTED_KEYS);
  process.exit(1);
};

interface ConfigResetOptions {
  confirm?: boolean;
}

const handleConfigReset = async (options: ConfigResetOptions): Promise<void> => {
  const configPath = getConfigPath();

  if (
    !(await access(configPath).then(
      () => true,
      () => false,
    ))
  ) {
    console.log(`No config file found at ${configPath}`);
    return;
  }

  if (!options.confirm) {
    console.error(pc.yellow(`This will delete your config at ${configPath}.`));
    console.error(pc.yellow('Local plugins and tool overrides will be lost.'));
    console.error('');
    console.error(`Run with ${pc.bold('--confirm')} to proceed:`);
    console.error(`  opentabs config reset --confirm`);
    process.exit(1);
  }

  await unlink(configPath).catch(() => {});
  console.log(`${pc.green('Config file deleted:')} ${configPath}`);
  console.log(pc.dim('Run opentabs start to regenerate.'));
};

/**
 * Write auth.json to the managed extension directory so the Chrome extension
 * can bootstrap the shared secret without an unauthenticated HTTP request.
 */
const writeAuthFile = async (secret: string): Promise<void> => {
  const extensionDir = getExtensionDir();
  await mkdir(extensionDir, { recursive: true, mode: 0o700 });
  const authPath = join(extensionDir, 'auth.json');
  await atomicWrite(authPath, JSON.stringify({ secret }) + '\n', 0o600);
};

interface RotateSecretOptions {
  port?: number;
  confirm?: boolean;
}

const handleRotateSecret = async (options: RotateSecretOptions): Promise<void> => {
  if (!options.confirm) {
    console.error(
      pc.yellow(
        'This will generate a new authentication secret. All MCP client configurations (Claude Code, Cursor, etc.) will need to be updated with the new secret.',
      ),
    );
    console.error('');
    console.error(`Run with ${pc.bold('--confirm')} to proceed:`);
    console.error('  opentabs config rotate-secret --confirm');
    process.exit(1);
  }

  const oldSecret = await readAuthSecret();
  const newSecret = generateSecret();
  const port = resolvePort(options);

  // Write new secret to auth.json (the single source of truth)
  try {
    await writeAuthFile(newSecret);
  } catch (err) {
    console.error(pc.red(`Failed to write auth.json: ${toErrorMessage(err)}`));
    console.error('Secret was NOT rotated.');
    process.exit(1);
  }

  // Notify the running server using the OLD secret so it reloads with the new one
  if (oldSecret) {
    try {
      const res = await fetch(`http://${DEFAULT_HOST}:${port}/reload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${oldSecret}` },
        signal: AbortSignal.timeout(3_000),
      });
      if (res.ok) {
        console.log(pc.green('Secret rotated successfully.'));
        console.log('The server has picked up the new secret and the extension will reload automatically.');
        console.log(pc.dim('Update MCP client configs (Claude Code, OpenCode, etc.) with the new secret.'));
        console.log(
          pc.dim('Run `opentabs config show --show-secret` to see MCP client configuration with the new secret.'),
        );
        return;
      }
      console.log(pc.green('Secret rotated in auth.json.'));
      console.log(pc.yellow(`Could not notify running server (HTTP ${res.status}).`));
      console.log('Restart the MCP server for changes to take effect.');
      console.log(
        pc.dim('Run `opentabs config show --show-secret` to see MCP client configuration with the new secret.'),
      );
    } catch (err: unknown) {
      console.log(pc.green('Secret rotated in auth.json.'));
      if (isConnectionRefused(err)) {
        console.log(pc.dim('MCP server is not running. Changes will take effect on next start.'));
      } else {
        console.log(pc.yellow('Could not reach MCP server. Restart it for changes to take effect.'));
      }
      console.log(
        pc.dim('Run `opentabs config show --show-secret` to see MCP client configuration with the new secret.'),
      );
    }
  } else {
    console.log(pc.green('Secret rotated in auth.json.'));
    console.log('Restart the MCP server for changes to take effect.');
    console.log(
      pc.dim('Run `opentabs config show --show-secret` to see MCP client configuration with the new secret.'),
    );
  }
};

const registerConfigCommand = (program: Command): void => {
  const configCmd = program
    .command('config')
    .description('View and manage configuration')
    .action(() => {
      configCmd.help();
    });

  configCmd
    .command('set <key> [value]')
    .description('Set a config value')
    .option('-f, --force', 'Force localPlugins.add even if the path does not exist yet')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs config set tool.                              List available tools
  $ opentabs config set tool.slack_send_message disabled
  $ opentabs config set tool.slack_send_message enabled
  $ opentabs config set browser-tool.                      List available browser tools
  $ opentabs config set browser-tool.browser_execute_script disabled
  $ opentabs config set browser-tool.browser_execute_script enabled
  $ opentabs config set port 9515
  $ opentabs config set localPlugins.add /path/to/plugin
  $ opentabs config set localPlugins.add /future/path --force
  $ opentabs config set localPlugins.remove /path/to/plugin`,
    )
    .action((key: string, value: string | undefined, _options: unknown, command: Command) =>
      handleConfigSet(key, value, command.optsWithGlobals()),
    );

  configCmd
    .command('path')
    .description('Print the config file path')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs config path`,
    )
    .action(() => handleConfigPath());

  configCmd
    .command('show')
    .alias('get')
    .description('Show config contents')
    .option('--json', 'Output config as JSON')
    .option('--show-secret', 'Display the full authentication secret and MCP client configurations')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs config show
  $ opentabs config show --json
  $ opentabs config show --show-secret`,
    )
    .action((_options: ConfigShowOptions, command: Command) => handleConfigShow(command.optsWithGlobals()));

  configCmd
    .command('reset')
    .description('Delete config file (server will regenerate on next start)')
    .option('--confirm', 'Skip confirmation and delete immediately')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs config reset --confirm`,
    )
    .action((options: ConfigResetOptions) => handleConfigReset(options));

  configCmd
    .command('rotate-secret')
    .description('Rotate the shared authentication secret')
    .option('--confirm', 'Skip confirmation and rotate immediately')
    .addHelpText(
      'after',
      `
Generates a new 256-bit random secret and writes it to auth.json.
If the MCP server is running, notifies it to reload.

Examples:
  $ opentabs config rotate-secret --confirm`,
    )
    .action((options: { confirm?: boolean }, command: Command) =>
      handleRotateSecret({ ...options, ...command.optsWithGlobals() }),
    );
};

export {
  registerConfigCommand,
  maskSecret,
  resolveStoredPluginPath,
  levenshtein,
  suggestKey,
  KNOWN_KEYS,
  applyPolicyEntry,
  handleSetLocalPluginsAdd,
  normalizeConfigForDisplay,
};
