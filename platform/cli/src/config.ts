/**
 * Config file helpers shared across CLI commands.
 */

import {
  atomicWrite,
  fileExists as runtimeFileExists,
  getConfigDir,
  getConfigPath,
  getExtensionDir,
  getLogFilePath,
  readFile,
  toErrorMessage,
} from '@opentabs-dev/shared';
import { dirname, join, resolve, isAbsolute } from 'node:path';

export { getConfigDir, getConfigPath, getExtensionDir, getLogFilePath };

export type ConfigResult =
  | { config: Record<string, unknown>; error?: undefined }
  | { config: null; error: 'missing' }
  | { config: null; error: 'invalid'; message: string };

export const readConfig = async (configPath: string): Promise<ConfigResult> => {
  if (!(await runtimeFileExists(configPath))) {
    return { config: null, error: 'missing' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath));
  } catch (err) {
    return {
      config: null,
      error: 'invalid',
      message: `Invalid JSON: ${toErrorMessage(err)}`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const got = Array.isArray(parsed) ? 'array' : String(parsed);
    return {
      config: null,
      error: 'invalid',
      message: `Expected a JSON object, got ${got}`,
    };
  }
  return { config: parsed as Record<string, unknown> };
};

export const getLocalPluginsFromConfig = (config: Record<string, unknown>): string[] =>
  Array.isArray(config.localPlugins)
    ? (config.localPlugins as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

export const resolvePluginPath = (pluginPath: string, configPath: string): string =>
  isAbsolute(pluginPath) ? pluginPath : resolve(dirname(configPath), pluginPath);

/** Write config atomically with restrictive permissions via the shared helper. */
export const atomicWriteConfig = (configPath: string, content: string): Promise<void> =>
  atomicWrite(configPath, content, 0o600);

/**
 * Read the WebSocket authentication secret from ~/.opentabs/extension/auth.json.
 * Returns null if auth.json does not exist or has no valid secret.
 */
export const readAuthSecret = async (): Promise<string | null> => {
  const authPath = join(getExtensionDir(), 'auth.json');
  if (!(await runtimeFileExists(authPath))) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(authPath));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const secret = (parsed as Record<string, unknown>).secret;
      if (typeof secret === 'string' && secret.length > 0) return secret;
    }
  } catch {
    // Malformed auth.json — treat as missing
  }
  return null;
};

export const isConnectionRefused = (err: unknown): boolean => {
  if (!(err instanceof TypeError)) return false;
  const cause = (err as TypeError & { cause?: { code?: string } }).cause;
  return cause?.code === 'ECONNREFUSED';
};
