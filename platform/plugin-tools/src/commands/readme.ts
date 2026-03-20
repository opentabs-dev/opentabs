/**
 * `opentabs-plugin readme` command — generates a user-facing README.md from
 * dist/tools.json and package.json metadata, following the Phase 6 format
 * from the build-plugin skill.
 */

import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConfigSchema, ManifestTool } from '@opentabs-dev/shared';
import { parsePluginPackageJson, TOOLS_FILENAME } from '@opentabs-dev/shared';
import type { Command } from 'commander';
import pc from 'picocolors';

/** Prefixes that indicate a read-only tool */
const READ_PREFIXES = ['list_', 'get_', 'search_', 'read_', 'query_', 'browse_', 'find_', 'check_'];

/** Classify a tool as Read or Write based on its name */
const classifyTool = (name: string): 'Read' | 'Write' =>
  READ_PREFIXES.some(p => name.startsWith(p)) ? 'Read' : 'Write';

/**
 * Extract the primary domain from a Chrome match pattern.
 * E.g., `*://*.slack.com/*` → `slack.com`, `*://discord.com/*` → `discord.com`
 */
const extractDomain = (pattern: string): string => {
  const withoutScheme = pattern.replace(/^(?:\*|https?):\/\//, '');
  const withoutPath = withoutScheme.replace(/\/.*$/, '');
  return withoutPath.replace(/^\*\./, '');
};

/**
 * Extract the short plugin name from a package name.
 * `@opentabs-dev/opentabs-plugin-slack` → `slack`
 * `opentabs-plugin-discord` → `discord`
 */
const extractShortName = (packageName: string): string => {
  const withoutScope = packageName.replace(/^@[^/]+\//, '');
  return withoutScope.replace(/^opentabs-plugin-/, '');
};

interface ToolGroup {
  name: string;
  tools: Array<{ name: string; summary: string; type: 'Read' | 'Write' }>;
}

/** Group tools by their `group` field, preserving first-appearance order */
const groupTools = (tools: ManifestTool[]): ToolGroup[] => {
  const groups = new Map<string, ToolGroup>();
  for (const tool of tools) {
    const groupName = tool.group ?? 'General';
    let group = groups.get(groupName);
    if (!group) {
      group = { name: groupName, tools: [] };
      groups.set(groupName, group);
    }
    group.tools.push({
      name: tool.name,
      summary: tool.summary ?? tool.description,
      type: classifyTool(tool.name),
    });
  }
  return [...groups.values()];
};

interface PluginMeta {
  packageName: string;
  displayName: string;
  description: string;
  domain?: string;
  homepage?: string;
  shortName: string;
}

/** Generate the README markdown string */
const generateReadme = (meta: PluginMeta, tools: ManifestTool[], configSchema?: ConfigSchema): string => {
  const groups = groupTools(tools);
  const totalCount = tools.length;

  const lines: string[] = [];

  // Title
  lines.push(`# ${meta.displayName}`);
  lines.push('');
  lines.push(
    `${meta.description} — gives AI agents access to ${meta.displayName} through your authenticated browser session.`,
  );
  lines.push('');

  // Install
  lines.push('## Install');
  lines.push('');
  lines.push('```bash');
  lines.push(`opentabs plugin install ${meta.shortName}`);
  lines.push('```');
  lines.push('');
  lines.push('Or install globally via npm:');
  lines.push('');
  lines.push('```bash');
  lines.push(`npm install -g ${meta.packageName}`);
  lines.push('```');
  lines.push('');

  // Setup
  lines.push('## Setup');
  lines.push('');
  if (meta.domain && meta.homepage) {
    lines.push(`1. Open [${meta.domain}](${meta.homepage}) in Chrome and log in`);
    lines.push(`2. Open the OpenTabs side panel — the ${meta.displayName} plugin should appear as **ready**`);
  } else {
    lines.push(`1. Configure the plugin with \`opentabs plugin configure ${meta.shortName}\``);
    lines.push('2. Open your configured URL in Chrome and log in');
    lines.push(`3. Open the OpenTabs side panel — the ${meta.displayName} plugin should appear as **ready**`);
  }
  lines.push('');

  // Configuration
  if (configSchema && Object.keys(configSchema).length > 0) {
    lines.push('## Configuration');
    lines.push('');
    lines.push(`Configure settings via \`opentabs plugin configure ${meta.shortName}\` or the side panel.`);
    lines.push('');
    lines.push('| Setting | Type | Required | Description |');
    lines.push('|---|---|---|---|');
    for (const [key, def] of Object.entries(configSchema)) {
      const required = def.required ? 'Yes' : 'No';
      const desc = def.description ?? def.label;
      lines.push(`| \`${key}\` | ${def.type} | ${required} | ${desc} |`);
    }
    lines.push('');
  }

  // Tools
  lines.push(`## Tools (${totalCount})`);
  lines.push('');
  for (const group of groups) {
    lines.push(`### ${group.name} (${group.tools.length})`);
    lines.push('');
    lines.push('| Tool | Description | Type |');
    lines.push('|---|---|---|');
    for (const tool of group.tools) {
      lines.push(`| \`${tool.name}\` | ${tool.summary} | ${tool.type} |`);
    }
    lines.push('');
  }

  // How It Works
  lines.push('## How It Works');
  lines.push('');
  lines.push(
    `This plugin runs inside your ${meta.displayName} tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.`,
  );
  lines.push('');

  // License
  lines.push('## License');
  lines.push('');
  lines.push('MIT');
  lines.push('');

  return lines.join('\n');
};

interface ReadmeOptions {
  dryRun?: boolean;
  check?: boolean;
}

const handleReadme = async (options: ReadmeOptions, projectDir: string = process.cwd()): Promise<void> => {
  // Read dist/tools.json
  const toolsJsonPath = join(projectDir, 'dist', TOOLS_FILENAME);
  if (
    !(await access(toolsJsonPath).then(
      () => true,
      () => false,
    ))
  ) {
    console.error(pc.red('No manifest found. Run opentabs-plugin build first.'));
    process.exit(1);
  }

  let tools: ManifestTool[];
  let configSchema: ConfigSchema | undefined;
  try {
    const parsed: unknown = JSON.parse(await readFile(toolsJsonPath, 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.tools)) throw new Error('no tools array');
    tools = obj.tools as ManifestTool[];
    configSchema = (obj.configSchema ?? undefined) as ConfigSchema | undefined;
  } catch {
    console.error(pc.red(`Failed to parse dist/${TOOLS_FILENAME}. Rebuild with opentabs-plugin build.`));
    process.exit(1);
  }

  // Read package.json
  const pkgJsonPath = join(projectDir, 'package.json');
  if (
    !(await access(pkgJsonPath).then(
      () => true,
      () => false,
    ))
  ) {
    console.error(pc.red('No package.json found.'));
    process.exit(1);
  }

  const pkgJsonRaw: unknown = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
  const result = parsePluginPackageJson(pkgJsonRaw, projectDir);
  if (!result.ok) {
    console.error(pc.red(`Invalid package.json: ${result.error}`));
    process.exit(1);
  }

  const pkg = result.value;
  const firstPattern = pkg.opentabs.urlPatterns[0];
  if (!firstPattern && !pkg.opentabs.configSchema) {
    console.error(pc.red('No urlPatterns defined in package.json opentabs field.'));
    process.exit(1);
  }
  const domain = firstPattern ? extractDomain(firstPattern) : undefined;
  const meta: PluginMeta = {
    packageName: pkg.name,
    displayName: pkg.opentabs.displayName,
    description: pkg.opentabs.description,
    domain,
    homepage: domain ? (pkg.opentabs.homepage ?? `https://${domain}`) : undefined,
    shortName: extractShortName(pkg.name),
  };

  const readme = generateReadme(meta, tools, configSchema);

  if (options.dryRun) {
    process.stdout.write(readme);
    return;
  }

  if (options.check) {
    const readmePath = join(projectDir, 'README.md');
    let existing = '';
    try {
      existing = await readFile(readmePath, 'utf-8');
    } catch {
      // No existing README — differs by definition
    }
    if (existing !== readme) {
      console.error(pc.red('README.md is out of date. Run opentabs-plugin readme to regenerate.'));
      process.exit(1);
    }
    console.log(pc.green('README.md is up to date.'));
    return;
  }

  const readmePath = join(projectDir, 'README.md');
  await writeFile(readmePath, readme, 'utf-8');
  console.log(pc.green(`README.md generated (${tools.length} tools)`));
};

const registerReadmeCommand = (program: Command): void => {
  program
    .command('readme')
    .description('Generate a user-facing README.md from dist/tools.json and package.json')
    .option('--dry-run', 'Print to stdout instead of writing README.md')
    .option('--check', 'Exit 1 if existing README.md differs from generated')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs-plugin readme
  $ opentabs-plugin readme --dry-run
  $ opentabs-plugin readme --check`,
    )
    .action((options: ReadmeOptions) => handleReadme(options));
};

export {
  classifyTool,
  extractDomain,
  extractShortName,
  generateReadme,
  groupTools,
  handleReadme,
  registerReadmeCommand,
};
export type { PluginMeta, ReadmeOptions, ToolGroup };
