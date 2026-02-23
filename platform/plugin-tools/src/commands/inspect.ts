/**
 * `opentabs-plugin inspect` command — pretty-prints the built plugin manifest.
 * Reads dist/tools.json and package.json from the current directory and displays
 * a human-readable summary of tools, resources, and prompts.
 */

import { parsePluginPackageJson } from '@opentabs-dev/shared';
import pc from 'picocolors';
import { join } from 'node:path';
import type { ManifestPrompt, ManifestResource, ManifestTool } from '@opentabs-dev/shared';
import type { Command } from 'commander';

/** Shape of dist/tools.json as written by `opentabs-plugin build` */
interface ToolsJsonManifest {
  sdkVersion?: string;
  tools: ManifestTool[];
  resources?: ManifestResource[];
  prompts?: ManifestPrompt[];
}

/** Extract field names and types from a JSON Schema object */
const extractFields = (schema: Record<string, unknown>): Array<{ name: string; type: string; required: boolean }> => {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return [];

  const requiredSet = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);

  return Object.entries(properties).map(([name, prop]) => {
    let type = 'unknown';
    if (typeof prop.type === 'string') {
      type = prop.type;
    } else if (Array.isArray(prop.anyOf)) {
      const types = (prop.anyOf as Array<Record<string, unknown>>)
        .map(t => (typeof t.type === 'string' ? t.type : '?'))
        .join(' | ');
      type = types;
    }
    return { name, type, required: requiredSet.has(name) };
  });
};

/** Truncate a string to maxLen, appending "..." if truncated */
const truncate = (s: string, maxLen: number): string => (s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s);

const handleInspect = async (options: { json?: boolean }, projectDir: string = process.cwd()): Promise<void> => {
  // Read dist/tools.json
  const toolsJsonPath = join(projectDir, 'dist', 'tools.json');
  const toolsJsonFile = Bun.file(toolsJsonPath);
  if (!(await toolsJsonFile.exists())) {
    console.error(pc.red('No manifest found. Run opentabs-plugin build first.'));
    process.exit(1);
  }

  let manifest: ToolsJsonManifest;
  try {
    const parsed: unknown = JSON.parse(await toolsJsonFile.text());
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    const obj = parsed as Record<string, unknown>;

    if (Array.isArray(obj.tools)) {
      manifest = obj as unknown as ToolsJsonManifest;
    } else {
      throw new Error('unexpected format');
    }
  } catch {
    console.error(
      pc.red('Failed to parse dist/tools.json. The file may be corrupted — rebuild with opentabs-plugin build.'),
    );
    process.exit(1);
  }

  // --json mode: output raw JSON and exit
  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  // Read package.json for plugin metadata
  let pluginName = '(unknown)';
  let pluginVersion = '(unknown)';
  let displayName: string | undefined;
  const pkgJsonFile = Bun.file(join(projectDir, 'package.json'));
  if (await pkgJsonFile.exists()) {
    try {
      const pkgJsonRaw: unknown = JSON.parse(await pkgJsonFile.text());
      const result = parsePluginPackageJson(pkgJsonRaw, projectDir);
      if (result.ok) {
        pluginName = result.value.name;
        pluginVersion = result.value.version;
        displayName = result.value.opentabs.displayName;
      }
    } catch {
      // Non-fatal — we can still show the manifest
    }
  }

  const tools = manifest.tools;
  const resources = manifest.resources ?? [];
  const prompts = manifest.prompts ?? [];

  // Header
  console.log('');
  console.log(pc.bold(displayName ?? pluginName) + pc.dim(` v${pluginVersion}`));
  if (manifest.sdkVersion) {
    console.log(pc.dim(`SDK version: ${manifest.sdkVersion}`));
  }

  // Summary counts
  const parts: string[] = [];
  parts.push(`${tools.length} tool${tools.length === 1 ? '' : 's'}`);
  parts.push(`${resources.length} resource${resources.length === 1 ? '' : 's'}`);
  parts.push(`${prompts.length} prompt${prompts.length === 1 ? '' : 's'}`);
  console.log(pc.dim(parts.join(' · ')));
  console.log('');

  // Tools
  if (tools.length > 0) {
    console.log(pc.bold('Tools'));
    console.log('');
    for (const tool of tools) {
      console.log(`  ${pc.cyan(tool.icon)} ${pc.bold(tool.name)}  ${pc.dim(tool.displayName)}`);
      console.log(`    ${truncate(tool.description, 80)}`);

      const inputFields = extractFields(tool.input_schema);
      if (inputFields.length > 0) {
        const fieldStrs = inputFields.map(f => `${f.name}: ${f.type}${f.required ? '' : '?'}`);
        console.log(`    ${pc.dim('Input:')}  ${fieldStrs.join(', ')}`);
      }

      const outputFields = extractFields(tool.output_schema);
      if (outputFields.length > 0) {
        const fieldStrs = outputFields.map(f => `${f.name}: ${f.type}${f.required ? '' : '?'}`);
        console.log(`    ${pc.dim('Output:')} ${fieldStrs.join(', ')}`);
      }
      console.log('');
    }
  }

  // Resources
  if (resources.length > 0) {
    console.log(pc.bold('Resources'));
    console.log('');
    for (const resource of resources) {
      console.log(`  ${pc.cyan(resource.uri)}  ${pc.bold(resource.name)}`);
      if (resource.description) {
        console.log(`    ${resource.description}`);
      }
      if (resource.mimeType) {
        console.log(`    ${pc.dim(`MIME: ${resource.mimeType}`)}`);
      }
      console.log('');
    }
  }

  // Prompts
  if (prompts.length > 0) {
    console.log(pc.bold('Prompts'));
    console.log('');
    for (const prompt of prompts) {
      console.log(`  ${pc.bold(prompt.name)}`);
      if (prompt.description) {
        console.log(`    ${prompt.description}`);
      }
      if (prompt.arguments && prompt.arguments.length > 0) {
        const argStrs = prompt.arguments.map(
          a => `${a.name}${a.required ? '' : '?'}${a.description ? ` — ${a.description}` : ''}`,
        );
        console.log(`    ${pc.dim('Args:')} ${argStrs.join(', ')}`);
      }
      console.log('');
    }
  }
};

const registerInspectCommand = (program: Command): void => {
  program
    .command('inspect')
    .description('Pretty-print the built plugin manifest (dist/tools.json)')
    .option('--json', 'Output raw JSON instead of formatted summary')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs-plugin inspect
  $ opentabs-plugin inspect --json`,
    )
    .action((options: { json?: boolean }) => handleInspect(options));
};

export { extractFields, handleInspect, registerInspectCommand, truncate };
export type { ToolsJsonManifest };
