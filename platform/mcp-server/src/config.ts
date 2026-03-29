/**
 * Config system — ~/.opentabs/config.json
 *
 * Single source of truth for local plugin paths and per-plugin permission state.
 * Created automatically on first MCP server run with sensible defaults.
 *
 * The config directory defaults to ~/.opentabs but can be overridden via the
 * OPENTABS_CONFIG_DIR environment variable. This is essential for parallel
 * E2E test execution where each test worker needs its own isolated config
 * to avoid clobbering shared state.
 */

import { access, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  atomicWrite,
  generateSecret,
  getConfigDir,
  getConfigPath,
  getExtensionDir,
  type PluginPermissionConfig,
  type ToolPermission,
} from '@opentabs-dev/shared';
import { CURRENT_CONFIG_VERSION } from './config-migrations.js';
import { log } from './logger.js';

const VALID_TOOL_PERMISSIONS = new Set<string>(['off', 'ask', 'auto']);

const isToolPermission = (v: unknown): v is ToolPermission => typeof v === 'string' && VALID_TOOL_PERMISSIONS.has(v);

/**
 * Shape of ~/.opentabs/config.json
 *
 * `localPlugins` holds local filesystem paths to plugin directories. These paths
 * start with `./`, `../`, `/`, or `~/` and are resolved relative to the config
 * directory. npm plugins are auto-discovered from global node_modules.
 *
 * `permissions` is a map of plugin name → permission config. Each entry may have
 * a top-level `permission` (default for all tools in that plugin) and a `tools`
 * map of tool base name → per-tool override. Browser tools use the special key
 * `__browser__`.
 */
interface OpentabsConfig {
  /** Local plugin directory paths (resolved relative to the config directory) */
  localPlugins: string[];
  /** Per-plugin permission configuration: plugin name → { permission?, tools? } */
  permissions: Record<string, PluginPermissionConfig>;
  /** Per-plugin settings: plugin name → { settingKey: value } */
  settings: Record<string, Record<string, unknown>>;
  /** Extra directories where local plugins may reside (extends the default homedir/tmpdir/cwd roots) */
  additionalAllowedDirectories?: string[];
  /** Config schema version for migration tracking */
  version: number;
}

/** Version marker file for the managed extension install */
const getExtensionVersionFile = (): string => join(getExtensionDir(), '.opentabs-version');

/** Directory for plugin adapter IIFEs inside the managed extension */
const getAdaptersDir = (): string => join(getExtensionDir(), 'adapters');

/** Write config atomically with restrictive permissions via the shared helper. */
const atomicWriteConfig = (configPath: string, content: string): Promise<void> =>
  atomicWrite(configPath, content, 0o600);

/**
 * Read and parse config.json with retry and exponential backoff.
 *
 * Handles transient file unavailability during non-atomic writes from
 * external processes (CLI commands, manual edits). Retries up to 3 times
 * with 100ms / 200ms / 400ms delays before giving up.
 *
 * Returns the raw parsed JSON or null if the file cannot be read after
 * all retries. Callers decide how to handle the failure.
 */
const readConfigWithRetry = async (
  configPath: string,
  maxRetries = 3,
  initialDelayMs = 100,
): Promise<Record<string, unknown> | null> => {
  let delay = initialDelayMs;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const raw = await readFile(configPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        if (attempt === maxRetries) {
          log.warn(`Config at ${configPath} is not a JSON object after ${maxRetries + 1} attempt(s)`);
          return null;
        }
        log.debug(`Config at ${configPath} is not a JSON object — retrying (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }

      return parsed as Record<string, unknown>;
    } catch (err) {
      if (attempt === maxRetries) {
        log.warn(`Failed to read config from ${configPath} after ${maxRetries + 1} attempt(s):`, err);
        return null;
      }
      log.debug(`Config read attempt ${attempt + 1} failed, retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
  return null;
};

/** Parse and validate a single PluginPermissionConfig entry from raw JSON */
const parsePluginPermissionEntry = (raw: unknown): PluginPermissionConfig | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const result: PluginPermissionConfig = {};

  if (isToolPermission(obj.permission)) {
    result.permission = obj.permission;
  }

  if (obj.tools && typeof obj.tools === 'object' && !Array.isArray(obj.tools)) {
    const tools: Record<string, ToolPermission> = {};
    for (const [key, value] of Object.entries(obj.tools as Record<string, unknown>)) {
      if (isToolPermission(value)) {
        tools[key] = value;
      }
    }
    if (Object.keys(tools).length > 0) {
      result.tools = tools;
    }
  }

  if (typeof obj.reviewedVersion === 'string' && obj.reviewedVersion.length > 0) {
    result.reviewedVersion = obj.reviewedVersion;
  }

  // Only return if at least one field was set
  if (result.permission !== undefined || result.tools !== undefined || result.reviewedVersion !== undefined) {
    return result;
  }
  return null;
};

/** Parse the plugins map from a raw config record */
const parsePluginsConfig = (raw: unknown): Record<string, PluginPermissionConfig> => {
  const result: Record<string, PluginPermissionConfig> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;

  for (const [pluginName, entry] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = parsePluginPermissionEntry(entry);
    if (parsed) {
      result[pluginName] = parsed;
    }
  }
  return result;
};

/** Parse the settings map from a raw config record: { pluginName: { key: value } } */
const parseSettingsConfig = (raw: unknown): Record<string, Record<string, unknown>> => {
  const result: Record<string, Record<string, unknown>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;

  for (const [pluginName, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      result[pluginName] = entry as Record<string, unknown>;
    }
  }
  return result;
};

/**
 * Parse a raw config record into an OpentabsConfig.
 * Validates and normalizes field types to prevent downstream errors.
 */
const parseConfigRecord = (record: Record<string, unknown>): OpentabsConfig => {
  const localPlugins = Array.isArray(record.localPlugins)
    ? (record.localPlugins as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  const permissions = parsePluginsConfig(record.permissions);
  const settings = parseSettingsConfig(record.settings);

  const additionalAllowedDirectories = Array.isArray(record.additionalAllowedDirectories)
    ? (record.additionalAllowedDirectories as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  const version =
    typeof record.version === 'number' && Number.isInteger(record.version) && record.version >= 1 ? record.version : 1;

  return { localPlugins, permissions, settings, additionalAllowedDirectories, version };
};

/**
 * Load config from ~/.opentabs/config.json.
 * Creates the directory and file with defaults if they don't exist.
 *
 * On transient read/parse errors (corrupted file, mid-write from another
 * process), retries with exponential backoff. If all retries fail, throws
 * an error so the caller (reloadCore) can preserve previous state instead
 * of replacing it with an empty config.
 */
const loadConfig = async (): Promise<OpentabsConfig> => {
  const configDir = getConfigDir();
  const configPath = getConfigPath();

  await mkdir(configDir, { recursive: true, mode: 0o700 });

  if (
    !(await access(configPath).then(
      () => true,
      () => false,
    ))
  ) {
    const config: OpentabsConfig = {
      localPlugins: [],
      permissions: {},
      settings: {},
      additionalAllowedDirectories: [],
      version: CURRENT_CONFIG_VERSION,
    };
    await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
    log.info(`Created default config at ${configPath}`);
    return config;
  }

  const record = await readConfigWithRetry(configPath);
  if (!record) {
    // All retries exhausted — throw so the caller can preserve previous state.
    // This prevents the old behavior of returning an empty fallback config
    // which would wipe all plugins from state on any transient read error.
    throw new Error(`Config at ${configPath} is unreadable after retries`);
  }

  return parseConfigRecord(record);
};

/**
 * Save config to ~/.opentabs/config.json.
 * Serialized via state.configWriteMutex to prevent concurrent read-modify-write
 * races. The mutex lives on ServerState so it survives hot reload re-evaluations
 * (module-level variables reset on hot reload, but state persists on globalThis).
 */
const saveConfig = async (state: { configWriteMutex: Promise<void> }, config: OpentabsConfig): Promise<void> => {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  const prev = state.configWriteMutex;
  const writePromise = (async () => {
    await prev;
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
  })();
  // The mutex chain always fulfills so subsequent writes proceed even after a failure.
  state.configWriteMutex = writePromise.catch(() => {});
  await writePromise;
};

/**
 * Persist plugin permissions to config.json.
 *
 * Reads the current config from disk, updates only the `permissions` field,
 * and writes it back atomically. This prevents stale in-memory plugin
 * paths from overwriting externally-added plugins.
 *
 * The read-modify-write is serialized via state.configWriteMutex.
 */
const savePluginPermissions = async (
  state: { configWriteMutex: Promise<void> },
  plugins: Record<string, PluginPermissionConfig>,
): Promise<void> => {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  const prev = state.configWriteMutex;
  const writePromise = (async () => {
    await prev;
    await mkdir(configDir, { recursive: true, mode: 0o700 });

    const record = await readConfigWithRetry(configPath, 2, 50);
    if (!record) {
      log.warn('Cannot persist plugin permissions — config file unreadable');
      return;
    }

    const current = parseConfigRecord(record);
    const updated: OpentabsConfig = {
      localPlugins: current.localPlugins,
      permissions: plugins,
      settings: current.settings,
      additionalAllowedDirectories: current.additionalAllowedDirectories,
      version: current.version,
    };
    await atomicWriteConfig(configPath, `${JSON.stringify(updated, null, 2)}\n`);
  })();
  // The mutex chain always fulfills so subsequent writes proceed even after a failure.
  state.configWriteMutex = writePromise.catch(() => {});
  await writePromise;
};

/**
 * Persist plugin settings to config.json.
 *
 * Reads the current config from disk, updates only the `settings` field,
 * and writes it back atomically. This prevents stale in-memory plugin
 * paths or permissions from overwriting externally-added values.
 *
 * The read-modify-write is serialized via state.configWriteMutex.
 */
const savePluginSettings = async (
  state: { configWriteMutex: Promise<void> },
  settings: Record<string, Record<string, unknown>>,
): Promise<void> => {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  const prev = state.configWriteMutex;
  const writePromise = (async () => {
    await prev;
    await mkdir(configDir, { recursive: true, mode: 0o700 });

    const record = await readConfigWithRetry(configPath, 2, 50);
    if (!record) {
      log.warn('Cannot persist plugin settings — config file unreadable');
      return;
    }

    const current = parseConfigRecord(record);
    const updated: OpentabsConfig = {
      localPlugins: current.localPlugins,
      permissions: current.permissions,
      settings,
      additionalAllowedDirectories: current.additionalAllowedDirectories,
      version: current.version,
    };
    await atomicWriteConfig(configPath, `${JSON.stringify(updated, null, 2)}\n`);
  })();
  state.configWriteMutex = writePromise.catch(() => {});
  await writePromise;
};

/**
 * Write auth.json to the managed extension directory so the Chrome extension
 * can bootstrap the shared secret without an unauthenticated HTTP request.
 * auth.json contains only the secret — port configuration lives in chrome.storage.local.
 */
const writeAuthFile = async (secret: string): Promise<void> => {
  const extensionDir = getExtensionDir();
  await mkdir(extensionDir, { recursive: true, mode: 0o700 });
  const authPath = join(extensionDir, 'auth.json');
  await atomicWrite(authPath, `${JSON.stringify({ secret })}\n`, 0o600);
};

/**
 * Load the WebSocket authentication secret from auth.json.
 * auth.json is the single source of truth for the secret.
 * If auth.json doesn't exist, generates a new secret and writes it.
 * If auth.json exists with a valid secret, returns it without overwriting.
 */
const loadSecret = async (): Promise<string> => {
  const extensionDir = getExtensionDir();
  const authPath = join(extensionDir, 'auth.json');
  if (
    await access(authPath).then(
      () => true,
      () => false,
    )
  ) {
    try {
      const parsed: unknown = JSON.parse(await readFile(authPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const secret = (parsed as Record<string, unknown>).secret;
        if (typeof secret === 'string' && secret.length > 0) {
          return secret;
        }
      }
    } catch {
      log.warn(`Failed to parse auth.json at ${authPath} — generating new secret`);
    }
  }

  // auth.json doesn't exist or has no valid secret — generate and write one
  const secret = generateSecret();
  await mkdir(extensionDir, { recursive: true, mode: 0o700 });
  await atomicWrite(authPath, `${JSON.stringify({ secret })}\n`, 0o600);
  log.info(`Generated WebSocket authentication secret in ${authPath}`);
  return secret;
};

export type { OpentabsConfig };
export {
  generateSecret,
  getAdaptersDir,
  getConfigDir,
  getExtensionDir,
  getExtensionVersionFile,
  loadConfig,
  loadSecret,
  saveConfig,
  savePluginPermissions,
  savePluginSettings,
  writeAuthFile,
};
