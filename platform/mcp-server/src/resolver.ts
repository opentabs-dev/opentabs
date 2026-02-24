/**
 * Plugin resolver module.
 *
 * Resolves plugin specifiers (npm package names or filesystem paths) into
 * absolute directory paths containing a plugin's package.json. Decouples
 * path resolution from plugin loading so each phase can be tested independently.
 *
 * Also provides global npm plugin auto-discovery: scans global node_modules
 * directories (from both npm and bun) for packages matching the opentabs-plugin-*
 * naming convention.
 */

import { log } from './logger.js';
import { ok, err, PLUGIN_PREFIX, platformExec, toErrorMessage } from '@opentabs-dev/shared';
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { Result } from '@opentabs-dev/shared';

/**
 * Allowed root directories for local plugin paths.
 * Plugins must reside under the user's home directory or the system temp directory.
 * The temp directory allowance supports E2E tests and development workflows.
 */
const getAllowedRoots = (): string[] => [homedir(), tmpdir()];

/**
 * Resolve a path to its canonical form, following symlinks.
 * Falls back to the input path if realpath fails (e.g., non-existent target).
 */
const safeRealpath = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
};

/**
 * Validate that a resolved plugin path is under an allowed root directory.
 * Uses realpath on both the plugin path and the allowed roots to resolve
 * symlinks (e.g., macOS /var → /private/var), preventing traversal attacks.
 * Checks against both raw and resolved roots to handle non-existent paths
 * where realpath falls back to the unresolved input.
 */
const isAllowedPluginPath = async (resolvedPath: string): Promise<boolean> => {
  const realPath = await safeRealpath(resolvedPath);
  const rawRoots = getAllowedRoots();
  const realRoots = await Promise.all(rawRoots.map(safeRealpath));

  // Deduplicate: on macOS, raw /var/... and resolved /private/var/... differ
  const allRoots = [...new Set([...rawRoots, ...realRoots])];
  return allRoots.some(root => realPath.startsWith(root + sep) || realPath === root);
};

/**
 * Check if a specifier is a local filesystem path.
 * Local paths start with './', '.\\', '../', '..\\', '/', '~/', '~\\',
 * or a Windows drive letter (e.g., 'C:\') — everything else is treated
 * as an npm package name.
 */
const isLocalPath = (specifier: string): boolean =>
  specifier.startsWith('./') ||
  specifier.startsWith('.\\') ||
  specifier.startsWith('../') ||
  specifier.startsWith('..\\') ||
  specifier.startsWith('/') ||
  specifier.startsWith('~/') ||
  specifier.startsWith('~\\') ||
  /^[A-Za-z]:[/\\]/.test(specifier);

/**
 * Resolve a local filesystem path specifier to an absolute directory path.
 * Paths starting with '~/' or '~\' are expanded to the user's home directory.
 * Other relative paths are resolved against configDir.
 */
const resolveLocalPath = (specifier: string, configDir: string): string => {
  if (specifier.startsWith('~/') || specifier.startsWith('~\\')) {
    return resolve(homedir(), specifier.slice(2));
  }
  return resolve(configDir, specifier);
};

/**
 * Resolve an npm package specifier to the directory containing its package.json.
 * Uses Bun.resolveSync to locate the package's package.json, then returns
 * the containing directory.
 */
const resolveNpmPackage = (specifier: string): Result<string, string> => {
  try {
    const resolved = Bun.resolveSync(`${specifier}/package.json`, process.cwd());
    return ok(dirname(resolved));
  } catch {
    return err(`Package not found: ${specifier}`);
  }
};

/**
 * Resolve a plugin specifier to an absolute directory path.
 *
 * Specifiers can be:
 * - Local paths: './my-plugin', '../plugins/foo', '/absolute/path', '~/plugins/foo'
 * - npm package names: 'opentabs-plugin-slack', '@org/opentabs-plugin-foo'
 *
 * For local paths, resolves relative to configDir and validates the path is
 * under an allowed root directory (homedir or tmpdir).
 *
 * For npm packages, uses Bun.resolveSync to locate the package directory.
 *
 * Returns the directory path containing the plugin's package.json.
 */
const resolvePluginPath = async (specifier: string, configDir: string): Promise<Result<string, string>> => {
  if (isLocalPath(specifier)) {
    const resolvedPath = resolveLocalPath(specifier, configDir);

    if (!(await isAllowedPluginPath(resolvedPath))) {
      return err(`Path outside allowed directories: ${resolvedPath}`);
    }

    // Verify the directory exists before passing to the loader
    try {
      const stats = await stat(resolvedPath);
      if (!stats.isDirectory()) {
        return err(`Path is not a directory: ${resolvedPath}`);
      }
    } catch {
      return err(`Path not found: ${resolvedPath} — check that the directory exists in your config`);
    }

    return ok(resolvedPath);
  }

  return resolveNpmPackage(specifier);
};

/** globalThis key for persisting cached global paths across bun --hot reloads */
const GLOBAL_PATHS_KEY = '__opentabs_global_paths__' as const;

/** Access the cached global paths from globalThis so the value survives bun --hot module re-evaluation */
const getCachedGlobalPaths = (): string[] | null =>
  ((globalThis as Record<string, unknown>)[GLOBAL_PATHS_KEY] as string[] | null | undefined) ?? null;

const setCachedGlobalPaths = (paths: string[] | null): void => {
  (globalThis as Record<string, unknown>)[GLOBAL_PATHS_KEY] = paths;
};

/**
 * Get global node_modules directories from both npm and bun.
 * Results are cached on globalThis so the shell commands run at most once
 * per process lifetime, surviving bun --hot module re-evaluations.
 */
const getGlobalNodeModulesPaths = (): string[] => {
  const cached = getCachedGlobalPaths();
  if (cached !== null) return cached;

  const paths: string[] = [];

  // npm global node_modules
  try {
    const result = Bun.spawnSync([platformExec('npm'), 'root', '-g']);
    if (result.exitCode === 0) {
      const npmPath = result.stdout.toString().trim();
      if (npmPath.length > 0) paths.push(npmPath);
    }
  } catch (e) {
    log.debug(`npm root -g failed: ${toErrorMessage(e)}`);
  }

  // bun global node_modules (derive from bin path: .../bin → .../node_modules)
  try {
    const result = Bun.spawnSync([platformExec('bun'), 'pm', '-g', 'bin']);
    if (result.exitCode === 0) {
      const bunBinPath = result.stdout.toString().trim();
      if (bunBinPath.length > 0) {
        const bunNodeModules = join(dirname(bunBinPath), 'node_modules');
        // Avoid duplicates if npm and bun share the same global directory
        if (!paths.includes(bunNodeModules)) paths.push(bunNodeModules);
      }
    }
  } catch (e) {
    log.debug(`bun pm -g bin failed: ${toErrorMessage(e)}`);
  }

  setCachedGlobalPaths(paths);
  return paths;
};

/**
 * Check if a directory contains a valid opentabs plugin package.json
 * (has an `opentabs` field that is an object).
 */
const hasOpentabsField = async (dir: string): Promise<boolean> => {
  try {
    const raw = (await Bun.file(join(dir, 'package.json')).json()) as Record<string, unknown>;
    return typeof raw.opentabs === 'object' && raw.opentabs !== null && !Array.isArray(raw.opentabs);
  } catch (e) {
    log.debug(`Failed to read package.json at ${join(dir, 'package.json')}: ${toErrorMessage(e)}`);
    return false;
  }
};

/**
 * Scan a single global node_modules directory for opentabs plugin packages.
 * Matches unscoped opentabs-plugin-* and scoped @scope/opentabs-plugin-* entries.
 * Returns absolute paths of directories that contain a valid plugin package.json.
 */
const scanGlobalDir = async (globalDir: string): Promise<string[]> => {
  const found: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(globalDir);
  } catch (e) {
    log.debug(`Could not read global node_modules directory ${globalDir}: ${toErrorMessage(e)}`);
    return found;
  }

  // Collect unscoped matches and scoped directories to inspect
  const unscopedChecks: Promise<void>[] = [];
  const scopeDirScans: Promise<void>[] = [];

  for (const entry of entries) {
    if (entry.startsWith(PLUGIN_PREFIX)) {
      const fullPath = join(globalDir, entry);
      unscopedChecks.push(
        hasOpentabsField(fullPath).then(valid => {
          if (valid) found.push(fullPath);
        }),
      );
    } else if (entry.startsWith('@')) {
      // Scoped package directory — scan for opentabs-plugin-* within it
      const scopeDir = join(globalDir, entry);
      scopeDirScans.push(
        readdir(scopeDir)
          .then(async scopeEntries => {
            const scopeChecks: Promise<void>[] = [];
            for (const scopeEntry of scopeEntries) {
              if (scopeEntry.startsWith(PLUGIN_PREFIX)) {
                const fullPath = join(scopeDir, scopeEntry);
                scopeChecks.push(
                  hasOpentabsField(fullPath).then(valid => {
                    if (valid) found.push(fullPath);
                  }),
                );
              }
            }
            await Promise.all(scopeChecks);
          })
          .catch((e: unknown) => {
            log.debug(`Could not read scoped directory ${scopeDir}: ${toErrorMessage(e)}`);
          }),
      );
    }
  }

  await Promise.all([...unscopedChecks, ...scopeDirScans]);
  return found;
};

/**
 * Discover globally installed npm plugin packages.
 *
 * Scans global node_modules directories (from both npm and bun) for packages
 * matching the opentabs-plugin-* naming convention. Each match is validated
 * by checking for a package.json with an `opentabs` field.
 *
 * Returns an array of absolute directory paths for discovered plugins,
 * plus any non-fatal errors encountered during scanning.
 */
const discoverGlobalNpmPlugins = async (): Promise<{ dirs: string[]; errors: string[] }> => {
  const globalPaths = getGlobalNodeModulesPaths();
  const errors: string[] = [];

  if (globalPaths.length === 0) {
    log.warn('No global node_modules paths found — skipping npm auto-discovery');
    return { dirs: [], errors };
  }

  log.info(`Scanning global node_modules for plugins: ${globalPaths.join(', ')}`);

  const allDirs: string[] = [];
  const seen = new Set<string>();

  for (const globalDir of globalPaths) {
    try {
      const dirs = await scanGlobalDir(globalDir);
      for (const dir of dirs) {
        // Deduplicate across npm/bun global paths (same package may appear in both)
        if (!seen.has(dir)) {
          seen.add(dir);
          allDirs.push(dir);
        }
      }
    } catch (e) {
      const msg = toErrorMessage(e);
      errors.push(`Error scanning ${globalDir}: ${msg}`);
    }
  }

  log.info(`Auto-discovered ${allDirs.length} npm plugin(s) globally`);
  return { dirs: allDirs, errors };
};

/** Reset the cached global paths (for testing). */
const resetGlobalPathsCache = (): void => {
  setCachedGlobalPaths(null);
};

export { discoverGlobalNpmPlugins, isAllowedPluginPath, resetGlobalPathsCache, resolvePluginPath };
