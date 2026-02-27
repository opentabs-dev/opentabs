/**
 * Publish platform packages to npm (private) and update plugins.
 *
 * Platform packages published (in dependency order):
 *   @opentabs-dev/shared, @opentabs-dev/browser-extension, @opentabs-dev/mcp-server,
 *   @opentabs-dev/plugin-sdk, @opentabs-dev/plugin-tools, @opentabs-dev/cli,
 *   @opentabs-dev/create-plugin.
 *
 * After publishing, plugins under plugins/ have their @opentabs-dev/* dependency
 * versions updated to ^<version>, then are reinstalled and rebuilt. Plugin
 * versions are NOT bumped — they have their own independent release lifecycle.
 *
 * Requires:
 *   - ~/.npmrc with a token that has read+write access to @opentabs-dev packages.
 *
 * Setup (one-time):
 *   1. Create a granular access token at https://www.npmjs.com/settings/tokens/create
 *      - Permissions: Read and Write, Packages: @opentabs-dev/*, Bypass 2FA enabled
 *   2. Save it: echo '//registry.npmjs.org/:_authToken=<TOKEN>' > ~/.npmrc
 *
 * Usage:
 *   tsx scripts/publish.ts <version>
 *   tsx scripts/publish.ts 0.0.3
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PackageJson {
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Run a command synchronously with inherited stdio. Throws on non-zero exit. */
const run = (cmd: string[], cwd: string = ROOT): void => {
  const [bin = '', ...args] = cmd;
  const result = spawnSync(bin, args, { cwd, stdio: ['inherit', 'inherit', 'inherit'] });
  if ((result.status ?? 0) !== 0) {
    throw new Error(`Command failed (exit ${result.status ?? 0}): ${cmd.join(' ')}`);
  }
};

/** Run a command and capture stdout. Throws on non-zero exit. */
const capture = (cmd: string[], cwd: string = ROOT): string => {
  const [bin = '', ...args] = cmd;
  const result = spawnSync(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  if ((result.status ?? 0) !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Command failed (exit ${result.status ?? 0}): ${cmd.join(' ')}\n${stderr}`);
  }
  return result.stdout.toString().trim();
};

/** Read and parse a package.json file. */
const readPackageJson = async (pkgDir: string): Promise<PackageJson> => {
  const filePath = resolve(ROOT, pkgDir, 'package.json');
  return JSON.parse(await readFile(filePath, 'utf-8')) as PackageJson;
};

/** Write a package.json file with standard formatting (2-space indent, trailing newline). */
const writePackageJson = async (pkgDir: string, data: PackageJson): Promise<void> => {
  const filePath = resolve(ROOT, pkgDir, 'package.json');
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n');
};

// ---------------------------------------------------------------------------
// Packages in dependency order
// ---------------------------------------------------------------------------

const PACKAGES = [
  'platform/shared',
  'platform/browser-extension',
  'platform/mcp-server',
  'platform/plugin-sdk',
  'platform/plugin-tools',
  'platform/cli',
  'platform/create-plugin',
] as const;

/** @opentabs-dev dependency names that plugins reference. */
const OPENTABS_DEP_NAMES = ['@opentabs-dev/plugin-sdk', '@opentabs-dev/plugin-tools'] as const;

/**
 * Auto-discover plugin directories under plugins/.
 * A directory is a plugin if it contains a package.json.
 */
const discoverPlugins = (): string[] => {
  const pluginsDir = resolve(ROOT, 'plugins');
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => `plugins/${d.name}`)
    .filter(dir => existsSync(resolve(ROOT, dir, 'package.json')));
};

// ---------------------------------------------------------------------------
// Conventional commit grouping
// ---------------------------------------------------------------------------

interface CommitGroups {
  [key: string]: string[];
  feat: string[];
  fix: string[];
  perf: string[];
  refactor: string[];
  build: string[];
  ci: string[];
  test: string[];
  docs: string[];
  style: string[];
  chore: string[];
  other: string[];
  ungrouped: string[];
}

const GROUP_LABELS: Record<string, string> = {
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  refactor: 'Refactoring',
  build: 'Build',
  ci: 'CI',
  test: 'Tests',
  docs: 'Documentation',
  style: 'Style',
  chore: 'Chores',
  other: 'Other',
};

const COMMIT_RE = /^([a-z]+)(?:\(.+\))?:\s+(.+)$/;

const groupCommits = (subjects: string[]): CommitGroups => {
  const groups: CommitGroups = {
    feat: [],
    fix: [],
    perf: [],
    refactor: [],
    build: [],
    ci: [],
    test: [],
    docs: [],
    style: [],
    chore: [],
    other: [],
    ungrouped: [],
  };

  for (const subject of subjects) {
    const match = subject.match(COMMIT_RE);
    if (!match) {
      groups.ungrouped.push(subject);
      continue;
    }

    const type = match[1];
    const msg = match[2];
    if (!type || !msg) continue;

    if (type === 'release') continue;

    const bucket = groups[type];
    if (bucket) {
      bucket.push(msg);
    } else {
      groups.other.push(msg);
    }
  }

  return groups;
};

const buildChangelog = (version: string, groups: CommitGroups): string => {
  let entry = `## v${version}\n\n`;
  let hasGroups = false;

  const orderedKeys = ['feat', 'fix', 'perf', 'refactor', 'build', 'ci', 'test', 'docs', 'style', 'chore', 'other'];

  for (const key of orderedKeys) {
    const items = groups[key];
    if (items && items.length > 0) {
      hasGroups = true;
      const label = GROUP_LABELS[key] ?? key;
      entry += `### ${label}\n\n`;
      for (const item of items) {
        entry += `- ${item}\n`;
      }
      entry += '\n';
    }
  }

  if (groups.ungrouped.length > 0) {
    if (hasGroups) {
      entry += '### Other\n\n';
    }
    for (const item of groups.ungrouped) {
      entry += `- ${item}\n`;
    }
    entry += '\n';
  }

  return entry;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: tsx scripts/publish.ts <version>');
    console.error('Example: tsx scripts/publish.ts 0.0.3');
    process.exit(1);
  }

  // Check for uncommitted changes
  const status = capture(['git', 'status', '--porcelain']);
  if (status.length > 0) {
    console.log('Warning: git working directory has uncommitted changes.');
    process.stdout.write('Continue anyway? [y/N] ');
    const answer = await new Promise<string>(resolve => {
      process.stdin.once('data', data => {
        resolve(data.toString().trim());
      });
    });
    if (answer.toLowerCase() !== 'y') {
      process.exit(1);
    }
  }

  // 1. Verify npm authentication
  console.log('==> Verifying npm authentication...');
  let npmUser: string;
  try {
    npmUser = capture(['npm', 'whoami']);
  } catch {
    console.error('Error: npm authentication failed.');
    console.error('');
    console.error('Ensure ~/.npmrc has a valid token with read+write access.');
    console.error("Run 'npm login --scope=@opentabs-dev' or add a granular token to ~/.npmrc.");
    process.exit(1);
  }
  console.log(`  Authenticated as: ${npmUser}`);

  // 2. Bump versions
  console.log('');
  console.log(`==> Bumping versions to ${version}...`);
  for (const pkg of PACKAGES) {
    const data = await readPackageJson(pkg);
    data.version = version;
    await writePackageJson(pkg, data);
    console.log(`  ${pkg}/package.json → ${version}`);
  }

  // 3. Delete lockfile and reinstall so npm picks up the bumped workspace versions.
  //    Without this, `npm publish` resolves workspace:* to the old lockfile versions.
  console.log('');
  console.log('==> Syncing lockfile and rebuilding with new versions...');
  const lockPath = resolve(ROOT, 'package-lock.json');
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
  run(['npm', 'install']);
  run(['npm', 'run', 'build:force']);

  // 4. Publish packages in dependency order
  console.log('');
  console.log('==> Publishing packages (dependency order)...');
  console.log('');
  for (const pkg of PACKAGES) {
    const shortName = pkg.split('/')[1] ?? pkg;
    const pkgName = `@opentabs-dev/${shortName}`;
    console.log(`  Publishing ${pkgName}@${version}...`);
    run(['npm', 'publish', '--access', 'restricted'], resolve(ROOT, pkg));
  }

  console.log('');
  console.log(`==> Published all packages at v${version}`);

  // 5. Update plugin dependencies and rebuild
  const plugins = discoverPlugins();
  if (plugins.length > 0) {
    console.log('');
    console.log(`==> Updating ${plugins.length} plugin(s) to use @opentabs-dev/*@^${version}...`);
    for (const plugin of plugins) {
      const data = await readPackageJson(plugin);
      for (const depName of OPENTABS_DEP_NAMES) {
        if (data.dependencies?.[depName]) data.dependencies[depName] = `^${version}`;
        if (data.devDependencies?.[depName]) data.devDependencies[depName] = `^${version}`;
      }
      await writePackageJson(plugin, data);
      console.log(`  ${plugin}/package.json — deps → ^${version}`);
    }

    // Wait for npm registry to propagate the new versions before installing.
    console.log('');
    console.log('  Waiting 10s for npm registry propagation...');
    await new Promise(r => setTimeout(r, 10_000));

    console.log('');
    console.log('==> Installing and rebuilding plugins...');
    for (const plugin of plugins) {
      const pluginDir = resolve(ROOT, plugin);
      // Remove lockfile so npm resolves fresh versions from registry
      const pluginLockPath = resolve(pluginDir, 'package-lock.json');
      if (existsSync(pluginLockPath)) {
        unlinkSync(pluginLockPath);
      }
      console.log(`  ${plugin}: npm install...`);
      run(['npm', 'install'], pluginDir);
      console.log(`  ${plugin}: npm run build...`);
      run(['npm', 'run', 'build'], pluginDir);
    }
  }

  // 6. Generate changelog
  console.log('');
  console.log('==> Generating changelog...');

  let prevTag = '';
  try {
    prevTag = capture(['git', 'describe', '--tags', '--abbrev=0']);
  } catch {
    // No previous tag
  }

  const logArgs = ['git', 'log', '--no-merges', '--pretty=format:%s'];
  if (prevTag) {
    logArgs.push(`${prevTag}..HEAD`);
  }

  const commitsRaw = capture(logArgs);
  if (commitsRaw.length === 0) {
    console.log('  No commits found — skipping changelog.');
  } else {
    const subjects = commitsRaw.split('\n').filter(line => line.length > 0);
    const groups = groupCommits(subjects);
    const entry = buildChangelog(version, groups);

    const changelogPath = resolve(ROOT, 'CHANGELOG.md');
    if (existsSync(changelogPath)) {
      const existing = await readFile(changelogPath, 'utf-8');
      await writeFile(changelogPath, entry + existing + '\n');
    } else {
      await writeFile(changelogPath, `# Changelog\n\n${entry}`);
    }

    console.log(`  Generated changelog for v${version}`);
  }

  // 7. Commit and tag
  console.log('');
  console.log('==> Creating release commit and tag...');

  const filesToStage = PACKAGES.map(pkg => `${pkg}/package.json`);
  for (const plugin of plugins) {
    filesToStage.push(`${plugin}/package.json`);
    filesToStage.push(`${plugin}/package-lock.json`);
  }
  const changelogPath = resolve(ROOT, 'CHANGELOG.md');
  if (existsSync(changelogPath)) {
    filesToStage.push('CHANGELOG.md');
  }

  run(['git', 'add', '-f', ...filesToStage]);
  run(['git', 'commit', '-m', `release: v${version}`]);
  run(['git', 'tag', `v${version}`]);

  console.log('');
  console.log(`==> Release v${version} committed and tagged.`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. git push && git push --tags');
};

await main();
