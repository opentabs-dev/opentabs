/**
 * Config file helpers shared across CLI commands.
 */

import {
  atomicWrite,
  generateSecret,
  getConfigDir,
  getConfigPath,
  getExtensionDir,
  getLogFilePath,
  toErrorMessage,
} from '@opentabs-dev/shared';
import { access, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export { getConfigDir, getConfigPath, getExtensionDir, getLogFilePath };

export type ConfigResult =
  | { config: Record<string, unknown>; error?: undefined }
  | { config: null; error: 'missing' }
  | { config: null; error: 'invalid'; message: string };

export const readConfig = async (configPath: string): Promise<ConfigResult> => {
  if (
    !(await access(configPath).then(
      () => true,
      () => false,
    ))
  ) {
    return { config: null, error: 'missing' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf-8'));
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

export const resolvePluginPath = (pluginPath: string, configPath: string): string => {
  if (pluginPath.startsWith('~/')) return resolve(homedir(), pluginPath.slice(2));
  return isAbsolute(pluginPath) ? pluginPath : resolve(dirname(configPath), pluginPath);
};

/** Write config atomically with restrictive permissions via the shared helper. */
export const atomicWriteConfig = (configPath: string, content: string): Promise<void> =>
  atomicWrite(configPath, content, 0o600);

/**
 * Read the WebSocket authentication secret from ~/.opentabs/extension/auth.json.
 * Returns null if auth.json does not exist or has no valid secret.
 */
export const readAuthSecret = async (): Promise<string | null> => {
  const authPath = join(getExtensionDir(), 'auth.json');
  if (
    !(await access(authPath).then(
      () => true,
      () => false,
    ))
  )
    return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(authPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const secret = (parsed as Record<string, unknown>).secret;
      if (typeof secret === 'string' && secret.length > 0) return secret;
    }
  } catch {
    // Malformed auth.json — treat as missing
  }
  return null;
};

/**
 * Ensure the WebSocket authentication secret exists in auth.json.
 * If auth.json already exists with a valid secret, returns it unchanged.
 * If auth.json is missing or malformed, generates a new secret, writes it, and returns it.
 */
export const ensureAuthSecret = async (): Promise<string> => {
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
        if (typeof secret === 'string' && secret.length > 0) return secret;
      }
    } catch {
      // Malformed auth.json — regenerate below
    }
  }

  const secret = generateSecret();
  await mkdir(extensionDir, { recursive: true });
  await atomicWrite(authPath, JSON.stringify({ secret }) + '\n', 0o600);
  return secret;
};

export const isConnectionRefused = (err: unknown): boolean => {
  if (!(err instanceof TypeError)) return false;
  const cause = (err as TypeError & { cause?: { code?: string } }).cause;
  return cause?.code === 'ECONNREFUSED';
};
