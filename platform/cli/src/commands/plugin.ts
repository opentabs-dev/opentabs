/**
 * `opentabs plugin` command — plugin management (create, search, install, remove, list, configure).
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  type ConfigSchema,
  type ConfigSettingDefinition,
  DEFAULT_HOST,
  isWindows,
  normalizePluginName,
  PLATFORM_PACKAGES,
  PLUGIN_PREFIX,
  pluginNameFromPackage,
  resolvePluginPackageCandidates,
  TOOLS_FILENAME,
  toErrorMessage,
} from '@opentabs-dev/shared';
import type { Command } from 'commander';
import pc from 'picocolors';
import {
  atomicWriteConfig,
  getConfigPath,
  getLocalPluginsFromConfig,
  getPluginSettings,
  isConnectionRefused,
  readAuthSecret,
  readConfig,
  resolvePluginPath,
} from '../config.js';
import { notifyServer } from '../notify-server.js';
import { parsePort, resolvePort } from '../parse-port.js';
import { promptForMissingArgs, ScaffoldError, scaffoldPlugin } from '../scaffold.js';
import { colorTabState } from './status.js';

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const spawnProcessSync = (cmd: string, args: string[]): SpawnResult => {
  // On Windows, npm/npx are .cmd shims that require cmd.exe to execute.
  // shell: true on Windows lets the shell resolve .cmd/.exe via PATHEXT.
  const result = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: isWindows() });
  if (result.error) {
    return { exitCode: 1, stdout: '', stderr: result.error.message };
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

const spawnProcessAsync = (cmd: string, args: string[]): Promise<SpawnResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: isWindows() });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EINVAL') {
        reject(
          new Error(
            `Failed to spawn '${cmd}': invalid argument (EINVAL). ` +
              `This typically happens on Windows when environment variables contain invalid values. ` +
              `Try running in a clean terminal.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    child.on('close', code => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
      });
    });
  });

const spawnInherit = (cmd: string, args: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: isWindows() });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EINVAL') {
        reject(
          new Error(
            `Failed to spawn '${cmd}': invalid argument (EINVAL). ` +
              `This typically happens on Windows when environment variables contain invalid values. ` +
              `Try running in a clean terminal.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    child.on('close', code => resolve(code ?? 1));
  });

// --- npm search result types ---

interface NpmSearchPackage {
  name: string;
  description?: string;
  version: string;
  publisher?: { username: string };
}

// --- Install handler ---

/**
 * Check whether a package exists on the npm registry via `npm view`.
 * Delegates auth to npm itself (reads ~/.npmrc), supporting private packages.
 */
const packageExistsOnNpmAsync = async (pkg: string): Promise<boolean> => {
  const result = await spawnProcessAsync('npm', ['view', pkg, 'version']);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
};

/**
 * Resolve a user-supplied plugin name to the actual npm package name.
 *
 * For shorthand names (e.g., "slack"), queries the npm registry for all
 * candidates concurrently and returns the first one by priority order
 * (official scoped → community unscoped) that exists. For already-qualified
 * names, returns as-is.
 */
const resolvePackageName = async (name: string): Promise<string | null> => {
  const candidates = resolvePluginPackageCandidates(name);
  if (candidates.length === 1) return candidates[0] ?? null;

  const results = await Promise.all(candidates.map(candidate => packageExistsOnNpmAsync(candidate)));
  const found = candidates.find((_, i) => results[i]);
  return found ?? null;
};

/**
 * After a global npm install, check the installed package's package.json for
 * the `opentabs` field or `opentabs-plugin` keyword. Prints a yellow warning
 * if neither is found — the install is not rolled back.
 */
const warnIfNotPlugin = async (pkg: string): Promise<void> => {
  try {
    const rootResult = await spawnProcessAsync('npm', ['root', '-g']);
    const globalRoot = rootResult.stdout.trim();

    const pkgJsonPath = join(globalRoot, pkg, 'package.json');
    const pkgJsonText = await readFile(pkgJsonPath, 'utf-8');
    const pkgJson = JSON.parse(pkgJsonText) as Record<string, unknown>;

    const hasOpentabsField = typeof pkgJson.opentabs === 'object' && pkgJson.opentabs !== null;
    const keywords = Array.isArray(pkgJson.keywords) ? (pkgJson.keywords as unknown[]) : [];
    const hasPluginKeyword = keywords.includes('opentabs-plugin');

    if (!hasOpentabsField && !hasPluginKeyword) {
      console.log(
        pc.yellow(
          'Warning: This package does not appear to be an OpenTabs plugin (missing opentabs metadata). It may not load correctly.',
        ),
      );
    }
  } catch {
    // Cannot read installed package — skip validation silently
  }
};

const handlePluginInstall = async (name: string, options: { port?: number }): Promise<void> => {
  const candidates = resolvePluginPackageCandidates(name);
  const isShorthand = candidates.length > 1;

  if (isShorthand) {
    console.log(`Resolving plugin ${pc.bold(name)}...`);
  }

  const pkg = await resolvePackageName(name);
  if (!pkg) {
    console.error(pc.red(`Plugin "${name}" not found on npm.`));
    if (isShorthand) {
      console.error(pc.dim(`Tried: ${candidates.join(', ')}`));
    }
    process.exit(1);
  }

  console.log(`Installing ${pc.bold(pkg)}...`);

  const exitCode = await spawnInherit('npm', ['install', '-g', pkg]);

  if (exitCode !== 0) {
    console.error(pc.red(`npm install failed (exit code ${exitCode}).`));
    process.exit(1);
  }

  console.log(pc.green(`Successfully installed ${pkg}.`));
  await warnIfNotPlugin(pkg);
  await notifyServer(options);
};

// --- Remove handler ---

/**
 * Remove matching entries from localPlugins in config.
 * An entry matches if its resolved package.json `name` field equals the package name.
 */
const removeFromLocalPlugins = async (pkg: string): Promise<void> => {
  const configPath = getConfigPath();
  const { config } = await readConfig(configPath);
  if (!config) return;

  const localPlugins = getLocalPluginsFromConfig(config);
  if (localPlugins.length === 0) return;

  const remaining: string[] = [];
  for (const entry of localPlugins) {
    const resolved = resolvePluginPath(entry, configPath);
    const pkgJsonPath = join(resolved, 'package.json');
    try {
      const pkgJson: unknown = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
      if (typeof pkgJson === 'object' && pkgJson !== null && (pkgJson as Record<string, unknown>).name === pkg) {
        continue;
      }
    } catch {
      // Cannot read package.json — keep the entry
    }
    remaining.push(entry);
  }

  if (remaining.length < localPlugins.length) {
    const removed = localPlugins.length - remaining.length;
    config.localPlugins = remaining;
    await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(
      pc.dim(`Removed ${removed.toString()} local plugin ${removed === 1 ? 'entry' : 'entries'} from config.`),
    );
  }
};

interface PluginRemoveOptions {
  port?: number;
  confirm?: boolean;
}

const handlePluginRemove = async (name: string, options: PluginRemoveOptions): Promise<void> => {
  const candidates = resolvePluginPackageCandidates(name);
  const isShorthand = candidates.length > 1;

  if (isShorthand) {
    console.log(`Resolving plugin ${pc.bold(name)}...`);
  }

  const pkg = (await resolvePackageName(name)) ?? normalizePluginName(name);

  if (!options.confirm) {
    console.error(`This will remove the plugin ${pc.bold(pkg)} globally.`);
    console.error('');
    console.error(`Run with ${pc.bold('--confirm')} (or ${pc.bold('-y')}) to proceed:`);
    console.error(`  opentabs plugin remove ${name} --confirm`);
    process.exit(1);
  }

  const checkResult = spawnProcessSync('npm', ['list', '-g', pkg, '--depth=0']);
  if (checkResult.exitCode !== 0) {
    console.error(pc.red(`Plugin ${pkg} is not installed globally.`));
    process.exit(1);
  }

  console.log(`Removing ${pc.bold(pkg)}...`);

  const exitCode = await spawnInherit('npm', ['uninstall', '-g', pkg]);

  if (exitCode !== 0) {
    console.error(pc.red(`npm uninstall failed (exit code ${exitCode}).`));
    process.exit(1);
  }

  console.log(pc.green(`Successfully removed ${pkg}.`));
  await removeFromLocalPlugins(pkg);
  await notifyServer(options);
};

// --- Search handler ---

const NPM_REGISTRY = 'https://registry.npmjs.org';

const extractShortName = (name: string): string => (name.split('/').pop() ?? name).replace(/^opentabs-plugin-/, '');

/**
 * Build a list of candidate package names to probe directly on the npm registry.
 *
 * When a query is provided (e.g., "slack"), generates the official and community
 * package names to check via direct registry lookup. This catches private/scoped
 * packages that keyword search may miss.
 *
 * When no query is provided, returns an empty list (the paginated keyword search
 * fetches all opentabs plugins).
 */
const buildDirectLookupCandidates = (query?: string): string[] => {
  if (!query) return [];
  if (query.startsWith('@')) return [query];
  if (query.startsWith(PLUGIN_PREFIX)) return [`@opentabs-dev/${query}`, query];
  return [`@opentabs-dev/${PLUGIN_PREFIX}${query}`, `${PLUGIN_PREFIX}${query}`];
};

/**
 * Fetch package metadata from the npm registry HTTP API.
 */
const fetchPackageInfo = async (pkg: string): Promise<NpmSearchPackage | null> => {
  try {
    const resp = await fetch(`${NPM_REGISTRY}/${pkg}`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      name: string;
      description?: string;
      'dist-tags'?: Record<string, string>;
      versions?: Record<string, { _npmUser?: { name?: string } }>;
    };
    const latest = data['dist-tags']?.latest;
    if (!latest) return null;
    const versionData = data.versions?.[latest];
    return {
      name: data.name,
      description: data.description,
      version: latest,
      publisher: versionData?._npmUser?.name ? { username: versionData._npmUser.name } : undefined,
    };
  } catch {
    return null;
  }
};

/**
 * Search the npm registry for opentabs plugins via the registry HTTP API.
 * Fetches all results with pagination (250 per page).
 */
const npmSearchPlugins = async (query?: string): Promise<NpmSearchPackage[]> => {
  const results: NpmSearchPackage[] = [];
  let from = 0;
  const size = 250;
  try {
    while (true) {
      const url = `${NPM_REGISTRY}/-/v1/search?text=keywords:opentabs-plugin&size=${size}&from=${from}`;
      const resp = await fetch(url);
      if (!resp.ok) break;
      const data = (await resp.json()) as {
        objects: Array<{
          package: { name: string; description?: string; version: string; publisher?: { username: string } };
        }>;
        total: number;
      };
      for (const obj of data.objects) {
        const pkg = obj.package;
        results.push({
          name: pkg.name,
          description: pkg.description,
          version: pkg.version,
          publisher: pkg.publisher?.username ? { username: pkg.publisher.username } : undefined,
        });
      }
      if (results.length >= data.total) break;
      from += size;
    }
  } catch {
    return results;
  }
  if (query) {
    const q = query.toLowerCase();
    return results.filter(
      r =>
        r.name.toLowerCase().includes(q) ||
        extractShortName(r.name).toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q),
    );
  }
  return results;
};

const handlePluginSearch = async (query?: string): Promise<void> => {
  // Run keyword search and direct probe in parallel
  const directCandidates = buildDirectLookupCandidates(query);
  const [searchResults, ...directResults] = await Promise.all([
    npmSearchPlugins(query),
    ...directCandidates.map(candidate => fetchPackageInfo(candidate)),
  ]);

  // Merge: direct probe results first (exact match priority), then keyword results (deduplicated)
  const results: NpmSearchPackage[] = [];
  const seenNames = new Set<string>();

  for (const info of directResults) {
    if (info && !PLATFORM_PACKAGES.has(info.name) && !seenNames.has(info.name)) {
      seenNames.add(info.name);
      results.push(info);
    }
  }

  for (const pkg of searchResults) {
    if (!PLATFORM_PACKAGES.has(pkg.name) && !seenNames.has(pkg.name)) {
      seenNames.add(pkg.name);
      results.push(pkg);
    }
  }

  if (results.length === 0) {
    console.log(
      pc.yellow(query ? `No plugins found for "${query}". Try a different search term.` : 'No plugins found.'),
    );
    return;
  }

  const termWidth = process.stdout.columns || 80;

  // Compute the max visible width used by non-description parts across all results.
  // Line format: "  name vVersion — desc by author"
  const overheadPerPkg = results.map(pkg => {
    const author = pkg.publisher?.username ?? 'unknown';
    // 2 indent + name + 1 space + "v" + version + " — " + " by " + author
    return 2 + pkg.name.length + 1 + 1 + pkg.version.length + 3 + 4 + author.length;
  });
  const maxOverhead = Math.max(...overheadPerPkg);
  const descWidth = Math.max(30, termWidth - maxOverhead);

  console.log();
  for (const pkg of results) {
    const desc = pkg.description
      ? pkg.description.length > descWidth
        ? `${pkg.description.slice(0, descWidth - 3)}...`
        : pkg.description
      : '';
    const author = pkg.publisher?.username ?? 'unknown';

    console.log(
      `  ${pc.bold(pkg.name)} ${pc.dim(`v${pkg.version}`)}${desc ? ` — ${desc}` : ''} ${pc.dim(`by ${author}`)}`,
    );
  }
  console.log();
  console.log(`Install a plugin: ${pc.cyan('opentabs plugin install <name>')}`);
  console.log();
};

// --- List handler ---

interface PluginListOptions {
  port?: number;
  json?: boolean;
  verbose?: boolean;
}

interface HealthPluginDetail {
  name: string;
  displayName: string;
  toolCount: number;
  tabState: string;
  source?: string;
  sdkVersion?: string | null;
  tools?: string[];
  needsSetup?: boolean;
}

interface HealthFailedPlugin {
  specifier: string;
  error: string;
}

interface ListPluginEntry {
  name: string;
  displayName: string;
  version: string | null;
  source: 'npm' | 'local';
  tabState: string | null;
  toolCount: number;
  toolNames?: string[];
}

/**
 * Read basic info from a local plugin directory (package.json + dist/tools.json).
 */
const readLocalPluginInfo = async (
  pluginDir: string,
): Promise<{
  name: string;
  displayName: string;
  version: string | null;
  toolCount: number;
  toolNames: string[];
} | null> => {
  try {
    const pkgJsonText = await readFile(join(pluginDir, 'package.json'), 'utf-8');
    const pkgJson = JSON.parse(pkgJsonText) as Record<string, unknown>;
    const name = typeof pkgJson.name === 'string' ? pkgJson.name : null;
    if (!name) return null;

    const opentabs = typeof pkgJson.opentabs === 'object' && pkgJson.opentabs !== null ? pkgJson.opentabs : null;
    const displayName =
      opentabs && typeof (opentabs as Record<string, unknown>).displayName === 'string'
        ? ((opentabs as Record<string, unknown>).displayName as string)
        : name;
    const version = typeof pkgJson.version === 'string' ? pkgJson.version : null;

    let toolCount = 0;
    let toolNames: string[] = [];
    try {
      const toolsJsonText = await readFile(join(pluginDir, 'dist', TOOLS_FILENAME), 'utf-8');
      const toolsJson = JSON.parse(toolsJsonText) as Record<string, unknown>;
      const tools = Array.isArray(toolsJson.tools) ? (toolsJson.tools as Record<string, unknown>[]) : [];
      toolCount = tools.length;
      toolNames = tools.map(t => (typeof t.name === 'string' ? t.name : null)).filter((n): n is string => n !== null);
    } catch {
      // dist/tools.json may not exist (plugin not built yet)
    }

    return { name, displayName, version, toolCount, toolNames };
  } catch {
    return null;
  }
};

/**
 * Scan global node_modules for npm-installed opentabs plugins using `npm list -g --json`.
 * Reads each plugin's package.json and dist/tools.json to populate displayName and toolCount.
 */
const scanNpmPlugins = async (): Promise<ListPluginEntry[]> => {
  const entries: ListPluginEntry[] = [];
  try {
    const [listResult, rootResult] = await Promise.all([
      spawnProcessAsync('npm', ['list', '-g', '--json', '--depth=0']),
      spawnProcessAsync('npm', ['root', '-g']),
    ]);

    const globalRoot = rootResult.exitCode === 0 ? rootResult.stdout.trim() : '';

    const data = JSON.parse(listResult.stdout) as Record<string, unknown>;
    const deps = typeof data.dependencies === 'object' && data.dependencies !== null ? data.dependencies : {};

    for (const [pkgName, info] of Object.entries(deps as Record<string, Record<string, unknown>>)) {
      const isPlugin = pkgName.startsWith(PLUGIN_PREFIX) || new RegExp(`^@[^/]+/${PLUGIN_PREFIX}`).test(pkgName);
      if (!isPlugin) continue;

      const version = typeof info.version === 'string' ? info.version : null;
      const pluginInfo = globalRoot ? await readLocalPluginInfo(join(globalRoot, pkgName)) : null;

      entries.push({
        name: pkgName,
        displayName: pluginInfo?.displayName ?? pkgName,
        version: pluginInfo?.version ?? version,
        source: 'npm',
        tabState: null,
        toolCount: pluginInfo?.toolCount ?? 0,
        toolNames: pluginInfo?.toolNames,
      });
    }
  } catch {
    // npm not available or no global packages
  }
  return entries;
};

const handlePluginList = async (options: PluginListOptions): Promise<void> => {
  const port = resolvePort(options);
  const secret = await readAuthSecret();

  // Try to fetch from running server first
  try {
    const headers: Record<string, string> = {};
    if (secret) headers.Authorization = `Bearer ${secret}`;

    const res = await fetch(`http://${DEFAULT_HOST}:${port}/health`, {
      headers,
      signal: AbortSignal.timeout(3_000),
    });

    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const pluginDetails = Array.isArray(data.pluginDetails) ? (data.pluginDetails as HealthPluginDetail[]) : [];
      const failedPlugins = Array.isArray(data.failedPlugins) ? (data.failedPlugins as HealthFailedPlugin[]) : [];

      if (options.json) {
        console.log(JSON.stringify({ plugins: pluginDetails, failedPlugins, serverRunning: true }, null, 2));
        return;
      }

      if (pluginDetails.length === 0 && failedPlugins.length === 0) {
        console.log(pc.dim('No plugins installed.'));
        console.log(`\nSearch for plugins: ${pc.cyan('opentabs plugin search')}`);
        return;
      }

      console.log(pc.bold('Installed Plugins'));
      console.log();

      for (const p of pluginDetails) {
        const state = colorTabState(p.tabState);
        const tools = pc.dim(`${p.toolCount} tool${p.toolCount === 1 ? '' : 's'}`);
        const sourceLabel = p.source === 'local' ? pc.dim('(local)') : pc.dim('(npm)');
        const sdkWarning = p.sdkVersion === null ? ` ${pc.yellow('⚠ no SDK version')}` : '';
        const setupIndicator = p.needsSetup ? ` ${pc.yellow('⚙ needs setup')}` : '';
        console.log(
          `  ${p.displayName} ${sourceLabel} ${pc.dim('—')} ${state} ${pc.dim('·')} ${tools}${sdkWarning}${setupIndicator}`,
        );
        if (options.verbose && p.tools && p.tools.length > 0) {
          console.log(`      ${pc.dim(p.tools.join(', '))}`);
        }
      }

      if (failedPlugins.length > 0) {
        console.log();
        console.log(pc.bold('Failed Plugins'));
        console.log();
        for (const f of failedPlugins) {
          console.log(`  ${pc.red(f.specifier)} ${pc.dim('—')} ${f.error}`);
        }
      }

      return;
    }
  } catch (err: unknown) {
    if (!isConnectionRefused(err)) {
      console.error(pc.dim(`Could not reach server: ${toErrorMessage(err)}. Showing offline data.`));
    }
  }

  // Offline mode — server is not running
  const configPath = getConfigPath();
  const { config } = await readConfig(configPath);
  const localPlugins = config ? getLocalPluginsFromConfig(config) : [];

  const localEntries: ListPluginEntry[] = [];
  for (const entry of localPlugins) {
    const resolved = resolvePluginPath(entry, configPath);
    const info = await readLocalPluginInfo(resolved);
    if (info) {
      localEntries.push({
        name: info.name,
        displayName: info.displayName,
        version: info.version,
        source: 'local',
        tabState: null,
        toolCount: info.toolCount,
        toolNames: info.toolNames,
      });
    } else {
      localEntries.push({
        name: entry,
        displayName: entry,
        version: null,
        source: 'local',
        tabState: null,
        toolCount: 0,
      });
    }
  }

  const npmEntries = await scanNpmPlugins();

  // Deduplicate: local entries take precedence over npm entries with the same name
  const seenNames = new Set(localEntries.map(e => e.name));
  const deduped = [...localEntries, ...npmEntries.filter(e => !seenNames.has(e.name))];

  if (options.json) {
    console.log(JSON.stringify({ plugins: deduped, failedPlugins: [], serverRunning: false }, null, 2));
    return;
  }

  if (deduped.length === 0) {
    console.log(pc.dim('No plugins installed.'));
    console.log(`\nSearch for plugins: ${pc.cyan('opentabs plugin search')}`);
    return;
  }

  console.log(pc.bold('Installed Plugins'));
  console.log(pc.dim('(server not running — tab state unavailable)'));
  console.log();

  for (const p of deduped) {
    const version = p.version ? pc.dim(`v${p.version}`) : pc.dim('unknown version');
    const sourceLabel = p.source === 'local' ? pc.dim('(local)') : pc.dim('(npm)');
    const tools = p.toolCount > 0 ? pc.dim(`${p.toolCount} tool${p.toolCount === 1 ? '' : 's'}`) : '';
    const parts = [p.displayName, sourceLabel, pc.dim('—'), version];
    if (tools) parts.push(pc.dim('·'), tools);
    console.log(`  ${parts.join(' ')}`);
    if (options.verbose && p.toolNames && p.toolNames.length > 0) {
      console.log(`      ${pc.dim(p.toolNames.join(', '))}`);
    }
  }
};

// --- Configure handler ---

/**
 * Find a plugin directory on disk by scanning local plugins and global npm.
 * Returns the absolute path to the plugin directory and the package name, or null.
 */
const findPluginDir = async (name: string): Promise<{ dir: string; packageName: string; shortName: string } | null> => {
  const configPath = getConfigPath();
  const { config } = await readConfig(configPath);
  const localPlugins = config ? getLocalPluginsFromConfig(config) : [];

  // Check local plugins first
  for (const entry of localPlugins) {
    const resolved = resolvePluginPath(entry, configPath);
    try {
      const pkgJsonText = await readFile(join(resolved, 'package.json'), 'utf-8');
      const pkgJson = JSON.parse(pkgJsonText) as Record<string, unknown>;
      const pkgName = typeof pkgJson.name === 'string' ? pkgJson.name : null;
      if (!pkgName) continue;
      const shortName = pluginNameFromPackage(pkgName);
      if (shortName === name || pkgName === name) {
        return { dir: resolved, packageName: pkgName, shortName };
      }
    } catch {
      // Skip unreadable local plugins
    }
  }

  // Check global npm
  try {
    const rootResult = await spawnProcessAsync('npm', ['root', '-g']);
    if (rootResult.exitCode !== 0) return null;
    const globalRoot = rootResult.stdout.trim();

    // Try candidate package names
    const candidates = resolvePluginPackageCandidates(name);
    for (const candidate of candidates) {
      const pluginDir = join(globalRoot, candidate);
      try {
        const pkgJsonText = await readFile(join(pluginDir, 'package.json'), 'utf-8');
        const pkgJson = JSON.parse(pkgJsonText) as Record<string, unknown>;
        const pkgName = typeof pkgJson.name === 'string' ? pkgJson.name : candidate;
        return { dir: pluginDir, packageName: pkgName, shortName: pluginNameFromPackage(pkgName) };
      } catch {
        // Package not installed at this candidate path
      }
    }
  } catch {
    // npm not available
  }

  return null;
};

/**
 * Read configSchema from a plugin's dist/tools.json manifest.
 */
const readPluginConfigSchema = async (pluginDir: string): Promise<ConfigSchema | null> => {
  try {
    const toolsJsonPath = join(pluginDir, 'dist', TOOLS_FILENAME);
    const manifest = JSON.parse(await readFile(toolsJsonPath, 'utf-8')) as Record<string, unknown>;
    const configSchema = manifest.configSchema;
    if (!configSchema || typeof configSchema !== 'object' || Array.isArray(configSchema)) return null;
    return configSchema as ConfigSchema;
  } catch {
    return null;
  }
};

/**
 * Prompt for a single field value using readline.
 */
const promptField = async (
  rl: ReturnType<typeof createInterface>,
  key: string,
  definition: ConfigSettingDefinition,
  currentValue: unknown,
): Promise<string | number | boolean | Record<string, string> | undefined> => {
  const label = definition.label || key;
  const required = definition.required === true;
  const hasCurrentValue = currentValue !== undefined && currentValue !== null;

  console.log();
  console.log(`  ${pc.bold(label)}${required ? pc.red(' *') : ''}`);
  if (definition.description) {
    console.log(`  ${pc.dim(definition.description)}`);
  }

  if (definition.type === 'select' && definition.options) {
    console.log(`  ${pc.dim('Options:')}`);
    for (let i = 0; i < definition.options.length; i++) {
      const marker = currentValue === definition.options[i] ? pc.green('→') : ' ';
      console.log(`  ${marker} ${(i + 1).toString()}) ${definition.options[i]}`);
    }
    const hint = hasCurrentValue ? `current: ${String(currentValue)}` : (definition.placeholder ?? '');
    const prompt = hint
      ? `  Enter choice (1-${definition.options.length}) [${hint}]: `
      : `  Enter choice (1-${definition.options.length}): `;

    while (true) {
      const answer = await rl.question(prompt);
      if (answer.trim() === '' && hasCurrentValue) return currentValue as string;
      if (answer.trim() === '' && !required) return undefined;
      const num = parseInt(answer.trim(), 10);
      if (num >= 1 && num <= definition.options.length) {
        return definition.options[num - 1];
      }
      // Allow typing the option value directly
      if (definition.options.includes(answer.trim())) {
        return answer.trim();
      }
      console.log(pc.red(`  Invalid choice. Enter a number between 1 and ${definition.options.length}.`));
    }
  }

  if (definition.type === 'boolean') {
    const currentDisplay = hasCurrentValue ? (currentValue ? 'yes' : 'no') : '';
    const hint = currentDisplay || 'yes/no';
    const prompt = `  (${hint}): `;

    while (true) {
      const answer = await rl.question(prompt);
      if (answer.trim() === '' && hasCurrentValue) return currentValue as boolean;
      if (answer.trim() === '' && !required) return undefined;
      const lower = answer.trim().toLowerCase();
      if (['yes', 'y', 'true', '1'].includes(lower)) return true;
      if (['no', 'n', 'false', '0'].includes(lower)) return false;
      console.log(pc.red('  Enter yes or no.'));
    }
  }

  if (definition.type === 'number') {
    const hint = hasCurrentValue ? String(currentValue) : (definition.placeholder ?? '');
    const prompt = hint ? `  Value [${hint}]: ` : '  Value: ';

    while (true) {
      const answer = await rl.question(prompt);
      if (answer.trim() === '' && hasCurrentValue) return currentValue as number;
      if (answer.trim() === '' && !required) return undefined;
      if (answer.trim() === '' && required) {
        console.log(pc.red('  This field is required.'));
        continue;
      }
      const num = Number(answer.trim());
      if (!Number.isNaN(num)) return num;
      console.log(pc.red('  Enter a valid number.'));
    }
  }

  // url — multi-instance name→URL pairs
  if (definition.type === 'url') {
    const currentMap =
      typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue)
        ? (currentValue as Record<string, string>)
        : {};
    const currentEntries = Object.entries(currentMap);
    const entries: Array<{ name: string; url: string }> = [];

    let instanceNum = 1;
    const promptInstance = async (
      defaultName?: string,
      defaultUrl?: string,
    ): Promise<{ name: string; url: string }> => {
      console.log(`  ${pc.dim(`Instance ${instanceNum}:`)}`);

      let name = '';
      while (true) {
        const nameHint = defaultName ?? '';
        const namePrompt = nameHint ? `    Name [${nameHint}]: ` : '    Name: ';
        const nameAnswer = await rl.question(namePrompt);
        name = nameAnswer.trim() || defaultName || '';
        if (name.length === 0) {
          console.log(pc.red('    Instance name is required.'));
          continue;
        }
        if (entries.some(e => e.name === name)) {
          console.log(pc.red(`    Instance name "${name}" is already used. Choose a different name.`));
          continue;
        }
        break;
      }

      let url = '';
      while (true) {
        const urlHint = defaultUrl ?? definition.placeholder ?? '';
        const urlPrompt = urlHint ? `    URL [${urlHint}]: ` : '    URL: ';
        const urlAnswer = await rl.question(urlPrompt);
        url = urlAnswer.trim() || defaultUrl || '';
        if (url.length === 0) {
          console.log(pc.red('    URL is required.'));
          continue;
        }
        try {
          new URL(url);
        } catch {
          console.log(pc.red('    Invalid URL. Enter a valid URL (e.g., https://example.com).'));
          continue;
        }
        break;
      }

      return { name, url };
    };

    // Prompt for existing entries first (as defaults)
    for (const [existingName, existingUrl] of currentEntries) {
      const entry = await promptInstance(existingName, existingUrl);
      entries.push(entry);
      instanceNum++;
    }

    // If no existing entries, prompt for the first one
    if (entries.length === 0) {
      const entry = await promptInstance();
      entries.push(entry);
      instanceNum++;
    }

    // Ask to add more instances
    while (true) {
      const addMore = await rl.question('  Add another instance? (y/n) [n]: ');
      if (addMore.trim().toLowerCase() === 'y') {
        const entry = await promptInstance();
        entries.push(entry);
        instanceNum++;
      } else {
        break;
      }
    }

    const result: Record<string, string> = {};
    for (const entry of entries) {
      result[entry.name] = entry.url;
    }
    return result;
  }

  // string
  const hint = hasCurrentValue ? String(currentValue) : (definition.placeholder ?? '');
  const prompt = hint ? `  Value [${hint}]: ` : '  Value: ';

  while (true) {
    const answer = await rl.question(prompt);
    if (answer.trim() === '' && hasCurrentValue) return currentValue as string;
    if (answer.trim() === '' && !required) return undefined;
    if (answer.trim() === '' && required) {
      console.log(pc.red('  This field is required.'));
      continue;
    }
    return answer.trim();
  }
};

const handlePluginConfigure = async (name: string, options: { port?: number }): Promise<void> => {
  const found = await findPluginDir(name);
  if (!found) {
    console.error(pc.red(`Plugin "${name}" is not installed.`));
    console.error(`Install it first: ${pc.cyan(`opentabs plugin install ${name}`)}`);
    process.exit(1);
  }

  const configSchema = await readPluginConfigSchema(found.dir);
  if (!configSchema || Object.keys(configSchema).length === 0) {
    console.error(pc.red(`Plugin "${found.shortName}" does not have any configurable settings.`));
    process.exit(1);
  }

  const configPath = getConfigPath();
  const { config } = await readConfig(configPath);
  const currentSettings = config ? getPluginSettings(config, found.shortName) : {};

  console.log();
  console.log(`Configuring ${pc.bold(found.shortName)}`);
  console.log(pc.dim('Press Enter to keep the current value. Required fields are marked with *'));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const newSettings: Record<string, unknown> = {};

  try {
    for (const [key, definition] of Object.entries(configSchema)) {
      const value = await promptField(rl, key, definition, currentSettings[key]);
      if (value !== undefined) {
        newSettings[key] = value;
      }
    }
  } finally {
    rl.close();
  }

  // Save settings to config.json
  const saveResult = await readConfig(configPath);
  const saveConfig = saveResult.config ?? {};

  if (!saveConfig.settings || typeof saveConfig.settings !== 'object' || Array.isArray(saveConfig.settings)) {
    saveConfig.settings = {};
  }
  const settingsMap = saveConfig.settings as Record<string, unknown>;

  if (Object.keys(newSettings).length > 0) {
    settingsMap[found.shortName] = newSettings;
  } else {
    delete settingsMap[found.shortName];
  }

  // Clean up empty settings map
  if (Object.keys(settingsMap).length === 0) {
    delete saveConfig.settings;
  }

  await atomicWriteConfig(configPath, `${JSON.stringify(saveConfig, null, 2)}\n`);

  console.log();
  console.log(pc.green('Settings saved.'));

  // Notify server (best-effort)
  await notifyServer({ port: options.port, warnIfNotRunning: true });
};

// --- Command registration ---

const registerPluginCommand = (program: Command): void => {
  const pluginCmd = program
    .command('plugin')
    .description('Manage plugins')
    .action(() => {
      pluginCmd.help();
    });

  pluginCmd
    .command('search')
    .description('Search npm registry for opentabs plugins')
    .argument('[query]', 'Search term (optional — lists all plugins if omitted)')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs plugin search slack
  $ opentabs plugin search          # lists all available plugins`,
    )
    .action(async (query?: string) => {
      await handlePluginSearch(query);
    });

  pluginCmd
    .command('list')
    .alias('ls')
    .description('List installed plugins')
    .option('--port <number>', 'Server port (default: 9515)', parsePort)
    .option('--json', 'Output machine-readable JSON')
    .option('-v, --verbose', 'Show tool names for each plugin')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs plugin list
  $ opentabs plugin list --verbose
  $ opentabs plugin list --json
  $ opentabs plugin list --port 3000`,
    )
    .action((_options: PluginListOptions, command: Command) => handlePluginList(command.optsWithGlobals()));

  pluginCmd
    .command('install')
    .alias('add')
    .description('Install a plugin from npm')
    .argument('<name>', 'Plugin name or full package name (e.g., slack or opentabs-plugin-slack)')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs plugin install slack
  $ opentabs plugin install opentabs-plugin-slack
  $ opentabs plugin install @my-org/opentabs-plugin-custom`,
    )
    .action((name: string, _options: unknown, command: Command) =>
      handlePluginInstall(name, command.optsWithGlobals()),
    );

  pluginCmd
    .command('remove')
    .alias('rm')
    .description('Remove a globally installed plugin')
    .argument('<name>', 'Plugin name or full package name (e.g., slack or opentabs-plugin-slack)')
    .option('-y, --confirm', 'Confirm removal')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs plugin remove slack --confirm
  $ opentabs plugin remove opentabs-plugin-slack -y
  $ opentabs plugin remove @my-org/opentabs-plugin-custom --confirm`,
    )
    .action((name: string, _options: unknown, command: Command) => handlePluginRemove(name, command.optsWithGlobals()));

  pluginCmd
    .command('configure')
    .alias('config')
    .description('Configure plugin settings (e.g., instance URL for self-hosted tools)')
    .argument('<name>', 'Plugin name (e.g., sqlpad, github)')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs plugin configure sqlpad
  $ opentabs plugin configure github`,
    )
    .action((name: string, _options: unknown, command: Command) =>
      handlePluginConfigure(name, command.optsWithGlobals()),
    );

  pluginCmd
    .command('create')
    .description('Scaffold a new plugin project')
    .argument('[name]', 'Plugin name (lowercase alphanumeric + hyphens)')
    .option('--domain <domain>', 'Target domain (e.g., .slack.com or github.com)')
    .option('--display <name>', 'Display name (e.g., Slack)')
    .option('--description <desc>', 'Plugin description')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs plugin create                                  # interactive mode
  $ opentabs plugin create my-plugin --domain .example.com
  $ opentabs plugin create slack --domain .slack.com --display Slack`,
    )
    .action(async (name: string | undefined, options: { domain?: string; display?: string; description?: string }) => {
      try {
        const args = await promptForMissingArgs({
          name,
          domain: options.domain,
          display: options.display,
          description: options.description,
        });
        await scaffoldPlugin(args);
      } catch (err: unknown) {
        if (err instanceof ScaffoldError) {
          console.error(pc.red(`Error: ${err.message}`));
          process.exit(1);
        }
        throw err;
      }
    });
};

export {
  buildDirectLookupCandidates,
  findPluginDir,
  handlePluginConfigure,
  pluginNameFromPackage,
  readLocalPluginInfo,
  readPluginConfigSchema,
  registerPluginCommand,
  removeFromLocalPlugins,
  resolvePackageName,
  scanNpmPlugins,
  warnIfNotPlugin,
};
