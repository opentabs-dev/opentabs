/**
 * `opentabs config` command — view and manage configuration.
 */

import { existsSync } from 'node:fs';
import { access, mkdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  atomicWrite,
  DEFAULT_HOST,
  DEFAULT_PORT,
  generateSecret,
  type PluginPermissionConfig,
  type ToolPermission,
  toErrorMessage,
} from '@opentabs-dev/shared';
import type { Command } from 'commander';
import pc from 'picocolors';
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
import { getMcpClientConfigs, printMcpClientConfigs } from './start.js';

const handleConfigPath = (): void => {
  console.log(getConfigPath());
};

interface ConfigShowOptions {
  json?: boolean;
  showSecret?: boolean;
}

const maskSecret = (secret: string): string => {
  if (secret.length > 8) return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
  return '****';
};

const VALID_PERMISSIONS: ReadonlySet<string> = new Set(['off', 'ask', 'auto']);

const colorPermission = (perm: string): string => {
  if (perm === 'auto') return pc.green('auto');
  if (perm === 'ask') return pc.yellow('ask');
  return pc.red('off');
};

const CANONICAL_CONFIG_SECTIONS = ['localPlugins', 'permissions', 'settings'] as const;

/**
 * Normalize a raw config object for display: ensures expected sections always appear
 * in canonical order (localPlugins, permissions) regardless of whether they were written
 * to the config file. Does not modify the file.
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
  normalized.localPlugins = config.localPlugins ?? [];
  normalized.permissions = config.permissions ?? {};
  normalized.settings = config.settings ?? {};
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
      } else if (key === 'permissions' && typeof value === 'object' && value !== null) {
        const entries = Object.entries(value as Record<string, unknown>);
        console.log(`  ${pc.cyan('permissions')}`);
        if (entries.length === 0) {
          console.log(`    ${pc.dim('(none)')}`);
        } else {
          for (const [pluginName, pluginConfig] of entries) {
            if (typeof pluginConfig !== 'object' || pluginConfig === null) continue;
            const cfg = pluginConfig as Record<string, unknown>;
            const perm = typeof cfg.permission === 'string' ? cfg.permission : 'off';
            console.log(`    ${pluginName}: ${colorPermission(perm)}`);
            const tools = typeof cfg.tools === 'object' && cfg.tools !== null ? cfg.tools : {};
            for (const [toolName, toolPerm] of Object.entries(tools as Record<string, unknown>)) {
              console.log(`      ${toolName}: ${colorPermission(String(toolPerm))}`);
            }
          }
        }
      } else if (key === 'settings' && typeof value === 'object' && value !== null) {
        const entries = Object.entries(value as Record<string, unknown>);
        console.log(`  ${pc.cyan('settings')}`);
        if (entries.length === 0) {
          console.log(`    ${pc.dim('(none)')}`);
        } else {
          for (const [pluginName, pluginSettings] of entries) {
            if (typeof pluginSettings !== 'object' || pluginSettings === null) continue;
            console.log(`    ${pluginName}`);
            for (const [k, v] of Object.entries(pluginSettings as Record<string, unknown>)) {
              console.log(`      ${k}: ${String(v)}`);
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
      console.log(pc.dim('  Connection modes:'));
      console.log('');
      printMcpClientConfigs(mcpUrl, secret, false, false);
    }
  }
};

const TOOL_PERMISSION_PREFIX = 'tool-permission.';
const PLUGIN_PERMISSION_PREFIX = 'plugin-permission.';
const SETTING_PREFIX = 'setting.';
const LOCAL_PLUGINS_ADD = 'localPlugins.add';
const LOCAL_PLUGINS_REMOVE = 'localPlugins.remove';
const ALLOWED_DIRS_ADD = 'allowedDirectories.add';
const ALLOWED_DIRS_REMOVE = 'allowedDirectories.remove';
const PORT_KEY = 'port';

const SUPPORTED_KEYS = `Supported keys:
  tool-permission.<plugin>.<tool>   Set a per-tool permission (value: off | ask | auto)
  plugin-permission.<plugin>        Set a plugin-level default permission (value: off | ask | auto)
  setting.<plugin>.<key>            Set a plugin setting (e.g., setting.sqlpad.instanceUrl)
  port                              Set the server port (value: 1-65535)
  localPlugins.add                  Add a local plugin path (value: absolute or relative path)
  localPlugins.remove               Remove a local plugin path (value: path to remove)
  allowedDirectories.add            Add an allowed directory for local plugins (value: absolute path)
  allowedDirectories.remove         Remove an allowed directory (value: path to remove)`;

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

/**
 * Ensure config.permissions[pluginName] exists and return it.
 * Mutates config in place.
 */
const ensurePluginEntry = (config: Record<string, unknown>, pluginName: string): PluginPermissionConfig => {
  if (!config.permissions || typeof config.permissions !== 'object' || Array.isArray(config.permissions)) {
    config.permissions = {};
  }
  const permissions = config.permissions as Record<string, PluginPermissionConfig>;
  if (!permissions[pluginName]) {
    permissions[pluginName] = {};
  }
  return permissions[pluginName];
};

/**
 * Remove empty entries from config.permissions to keep the config file clean.
 * An entry is empty if it has no permission and no tools overrides.
 */
const pruneEmptyPluginEntries = (config: Record<string, unknown>): void => {
  if (!config.permissions || typeof config.permissions !== 'object' || Array.isArray(config.permissions)) return;
  const permissions = config.permissions as Record<string, PluginPermissionConfig>;
  for (const [name, entry] of Object.entries(permissions)) {
    const hasPermission = entry.permission !== undefined;
    const hasTools = entry.tools !== undefined && Object.keys(entry.tools).length > 0;
    if (!hasPermission && !hasTools) {
      delete permissions[name];
    }
  }
  if (Object.keys(permissions).length === 0) {
    delete config.permissions;
  }
};

const handleSetToolPermission = async (key: string, value: string, options: { port?: number }): Promise<void> => {
  const rest = key.slice(TOOL_PERMISSION_PREFIX.length);
  const dotIdx = rest.indexOf('.');
  if (dotIdx === -1 || dotIdx === 0 || dotIdx === rest.length - 1) {
    console.error(pc.red(`Invalid key format: ${key}`));
    console.error('Expected: tool-permission.<plugin>.<tool>');
    console.error('Example: tool-permission.slack.send_message');
    console.error('For browser tools: tool-permission.browser.browser_screenshot');
    process.exit(1);
  }
  const pluginName = rest.slice(0, dotIdx);
  const toolName = rest.slice(dotIdx + 1);

  if (!VALID_PERMISSIONS.has(value)) {
    console.error(pc.red(`Invalid permission: ${value}`));
    console.error('Value must be "off", "ask", or "auto".');
    process.exit(1);
  }
  const permission = value as ToolPermission;

  const { config, configPath } = await loadConfig();
  const entry = ensurePluginEntry(config, pluginName);

  if (permission === 'off') {
    if (entry.tools) {
      delete entry.tools[toolName];
      if (Object.keys(entry.tools).length === 0) {
        delete entry.tools;
      }
    }
  } else {
    if (!entry.tools) entry.tools = {};
    entry.tools[toolName] = permission;
  }

  pruneEmptyPluginEntries(config);
  await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);

  console.log(`${pluginName}.${toolName}: ${colorPermission(permission)}`);
  await notifyServer({ port: options.port, warnIfNotRunning: true });
};

const handleSetPluginPermission = async (key: string, value: string, options: { port?: number }): Promise<void> => {
  const pluginName = key.slice(PLUGIN_PERMISSION_PREFIX.length);
  if (!pluginName) {
    console.error(pc.red('Missing plugin name.'));
    console.error('Expected: plugin-permission.<plugin>');
    console.error('Example: plugin-permission.slack');
    console.error('For browser tools: plugin-permission.browser');
    process.exit(1);
  }

  if (!VALID_PERMISSIONS.has(value)) {
    console.error(pc.red(`Invalid permission: ${value}`));
    console.error('Value must be "off", "ask", or "auto".');
    process.exit(1);
  }
  const permission = value as ToolPermission;

  const { config, configPath } = await loadConfig();
  const entry = ensurePluginEntry(config, pluginName);

  if (permission === 'off') {
    delete entry.permission;
  } else {
    entry.permission = permission;
  }

  pruneEmptyPluginEntries(config);
  await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);

  console.log(`${pluginName}: ${colorPermission(permission)}`);
  await notifyServer({ port: options.port, warnIfNotRunning: true });
};

const handleSetSetting = async (key: string, value: string, options: { port?: number }): Promise<void> => {
  const rest = key.slice(SETTING_PREFIX.length);
  const dotIdx = rest.indexOf('.');
  if (dotIdx === -1 || dotIdx === 0 || dotIdx === rest.length - 1) {
    console.error(pc.red(`Invalid key format: ${key}`));
    console.error('Expected: setting.<plugin>.<key>');
    console.error('Example: setting.sqlpad.instanceUrl');
    process.exit(1);
  }
  const pluginName = rest.slice(0, dotIdx);
  const settingKey = rest.slice(dotIdx + 1);

  const { config, configPath } = await loadConfig();

  if (!config.settings || typeof config.settings !== 'object' || Array.isArray(config.settings)) {
    config.settings = {};
  }
  const settingsMap = config.settings as Record<string, Record<string, unknown>>;

  if (value === '') {
    // Empty string removes the key
    if (settingsMap[pluginName]) {
      delete settingsMap[pluginName][settingKey];
      if (Object.keys(settingsMap[pluginName]).length === 0) {
        delete settingsMap[pluginName];
      }
    }
    if (Object.keys(settingsMap).length === 0) {
      delete config.settings;
    }
  } else {
    if (!settingsMap[pluginName]) {
      settingsMap[pluginName] = {};
    }
    settingsMap[pluginName][settingKey] = value;
  }

  await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);

  if (value === '') {
    console.log(`${pluginName}.${settingKey}: ${pc.dim('(removed)')}`);
  } else {
    console.log(`${pluginName}.${settingKey}: ${pc.cyan(value)}`);
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

  await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
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
    await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`${pc.green('Added:')} ${pluginPath}`);
    console.log(pc.yellow(`Warning: Path does not exist: ${pluginPath}`));
  } else {
    plugins.push(pluginPath);
    await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
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
  await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`${pc.green('Removed:')} ${pluginPath}`);
  await notifyServer({ port: options.port, warnIfNotRunning: true });
};

const handleSetAllowedDirsAdd = async (value: string, options: { port?: number }): Promise<void> => {
  const expandedValue = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  const dirPath = resolve(expandedValue);
  const { config, configPath } = await loadConfig();

  if (!Array.isArray(config.additionalAllowedDirectories)) {
    config.additionalAllowedDirectories = [];
  }
  const dirs = config.additionalAllowedDirectories as string[];

  if (dirs.includes(dirPath)) {
    console.log(`${pc.dim('Already registered:')} ${dirPath}`);
    return;
  }

  if (!existsSync(dirPath)) {
    console.error(pc.red(`Error: Directory does not exist: ${dirPath}`));
    process.exit(1);
  }

  dirs.push(dirPath);
  await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`${pc.green('Added allowed directory:')} ${dirPath}`);
  await notifyServer({ port: options.port, warnIfNotRunning: true });
};

const handleSetAllowedDirsRemove = async (value: string, options: { port?: number }): Promise<void> => {
  const expandedValue = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  const dirPath = resolve(expandedValue);
  const { config, configPath } = await loadConfig();

  if (!Array.isArray(config.additionalAllowedDirectories)) {
    console.error(pc.red(`Directory not found in allowedDirectories: ${dirPath}`));
    process.exit(1);
  }
  const dirs = config.additionalAllowedDirectories as string[];
  const index = dirs.findIndex(d => resolve(d) === dirPath);

  if (index === -1) {
    console.error(pc.red(`Directory not found in allowedDirectories: ${dirPath}`));
    process.exit(1);
  }

  dirs.splice(index, 1);
  await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`${pc.green('Removed allowed directory:')} ${dirPath}`);
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

const KNOWN_KEYS = [
  'tool-permission.',
  'plugin-permission.',
  'setting.',
  PORT_KEY,
  LOCAL_PLUGINS_ADD,
  LOCAL_PLUGINS_REMOVE,
  ALLOWED_DIRS_ADD,
  ALLOWED_DIRS_REMOVE,
];

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
  // Allow empty string for setting.* keys (means "remove the key")
  if (value === undefined || (value === '' && !key.startsWith(SETTING_PREFIX))) {
    console.error(pc.red('Missing value.'));
    console.error(SUPPORTED_KEYS);
    process.exit(1);
  }

  if (key.startsWith(TOOL_PERMISSION_PREFIX)) {
    return handleSetToolPermission(key, value, options);
  }
  if (key.startsWith(PLUGIN_PERMISSION_PREFIX)) {
    return handleSetPluginPermission(key, value, options);
  }
  if (key.startsWith(SETTING_PREFIX)) {
    return handleSetSetting(key, value ?? '', options);
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
  if (key === ALLOWED_DIRS_ADD) {
    return handleSetAllowedDirsAdd(value, options);
  }
  if (key === ALLOWED_DIRS_REMOVE) {
    return handleSetAllowedDirsRemove(value, options);
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
  await atomicWrite(authPath, `${JSON.stringify({ secret })}\n`, 0o600);
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
  $ opentabs config set tool-permission.slack.send_message auto
  $ opentabs config set tool-permission.browser.browser_screenshot ask
  $ opentabs config set plugin-permission.slack auto
  $ opentabs config set plugin-permission.browser ask
  $ opentabs config set setting.sqlpad.instanceUrl https://sqlpad.example.com
  $ opentabs config set setting.sqlpad.instanceUrl ''   # remove a setting
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
  handleSetLocalPluginsAdd,
  handleSetSetting,
  KNOWN_KEYS,
  levenshtein,
  maskSecret,
  normalizeConfigForDisplay,
  registerConfigCommand,
  resolveStoredPluginPath,
  suggestKey,
};
