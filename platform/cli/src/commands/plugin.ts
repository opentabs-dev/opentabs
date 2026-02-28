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
import { notifyServer } from '../notify-server.js';
import { parsePort, resolvePort } from '../parse-port.js';
import { scaffoldPlugin, promptForMissingArgs, ScaffoldError } from '../scaffold.js';
import {
  TOOLS_FILENAME,
  OFFICIAL_SCOPE,
  PLUGIN_PREFIX,
  normalizePluginName,
  resolvePluginPackageCandidates,
  platformExec,
  toErrorMessage,
} from '@opentabs-dev/shared';
import pc from 'picocolors';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const spawnProcessSync = (cmd: string, args: string[]): SpawnResult => {
  const result = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
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
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
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

  const exitCode = await spawnInherit(platformExec('npm'), ['install', '-g', pkg]);

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
    await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');
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

  const checkResult = spawnProcessSync(platformExec('npm'), ['list', '-g', pkg, '--depth=0']);
  if (checkResult.exitCode !== 0) {
    console.error(pc.red(`Plugin ${pkg} is not installed globally.`));
    process.exit(1);
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

/**
 * Extract a display name from an npm maintainer entry.
 * npm view returns maintainers as strings like "name <email@example.com>".
 * Object format `{ name, username }` is also handled for compatibility.
 */
const parseMaintainer = (entry: unknown): string | undefined => {
  if (typeof entry === 'string') {
    const match = entry.match(/^(.+?)\s*</);
    return match?.[1]?.trim() || entry.trim() || undefined;
  }
  if (entry && typeof entry === 'object') {
    const obj = entry as Record<string, unknown>;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.username === 'string') return obj.username;
  }
  return undefined;
};

/**
 * Fetch package metadata via `npm view`.
 * Delegates auth to npm itself (reads ~/.npmrc), supporting private packages.
 */
const fetchPackageInfo = (pkg: string): NpmSearchPackage | null => {
  try {
    const result = spawnProcessSync('npm', ['view', pkg, 'name', 'description', 'version', 'maintainers', '--json']);
    if (result.exitCode !== 0) return null;

    const data = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    const name = typeof data.name === 'string' ? data.name : pkg;
    const version = typeof data.version === 'string' ? data.version : null;
    if (!version) return null;

    const description = typeof data.description === 'string' ? data.description : undefined;
    const maintainers = Array.isArray(data.maintainers) ? data.maintainers : [];
    const authorName = parseMaintainer(maintainers[0]);

    return {
      name,
      description,
      version,
      publisher: authorName ? { username: authorName } : undefined,
    };
  } catch {
    return null;
  }
};

/**
 * Known official plugin slugs for the @opentabs-dev scope.
 *
 * When a search is performed with no query, these slugs are probed directly on
 * the npm registry so that private @opentabs-dev packages — which `npm search`
 * excludes from keyword results — are still discoverable.
 */
const KNOWN_OFFICIAL_PLUGIN_SLUGS = ['slack'] as const;

/**
 * Build a list of candidate package names to probe directly on the npm registry.
 *
 * When a query is provided (e.g., "slack"), generates the official and community
 * package names to check via direct registry lookup. This catches private/scoped
 * packages that `npm search` excludes from keyword-based results.
 *
 * When no query is provided, probes all known official plugin package names so
 * that private @opentabs-dev packages are included in no-query searches.
 */
const buildDirectLookupCandidates = (query?: string): string[] => {
  if (!query) {
    return KNOWN_OFFICIAL_PLUGIN_SLUGS.map(slug => `${OFFICIAL_SCOPE}/${PLUGIN_PREFIX}${slug}`);
  }
  // If the query is already a fully qualified name, probe it directly
  if (query.startsWith('@') || query.startsWith(PLUGIN_PREFIX)) return [query];
  return [`${OFFICIAL_SCOPE}/${PLUGIN_PREFIX}${query}`, `${PLUGIN_PREFIX}${query}`];
};

/** npm search --json result shape */
interface NpmSearchJsonEntry {
  name: string;
  description?: string;
  version: string;
  author?: { name?: string; username?: string };
  publisher?: { username?: string };
}

/**
 * Search for opentabs plugins via `npm search`.
 * Delegates auth to npm itself.
 */
const npmSearchPlugins = (query?: string): NpmSearchPackage[] => {
  const searchTerm = query ? `keywords:opentabs-plugin ${query}` : 'keywords:opentabs-plugin';
  const result = spawnProcessSync('npm', ['search', searchTerm, '--json']);
  if (result.exitCode !== 0) return [];

  try {
    const entries = JSON.parse(result.stdout.trim()) as NpmSearchJsonEntry[];
    return entries.map(entry => ({
      name: entry.name,
      description: entry.description,
      version: entry.version,
      publisher: entry.publisher?.username
        ? { username: entry.publisher.username }
        : entry.author?.name
          ? { username: entry.author.name }
          : undefined,
    }));
  } catch {
    return [];
  }
};

const handlePluginSearch = (query?: string): void => {
  // Run npm keyword search
  const searchResults = npmSearchPlugins(query);

  // Also probe direct candidates for private packages not in keyword search
  const directCandidates = buildDirectLookupCandidates(query);
  const directResults = directCandidates.map(candidate => fetchPackageInfo(candidate));

  // Collect results from keyword search
  const results: NpmSearchPackage[] = [];
  const seenNames = new Set<string>();

  for (const pkg of searchResults) {
    if (!seenNames.has(pkg.name)) {
      seenNames.add(pkg.name);
      results.push(pkg);
    }
  }

  // Merge in direct lookup results (private packages not in keyword search)
  for (const info of directResults) {
    if (info && !seenNames.has(info.name)) {
      seenNames.add(info.name);
      results.push(info);
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
  // Line format: "  [label] name vVersion — desc by author"
  const maxLabelLen = 11; // "[community]" is the longest label
  const overheadPerPkg = results.map(pkg => {
    const author = pkg.publisher?.username ?? 'unknown';
    // 2 indent + label + 1 space + name + 1 space + "v" + version + " — " + " by " + author
    return 2 + maxLabelLen + 1 + pkg.name.length + 1 + 1 + pkg.version.length + 3 + 4 + author.length;
  });
  const maxOverhead = Math.max(...overheadPerPkg);
  const descWidth = Math.max(30, termWidth - maxOverhead);

  console.log();
  for (const pkg of results) {
    const label = pkg.name.startsWith(`${OFFICIAL_SCOPE}/`) ? pc.blue('[official]') : pc.dim('[community]');
    const desc = pkg.description
      ? pkg.description.length > descWidth
        ? pkg.description.slice(0, descWidth - 3) + '...'
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
 */
const scanNpmPlugins = async (): Promise<ListPluginEntry[]> => {
  const entries: ListPluginEntry[] = [];
  try {
    const result = await spawnProcessAsync(platformExec('npm'), ['list', '-g', '--json', '--depth=0']);
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
  const secret = await readAuthSecret();

  // Try to fetch from running server first
  try {
    const headers: Record<string, string> = {};
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    const res = await fetch(`http://localhost:${port}/health`, {
      headers,
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
    if (options.verbose && p.toolNames && p.toolNames.length > 0) {
      console.log(`      ${pc.dim(p.toolNames.join(', '))}`);
    }
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
    .action((query?: string) => {
      handlePluginSearch(query);
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
  registerPluginCommand,
  resolvePackageName,
  warnIfNotPlugin,
  removeFromLocalPlugins,
  buildDirectLookupCandidates,
  parseMaintainer,
  KNOWN_OFFICIAL_PLUGIN_SLUGS,
};
