/**
 * `opentabs config` command — view and manage configuration.
 */

import {
  atomicWriteConfig,
  getConfigPath,
  getExtensionDir,
  isConnectionRefused,
  readAuthSecret,
  readConfig,
} from '../config.js';
import { resolvePort } from '../parse-port.js';
import {
  atomicWrite,
  deleteFile as runtimeDeleteFile,
  fileExists as runtimeFileExists,
  generateSecret,
  toErrorMessage,
} from '@opentabs-dev/shared';
import pc from 'picocolors';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';

const handleConfigPath = (): void => {
  console.log(getConfigPath());
};

interface ConfigShowOptions {
  json?: boolean;
}

const handleConfigShow = async (options: ConfigShowOptions): Promise<void> => {
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
  const secret = await readAuthSecret();

  if (options.json) {
    const output = { ...config, ...(secret ? { secret } : {}) };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(pc.bold('OpenTabs Config'));
    console.log(pc.dim(configPath));
    console.log('');

    for (const [key, value] of Object.entries(config)) {
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
      } else {
        const display =
          typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : JSON.stringify(value);
        console.log(`  ${pc.cyan(key)}  ${display}`);
      }
    }

    if (secret) {
      console.log('');
      console.log(`  ${pc.cyan('secret')}  ${pc.dim(secret)}`);
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
  disabledBrowserTools?: string[];
}

const fetchToolNames = async (port: number): Promise<string[] | null> => {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
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

const handleListTools = async (): Promise<void> => {
  const port = resolvePort({});
  const tools = await fetchToolNames(port);

  if (!tools) {
    console.error(pc.yellow('Cannot reach the MCP server to list available tools.'));
    console.error(`Start it with: ${pc.bold('opentabs start')}`);
    console.error('');
    console.error('Tool names use the format <plugin>_<tool>, e.g. slack_send_message');
    process.exit(1);
  }

  if (tools.length === 0) {
    console.log(pc.dim('No tools available (no plugins installed).'));
    return;
  }

  console.log(pc.bold('Available tools:'));
  for (const name of tools) {
    console.log(`  ${name}`);
  }
  console.log('');
  console.log(pc.dim('Usage: opentabs config set tool.<name> enabled|disabled'));
};

const handleSetTool = async (key: string, value: string): Promise<void> => {
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
  tools[toolName] = enabled;

  await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');

  const indicator = enabled ? pc.green('enabled') : pc.red('disabled');
  console.log(`${toolName}: ${indicator}`);
};

const handleSetBrowserTool = async (key: string, value: string): Promise<void> => {
  const toolName = key.slice(BROWSER_TOOL_PREFIX.length);
  if (!toolName || (!toolName.startsWith('browser_') && !toolName.startsWith('extension_'))) {
    console.error(pc.red(`Invalid browser tool name: ${toolName || '(empty)'}`));
    console.error('Browser tool names start with "browser_" or "extension_", e.g. browser_execute_script');
    process.exit(1);
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
  policy[toolName] = enabled;

  await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');

  const indicator = enabled ? pc.green('enabled') : pc.red('disabled');
  console.log(`${toolName}: ${indicator}`);
};

const handleSetPort = async (value: string): Promise<void> => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(pc.red(`Invalid port: ${value}`));
    console.error('Port must be an integer between 1 and 65535.');
    process.exit(1);
  }

  const { config, configPath } = await loadConfig();
  config.port = port;

  await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`port: ${pc.cyan(String(port))}`);
};

/**
 * Resolve a stored plugin path to its absolute form for comparison.
 * Handles both absolute paths and relative paths (resolved against configDir).
 */
const resolveStoredPluginPath = (storedPath: string, configDir: string): string => {
  if (storedPath.startsWith('/')) return storedPath;
  if (storedPath.startsWith('~/')) return resolve(homedir(), storedPath.slice(2));
  return resolve(configDir, storedPath);
};

const handleSetLocalPluginsAdd = async (value: string): Promise<void> => {
  const pluginPath = resolve(value);
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

  plugins.push(pluginPath);
  await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`${pc.green('Added:')} ${pluginPath}`);
};

const handleSetLocalPluginsRemove = async (value: string): Promise<void> => {
  const pluginPath = resolve(value);
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
};

const handleConfigSet = async (key: string, value?: string): Promise<void> => {
  if (key === TOOL_PREFIX) {
    return handleListTools();
  }

  if (!value) {
    console.error(pc.red('Missing value.'));
    console.error(SUPPORTED_KEYS);
    process.exit(1);
  }

  if (key.startsWith(TOOL_PREFIX)) {
    return handleSetTool(key, value);
  }
  if (key.startsWith(BROWSER_TOOL_PREFIX)) {
    return handleSetBrowserTool(key, value);
  }
  if (key === PORT_KEY) {
    return handleSetPort(value);
  }
  if (key === LOCAL_PLUGINS_ADD) {
    return handleSetLocalPluginsAdd(value);
  }
  if (key === LOCAL_PLUGINS_REMOVE) {
    return handleSetLocalPluginsRemove(value);
  }

  console.error(pc.red(`Unknown config key: ${key}`));
  console.error(SUPPORTED_KEYS);
  process.exit(1);
};

interface ConfigResetOptions {
  confirm?: boolean;
}

const handleConfigReset = async (options: ConfigResetOptions): Promise<void> => {
  const configPath = getConfigPath();

  if (!(await runtimeFileExists(configPath))) {
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

  await runtimeDeleteFile(configPath);
  console.log('Config reset. Run opentabs start to regenerate.');
};

/**
 * Write auth.json to the managed extension directory so the Chrome extension
 * can bootstrap the shared secret without an unauthenticated HTTP request.
 */
const writeAuthFile = async (secret: string): Promise<void> => {
  const extensionDir = getExtensionDir();
  await mkdir(extensionDir, { recursive: true });
  const authPath = join(extensionDir, 'auth.json');
  await atomicWrite(authPath, JSON.stringify({ secret }) + '\n', 0o600);
};

const handleRotateSecret = async (options: { port?: number }): Promise<void> => {
  const oldSecret = await readAuthSecret();
  const newSecret = generateSecret();
  const port = resolvePort(options);

  // Write new secret to auth.json (the single source of truth)
  try {
    await writeAuthFile(newSecret);
  } catch (err) {
    console.warn(pc.yellow(`Warning: Could not write auth.json: ${toErrorMessage(err)}`));
  }

  // Notify the running server using the OLD secret so it reloads with the new one
  if (oldSecret) {
    try {
      const res = await fetch(`http://localhost:${port}/reload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${oldSecret}` },
        signal: AbortSignal.timeout(3_000),
      });
      if (res.ok) {
        console.log(pc.green('Secret rotated successfully.'));
        console.log('The server has picked up the new secret and the extension will reload automatically.');
        console.log(pc.dim('Update MCP client configs (Claude Code, OpenCode, etc.) with the new secret.'));
        return;
      }
      console.log(pc.green('Secret rotated in auth.json.'));
      console.log(pc.yellow(`Could not notify running server (HTTP ${res.status}).`));
      console.log('Restart the MCP server for changes to take effect.');
    } catch (err: unknown) {
      console.log(pc.green('Secret rotated in auth.json.'));
      if (isConnectionRefused(err)) {
        console.log(pc.dim('MCP server is not running. Changes will take effect on next start.'));
      } else {
        console.log(pc.yellow('Could not reach MCP server. Restart it for changes to take effect.'));
      }
    }
  } else {
    console.log(pc.green('Secret rotated in auth.json.'));
    console.log('Restart the MCP server for changes to take effect.');
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
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs config set tool.                              List available tools
  $ opentabs config set tool.slack_send_message disabled
  $ opentabs config set tool.slack_send_message enabled
  $ opentabs config set browser-tool.browser_execute_script disabled
  $ opentabs config set browser-tool.browser_execute_script enabled
  $ opentabs config set port 9515
  $ opentabs config set localPlugins.add /path/to/plugin
  $ opentabs config set localPlugins.remove /path/to/plugin`,
    )
    .action((key: string, value?: string) => handleConfigSet(key, value));

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
    .description('Show config contents')
    .option('--json', 'Output config as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs config show
  $ opentabs config show --json`,
    )
    .action((options: ConfigShowOptions) => handleConfigShow(options));

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
    .addHelpText(
      'after',
      `
Generates a new 256-bit random secret and writes it to auth.json.
If the MCP server is running, notifies it to reload.

Examples:
  $ opentabs config rotate-secret`,
    )
    .action((_options: Record<string, unknown>, command: Command) => handleRotateSecret(command.optsWithGlobals()));
};

export { registerConfigCommand };
