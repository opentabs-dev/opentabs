/**
 * `opentabs plugin` command — plugin management (create, search, install, remove, list).
 */

import { colorTabState } from './status.js';
import {
  atomicWriteConfig,
  getConfigPath,
  getLocalPluginsFromConfig,
  isConnectionRefused,
  readAuthSecret,
  readConfig,
  resolvePluginPath,
} from '../config.js';
import { parsePort, resolvePort } from '../parse-port.js';
import { scaffoldPlugin, promptForMissingArgs, ScaffoldError } from '../scaffold.js';
import {
  TOOLS_FILENAME,
  OFFICIAL_SCOPE,
  PLUGIN_PREFIX,
  normalizePluginName,
  readFile,
  resolvePluginPackageCandidates,
  platformExec,
  spawnInherit,
  spawnProcess,
} from '@opentabs-dev/shared';
import pc from 'picocolors';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';

// --- npm registry types ---

interface NpmSearchPackage {
  name: string;
  description?: string;
  version: string;
  publisher?: { username: string };
}

interface NpmSearchResult {
  objects: Array<{ package: NpmSearchPackage }>;
}

/** Abbreviated response from the npm registry package endpoint */
interface NpmPackageInfo {
  name: string;
  description?: string;
  'dist-tags'?: Record<string, string>;
  maintainers?: Array<{ name?: string; username?: string }>;
}

/**
 * Notify the running MCP server to rediscover plugins via POST /reload.
 * Non-fatal — prints a hint on failure but never throws.
 */
const notifyServer = async (options: { port?: number }): Promise<void> => {
  const port = resolvePort(options);
  const secret = await readAuthSecret();

  try {
    const healthRes = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!healthRes.ok) return;
  } catch {
    // Server not running — nothing to notify
    return;
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    const res = await fetch(`http://localhost:${port}/reload`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(5_000),
    });

    if (res.ok) {
      console.log(pc.dim('Server notified — plugins rediscovered.'));
    } else {
      console.log(pc.dim(`Could not notify server (HTTP ${res.status}). Restart the server to pick up changes.`));
    }
  } catch {
    console.log(pc.dim('Could not notify server. Restart the server to pick up changes.'));
  }
};

// --- npm auth ---

/**
 * Read the npm auth token from ~/.npmrc.
 * Returns the token string or null if not found.
 */
const readNpmAuthToken = async (): Promise<string | null> => {
  try {
    const text = await readFile(join(homedir(), '.npmrc'));
    const match = /\/\/registry\.npmjs\.org\/:_authToken=(.+)/.exec(text);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
};

/**
 * Build HTTP headers for npm registry requests, including auth if available.
 */
const npmRegistryHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = await readNpmAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

// --- Install handler ---

/**
 * Check whether a package exists on the npm registry.
 * Includes npm auth token when available to support private/scoped packages.
 */
const packageExistsOnNpm = async (pkg: string): Promise<boolean> => {
  try {
    const headers = await npmRegistryHeaders();
    const res = await fetch(`https://registry.npmjs.org/${pkg}`, {
      method: 'HEAD',
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Resolve a user-supplied plugin name to the actual npm package name.
 *
 * For shorthand names (e.g., "slack"), queries the npm registry for each
 * candidate in priority order (official scoped → community unscoped) and
 * returns the first one that exists. For already-qualified names, returns as-is.
 */
const resolvePackageName = async (name: string): Promise<string | null> => {
  const candidates = resolvePluginPackageCandidates(name);
  if (candidates.length === 1) return candidates[0] ?? null;

  for (const candidate of candidates) {
    if (await packageExistsOnNpm(candidate)) return candidate;
  }
  return null;
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

  const exitCode = await spawnInherit(platformExec('npm'), ['install', '-g', pkg]);

  if (exitCode !== 0) {
    console.error(pc.red(`npm install failed (exit code ${exitCode}).`));
    process.exit(1);
  }

  console.log(pc.green(`Successfully installed ${pkg}.`));
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
      const pkgJson: unknown = JSON.parse(await readFile(pkgJsonPath));
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
    await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(
      pc.dim(`Removed ${removed.toString()} local plugin ${removed === 1 ? 'entry' : 'entries'} from config.`),
    );
  }
};

const handlePluginRemove = async (name: string, options: { port?: number }): Promise<void> => {
  const candidates = resolvePluginPackageCandidates(name);
  const isShorthand = candidates.length > 1;

  if (isShorthand) {
    console.log(`Resolving plugin ${pc.bold(name)}...`);
  }

  const pkg = await resolvePackageName(name);
  if (!pkg) {
    // Fall back to the primary candidate for uninstall (npm uninstall is lenient)
    const fallback = normalizePluginName(name);
    console.log(`Removing ${pc.bold(fallback)}...`);

    const exitCode = await spawnInherit(platformExec('npm'), ['uninstall', '-g', fallback]);

    if (exitCode !== 0) {
      console.error(pc.red(`npm uninstall failed (exit code ${exitCode}).`));
      process.exit(1);
    }

    console.log(pc.green(`Successfully removed ${fallback}.`));
    await removeFromLocalPlugins(fallback);
    await notifyServer(options);
    return;
  }

  console.log(`Removing ${pc.bold(pkg)}...`);

  const exitCode = await spawnInherit(platformExec('npm'), ['uninstall', '-g', pkg]);

  if (exitCode !== 0) {
    console.error(pc.red(`npm uninstall failed (exit code ${exitCode}).`));
    process.exit(1);
  }

  console.log(pc.green(`Successfully removed ${pkg}.`));
  await removeFromLocalPlugins(pkg);
  await notifyServer(options);
};

// --- Search handler ---

const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';

/**
 * Fetch package metadata directly from the npm registry.
 * Returns the package info if it exists, null otherwise.
 * Includes npm auth to support private/scoped packages.
 */
const fetchPackageInfo = async (pkg: string): Promise<NpmSearchPackage | null> => {
  try {
    const headers = await npmRegistryHeaders();
    const res = await fetch(`https://registry.npmjs.org/${pkg}`, {
      signal: AbortSignal.timeout(5_000),
      headers,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as NpmPackageInfo;
    const version = data['dist-tags']?.latest;
    if (!version) return null;

    const author = data.maintainers?.[0];
    return {
      name: data.name,
      description: data.description,
      version,
      publisher: author ? { username: author.username ?? author.name ?? 'unknown' } : undefined,
    };
  } catch {
    return null;
  }
};

/**
 * Build a list of candidate package names to probe directly on the npm registry.
 *
 * When a query is provided (e.g., "slack"), generates the official and community
 * package names to check via direct registry lookup. This catches private/scoped
 * packages that the npm search API excludes from keyword-based results.
 */
const buildDirectLookupCandidates = (query?: string): string[] => {
  if (!query) return [];
  // If the query is already a fully qualified name, probe it directly
  if (query.startsWith('@') || query.startsWith(PLUGIN_PREFIX)) return [query];
  return [`${OFFICIAL_SCOPE}/${PLUGIN_PREFIX}${query}`, `${PLUGIN_PREFIX}${query}`];
};

const handlePluginSearch = async (query?: string): Promise<void> => {
  const params = new URLSearchParams({
    text: query ? `keywords:opentabs-plugin ${query}` : 'keywords:opentabs-plugin',
    size: '20',
  });

  // Run npm keyword search and direct registry lookups in parallel
  const directCandidates = buildDirectLookupCandidates(query);
  const [searchResult, ...directResults] = await Promise.all([
    (async (): Promise<NpmSearchResult | string> => {
      try {
        const response = await fetch(`${NPM_SEARCH_URL}?${params.toString()}`);
        if (response.status === 429) return 'rate-limited';
        if (!response.ok) return `error-${response.status.toString()}`;
        return (await response.json()) as NpmSearchResult;
      } catch {
        return 'unreachable';
      }
    })(),
    ...directCandidates.map(candidate => fetchPackageInfo(candidate)),
  ]);

  // Collect results from keyword search
  const results: NpmSearchPackage[] = [];
  const seenNames = new Set<string>();

  if (typeof searchResult === 'object') {
    for (const { package: pkg } of searchResult.objects) {
      if (!seenNames.has(pkg.name)) {
        seenNames.add(pkg.name);
        results.push(pkg);
      }
    }
  }

  // Merge in direct lookup results (private packages not in keyword search)
  for (const info of directResults) {
    if (info && !seenNames.has(info.name)) {
      seenNames.add(info.name);
      results.push(info);
    }
  }

  if (typeof searchResult === 'string' && results.length === 0) {
    if (searchResult === 'rate-limited') {
      console.error(pc.yellow('npm registry rate limit reached. Try again in a moment.'));
    } else if (searchResult === 'unreachable') {
      console.error(pc.red('Could not reach npm registry. Check your internet connection.'));
    } else {
      console.error(
        pc.red(`npm registry returned an error (HTTP ${searchResult.replace('error-', '')}). Try again later.`),
      );
    }
    process.exit(1);
  }

  if (results.length === 0) {
    const term = query ?? '';
    console.log(pc.yellow(`No plugins found for '${term}'. Try a different search term.`));
    return;
  }

  console.log();
  for (const pkg of results) {
    const label = pkg.name.startsWith(`${OFFICIAL_SCOPE}/`) ? pc.blue('[official]') : pc.dim('[community]');
    const desc = pkg.description
      ? pkg.description.length > 60
        ? pkg.description.slice(0, 57) + '...'
        : pkg.description
      : '';
    const author = pkg.publisher?.username ?? 'unknown';

    console.log(`  ${label} ${pc.bold(pkg.name)} ${pc.dim(`v${pkg.version}`)} — ${desc} ${pc.dim(`by ${author}`)}`);
  }
  console.log();
  console.log(`Install a plugin: ${pc.cyan('opentabs plugin install <name>')}`);
  console.log();
};

// --- List handler ---

interface PluginListOptions {
  port?: number;
  json?: boolean;
}

interface HealthPluginDetail {
  name: string;
  displayName: string;
  toolCount: number;
  tabState: string;
  source?: string;
  sdkVersion?: string | null;
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
}

/**
 * Read basic info from a local plugin directory (package.json + dist/tools.json).
 */
const readLocalPluginInfo = async (
  pluginDir: string,
): Promise<{ name: string; displayName: string; version: string | null; toolCount: number } | null> => {
  try {
    const pkgJsonText = await readFile(join(pluginDir, 'package.json'));
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
    try {
      const toolsJsonText = await readFile(join(pluginDir, 'dist', TOOLS_FILENAME));
      const toolsJson = JSON.parse(toolsJsonText) as Record<string, unknown>;
      const tools = Array.isArray(toolsJson.tools) ? toolsJson.tools : [];
      toolCount = tools.length;
    } catch {
      // dist/tools.json may not exist (plugin not built yet)
    }

    return { name, displayName, version, toolCount };
  } catch {
    return null;
  }
};

/**
 * Scan global node_modules for npm-installed opentabs plugins using `npm list -g --json`.
 */
const scanNpmPlugins = async (): Promise<ListPluginEntry[]> => {
  const entries: ListPluginEntry[] = [];
  try {
    const result = await spawnProcess(platformExec('npm'), ['list', '-g', '--json', '--depth=0']);
    const stdout = result.stdout;

    const data = JSON.parse(stdout) as Record<string, unknown>;
    const deps = typeof data.dependencies === 'object' && data.dependencies !== null ? data.dependencies : {};

    for (const [pkgName, info] of Object.entries(deps as Record<string, Record<string, unknown>>)) {
      const isPlugin = pkgName.startsWith(PLUGIN_PREFIX) || new RegExp(`^@[^/]+/${PLUGIN_PREFIX}`).test(pkgName);
      if (!isPlugin) continue;

      const version = typeof info.version === 'string' ? info.version : null;
      entries.push({
        name: pkgName,
        displayName: pkgName,
        version,
        source: 'npm',
        tabState: null,
        toolCount: 0,
      });
    }
  } catch {
    // npm not available or no global packages
  }
  return entries;
};

const handlePluginList = async (options: PluginListOptions): Promise<void> => {
  const port = resolvePort(options);

  // Try to fetch from running server first
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(3_000),
    });

    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const pluginDetails = Array.isArray(data.pluginDetails) ? (data.pluginDetails as HealthPluginDetail[]) : [];
      const failedPlugins = Array.isArray(data.failedPlugins) ? (data.failedPlugins as HealthFailedPlugin[]) : [];

      if (options.json) {
        console.log(JSON.stringify({ plugins: pluginDetails, failedPlugins }, null, 2));
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
        console.log(`  ${p.displayName} ${sourceLabel} ${pc.dim('—')} ${state} ${pc.dim('·')} ${tools}${sdkWarning}`);
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
      // Unexpected error (not just "server not running") — still fall through to offline mode
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
    console.log(JSON.stringify({ plugins: deduped, serverRunning: false }, null, 2));
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
  }
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
    .description('List installed plugins')
    .option('--port <number>', 'Server port (default: 9515)', parsePort)
    .option('--json', 'Output machine-readable JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs plugin list
  $ opentabs plugin list --json
  $ opentabs plugin list --port 3000`,
    )
    .action((_options: PluginListOptions, command: Command) => handlePluginList(command.optsWithGlobals()));

  pluginCmd
    .command('install')
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
    .description('Remove a globally installed plugin')
    .argument('<name>', 'Plugin name or full package name (e.g., slack or opentabs-plugin-slack)')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs plugin remove slack
  $ opentabs plugin remove opentabs-plugin-slack
  $ opentabs plugin remove @my-org/opentabs-plugin-custom`,
    )
    .action((name: string, _options: unknown, command: Command) => handlePluginRemove(name, command.optsWithGlobals()));

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

export { registerPluginCommand, packageExistsOnNpm, resolvePackageName, buildDirectLookupCandidates };
