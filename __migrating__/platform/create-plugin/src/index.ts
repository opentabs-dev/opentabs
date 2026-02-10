// =============================================================================
// create-opentabs-plugin — Plugin Scaffolding CLI
//
// Generates a new OpenTabs plugin from the template directory. Replaces
// template variables ({{pluginName}}, {{displayName}}, etc.) with user-provided
// values.
//
// Usage:
//   bunx create-opentabs-plugin my-service
//   bunx create-opentabs-plugin my-service --domain app.example.com --display "My Service"
//
// Or programmatically:
//   import { scaffoldPlugin } from 'create-opentabs-plugin';
//   await scaffoldPlugin({ pluginName: 'jira', domain: 'atlassian.net', ... });
// =============================================================================

import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Configuration for scaffolding a new plugin. All fields except pluginName
 * have sensible defaults derived from pluginName.
 */
interface ScaffoldOptions {
  /** Plugin name — lowercase alphanumeric with hyphens (e.g. 'jira', 'google-sheets'). */
  readonly pluginName: string;

  /** Human-readable display name (e.g. 'Jira', 'Google Sheets'). Default: title-cased pluginName. */
  readonly displayName?: string;

  /** Short description. Default: generic description using displayName. */
  readonly description?: string;

  /** Primary domain the plugin targets (e.g. 'app.example.com'). Default: 'app.example.com'. */
  readonly domain?: string;

  /** Author name or organization. Default: empty string. */
  readonly author?: string;

  /** Output directory. Default: `./opentabs-plugin-{pluginName}` relative to cwd. */
  readonly outputDir?: string;
}

/** Result of scaffolding a plugin. */
interface ScaffoldResult {
  /** Absolute path to the generated plugin directory. */
  readonly outputDir: string;

  /** List of generated file paths (relative to outputDir). */
  readonly files: readonly string[];

  /** The resolved template variables. */
  readonly variables: Readonly<Record<string, string>>;
}

// -----------------------------------------------------------------------------
// Template Variable Resolution
// -----------------------------------------------------------------------------

/**
 * Convert a plugin name to a display name by title-casing each segment.
 * 'google-sheets' → 'Google Sheets', 'jira' → 'Jira'
 */
const toDisplayName = (pluginName: string): string =>
  pluginName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Build the complete template variable map from scaffold options.
 */
const resolveVariables = (options: ScaffoldOptions): Record<string, string> => {
  const pluginName = options.pluginName;
  const displayName = options.displayName ?? toDisplayName(pluginName);
  const description = options.description ?? `OpenTabs plugin for ${displayName}`;
  const domain = options.domain ?? 'app.example.com';
  const author = options.author ?? '';

  return {
    pluginName,
    displayName,
    description,
    domain,
    author,
  };
};

/**
 * Replace all {{variable}} placeholders in a string with their values.
 */
const replaceVariables = (content: string, variables: Record<string, string>): string => {
  let result = content;
  for (const [key, value] of Object.entries(variables)) {
    // Replace all occurrences of {{key}} with value
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
};

// -----------------------------------------------------------------------------
// File System Helpers
// -----------------------------------------------------------------------------

/**
 * Recursively list all files in a directory, returning paths relative to the root.
 */
const listFilesRecursive = async (dir: string, rootDir: string): Promise<string[]> => {
  const files: string[] = [];
  const entries = await readdir(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relativePath = fullPath.slice(rootDir.length + 1);
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      const nested = await listFilesRecursive(fullPath, rootDir);
      files.push(...nested);
    } else {
      files.push(relativePath);
    }
  }

  return files;
};

// -----------------------------------------------------------------------------
// Scaffolding
// -----------------------------------------------------------------------------

/**
 * Get the path to the template directory.
 * Handles both development (running from source) and installed (running from dist) contexts.
 */
const getTemplateDir = (): string => {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);

  // When running from src/index.ts, template is at ../template
  // When running from dist/index.js, template is at ../template
  return resolve(thisDir, '..', 'template');
};

/**
 * Scaffold a new OpenTabs plugin from the template.
 *
 * Copies all template files to the output directory, replacing template
 * variables ({{pluginName}}, {{displayName}}, etc.) in file contents.
 *
 * @param options - Plugin configuration
 * @returns The scaffold result with output path and generated files
 *
 * @example
 * ```ts
 * const result = await scaffoldPlugin({
 *   pluginName: 'jira',
 *   domain: '.atlassian.net',
 *   displayName: 'Jira',
 *   description: 'Manage Jira issues from AI agents',
 * });
 * console.log(`Plugin created at ${result.outputDir}`);
 * ```
 */
const scaffoldPlugin = async (options: ScaffoldOptions): Promise<ScaffoldResult> => {
  // Validate plugin name
  if (!/^[a-z][a-z0-9-]*$/.test(options.pluginName)) {
    throw new Error(
      `Invalid plugin name "${options.pluginName}". ` +
        'Must be lowercase alphanumeric with hyphens, starting with a letter (e.g. "jira", "google-sheets").',
    );
  }

  const RESERVED = ['browser', 'system', 'extension', 'plugin', 'opentabs'];
  if (RESERVED.includes(options.pluginName)) {
    throw new Error(
      `Plugin name "${options.pluginName}" is reserved by the platform. ` +
        `Choose a different name. Reserved: ${RESERVED.join(', ')}`,
    );
  }

  const variables = resolveVariables(options);
  const templateDir = getTemplateDir();
  const outputDir = options.outputDir
    ? resolve(options.outputDir)
    : resolve(process.cwd(), `opentabs-plugin-${options.pluginName}`);

  // List all template files
  const templateFiles = await listFilesRecursive(templateDir, templateDir);

  const generatedFiles: string[] = [];

  for (const relativePath of templateFiles) {
    const sourcePath = join(templateDir, relativePath);
    const destPath = join(outputDir, relativePath);

    // Ensure parent directory exists
    await mkdir(dirname(destPath), { recursive: true });

    // Read template content
    const content = await readFile(sourcePath, 'utf-8');

    // Replace variables in content
    const processed = replaceVariables(content, variables);

    // Write to output
    await writeFile(destPath, processed, 'utf-8');
    generatedFiles.push(relativePath);
  }

  return {
    outputDir,
    files: generatedFiles,
    variables,
  };
};

// -----------------------------------------------------------------------------
// CLI Entry Point
// -----------------------------------------------------------------------------

const printUsage = (): void => {
  console.log(`
Usage: create-opentabs-plugin <plugin-name> [options]

Create a new OpenTabs plugin from the official template.

Arguments:
  plugin-name          Plugin identifier (lowercase, hyphens ok: "jira", "google-sheets")

Options:
  --domain <domain>    Target domain (e.g. "app.example.com", ".atlassian.net")
  --display <name>     Human-readable display name (e.g. "Google Sheets")
  --description <desc> Short plugin description
  --author <name>      Author name or organization
  --output <dir>       Output directory (default: ./opentabs-plugin-<name>)
  --help               Show this help message

Examples:
  create-opentabs-plugin jira --domain .atlassian.net
  create-opentabs-plugin google-sheets --domain docs.google.com --display "Google Sheets"
  create-opentabs-plugin internal-dashboard --domain dashboard.internal.company.com --author "My Team"
`);
};

const parseArgs = (args: string[]): ScaffoldOptions | null => {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return null;
  }

  const pluginName = args[0];
  if (!pluginName || pluginName.startsWith('-')) {
    console.error('Error: plugin-name is required as the first argument.\n');
    printUsage();
    return null;
  }

  const options: Record<string, string | undefined> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--domain':
        options.domain = next;
        i++;
        break;
      case '--display':
        options.displayName = next;
        i++;
        break;
      case '--description':
        options.description = next;
        i++;
        break;
      case '--author':
        options.author = next;
        i++;
        break;
      case '--output':
        options.outputDir = next;
        i++;
        break;
      default:
        console.error(`Unknown option: ${arg}\n`);
        printUsage();
        return null;
    }
  }

  return {
    pluginName,
    domain: options.domain,
    displayName: options.displayName,
    description: options.description,
    author: options.author,
    outputDir: options.outputDir,
  };
};

/**
 * CLI entry point. Called when running `bunx create-opentabs-plugin`.
 */
const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (!options) {
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  try {
    console.log(`\nCreating OpenTabs plugin "${options.pluginName}"...\n`);

    const result = await scaffoldPlugin(options);

    console.log(`Plugin created at ${result.outputDir}\n`);
    console.log('Generated files:');
    for (const file of result.files) {
      console.log(`  ${file}`);
    }

    console.log('\nNext steps:');
    console.log(`  cd ${result.outputDir}`);
    console.log('  bun install');
    console.log('  # Edit src/adapter.ts to implement auth extraction');
    console.log('  # Edit opentabs-plugin.json to set the correct domain');
    console.log('  # Add tool definitions in src/tools/');
    console.log('  bun run build');
    console.log('');
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
};

// Auto-run CLI when executed directly
const isDirectExecution =
  process.argv[1] && (process.argv[1].includes('create-opentabs-plugin') || process.argv[1].includes('create-plugin'));

if (isDirectExecution) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

// -----------------------------------------------------------------------------
// Exports — All exports at the end per import-x/exports-last
// -----------------------------------------------------------------------------

export type { ScaffoldOptions, ScaffoldResult };

export { scaffoldPlugin, main };
