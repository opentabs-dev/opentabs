/**
 * `opentabs build` command — generates the plugin manifest and bundles the adapter IIFE.
 * With `--watch`, rebuilds automatically when tsc output in `dist/` changes.
 */

import { validatePluginName, validateUrlPattern } from '@opentabs-dev/plugin-sdk';
import pc from 'picocolors';
import { z } from 'zod';
import { mkdirSync, watch } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import type { Manifest, ManifestTool, OpenTabsPlugin, ToolDefinition } from '@opentabs-dev/plugin-sdk';
import type { Command } from 'commander';
import type { FSWatcher } from 'node:fs';

const DEBOUNCE_MS = 100;

const validatePlugin = (plugin: OpenTabsPlugin): string[] => {
  const errors: string[] = [];

  // Name
  const nameError = validatePluginName(plugin.name);
  if (nameError) errors.push(nameError);

  // Version — must be valid semver (e.g., "1.0.0", "0.1.0-beta.1")
  if (plugin.version.length === 0) {
    errors.push('Plugin version is required');
  } else if (
    !/^\d+\.\d+\.\d+(-[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)?(\+[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)?$/.test(plugin.version)
  ) {
    errors.push(`Plugin version "${plugin.version}" is not valid semver (expected: MAJOR.MINOR.PATCH)`);
  }

  // Description
  if (plugin.description.length === 0) errors.push('Plugin description is required');

  // URL patterns
  if (plugin.urlPatterns.length === 0) {
    errors.push('At least one URL pattern is required');
  } else {
    for (const pattern of plugin.urlPatterns) {
      const patternError = validateUrlPattern(pattern);
      if (patternError) errors.push(patternError);
    }
  }

  // Tools
  if (plugin.tools.length === 0) {
    errors.push('At least one tool is required');
  } else {
    const TOOL_NAME_REGEX = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
    const toolNames = new Set<string>();
    for (const tool of plugin.tools) {
      if (tool.name.length === 0) {
        errors.push('Tool name is required');
      } else if (!TOOL_NAME_REGEX.test(tool.name)) {
        errors.push(
          `Tool name "${tool.name}" must be snake_case (lowercase alphanumeric with underscores, e.g., "send_message")`,
        );
      }
      if (tool.description.length === 0) errors.push(`Tool "${tool.name || '(unnamed)'}" is missing a description`);
      if (tool.name.length > 0 && toolNames.has(tool.name)) {
        errors.push(`Duplicate tool name "${tool.name}"`);
      }
      if (tool.name.length > 0) toolNames.add(tool.name);
    }
  }

  return errors;
};

const convertToolSchemas = (tool: ToolDefinition) => {
  let inputSchema: Record<string, unknown>;
  try {
    inputSchema = z.toJSONSchema(tool.input) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Tool "${tool.name}" input schema failed to serialize to JSON Schema. ` +
        `Schemas cannot use .transform(), .pipe(), or .preprocess() — these produce runtime-only behavior ` +
        `that cannot be represented in JSON Schema. ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let outputSchema: Record<string, unknown>;
  try {
    outputSchema = z.toJSONSchema(tool.output) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Tool "${tool.name}" output schema failed to serialize to JSON Schema. ` +
        `Schemas cannot use .transform(), .pipe(), or .preprocess() — these produce runtime-only behavior ` +
        `that cannot be represented in JSON Schema. ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  delete inputSchema['$schema'];
  delete outputSchema['$schema'];

  return { inputSchema, outputSchema };
};

const generateManifest = (plugin: OpenTabsPlugin): Manifest => {
  const tools: ManifestTool[] = plugin.tools.map(tool => {
    const { inputSchema, outputSchema } = convertToolSchemas(tool);
    return {
      name: tool.name,
      description: tool.description,
      input_schema: inputSchema,
      output_schema: outputSchema,
    };
  });

  return {
    name: plugin.name,
    version: plugin.version,
    displayName: plugin.displayName ?? plugin.name,
    description: plugin.description,
    url_patterns: plugin.urlPatterns,
    tools,
  };
};

const bundleIIFE = async (sourceEntry: string, outDir: string, pluginName: string): Promise<void> => {
  // Create a temporary wrapper entry that imports the plugin and registers it
  // on window.__openTabs.adapters. This is bundled as an IIFE so the adapter
  // is available when executed in MAIN world.
  const wrapperPath = join(outDir, `_adapter_entry_${Date.now()}.ts`);
  const relativeImport = './' + relative(outDir, sourceEntry).replace(/\.ts$/, '.js');

  const wrapperCode = `import plugin from ${JSON.stringify(relativeImport)};
(globalThis as any).__openTabs = (globalThis as any).__openTabs || {};
(globalThis as any).__openTabs.adapters = (globalThis as any).__openTabs.adapters || {};
const adapters = (globalThis as any).__openTabs.adapters;
const existing = adapters[${JSON.stringify(pluginName)}];
if (existing && typeof existing.teardown === 'function') {
  try { existing.teardown(); } catch (e) { console.warn('[OpenTabs] teardown failed for ' + ${JSON.stringify(pluginName)} + ':', e); }
}
Reflect.deleteProperty(adapters, ${JSON.stringify(pluginName)});
adapters[${JSON.stringify(pluginName)}] = plugin;
`;
  await Bun.write(wrapperPath, wrapperCode);

  try {
    const result = await Bun.build({
      entrypoints: [wrapperPath],
      outdir: outDir,
      format: 'iife',
      target: 'browser',
      minify: false,
      naming: 'adapter.iife.js',
      external: [],
    });

    if (!result.success) {
      const messages = result.logs.map(log => (log.message ? log.message : JSON.stringify(log))).join('\n');
      throw new Error(`IIFE bundling failed:\n${messages}`);
    }
  } finally {
    try {
      await Bun.file(wrapperPath).delete();
    } catch {
      // best-effort cleanup
    }
  }
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatTimestamp = (): string => {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

/**
 * Core build pipeline. Throws on errors instead of calling process.exit,
 * so callers can decide how to handle failures (exit in one-shot mode,
 * continue watching in watch mode).
 */
const runBuild = async (projectDir: string): Promise<void> => {
  const startTime = performance.now();

  // Step 1: Verify plugin project has package.json
  const pkgJsonFile = Bun.file(join(projectDir, 'package.json'));
  if (!(await pkgJsonFile.exists())) {
    throw new Error('No valid package.json found in current directory. Run this command from a plugin directory.');
  }
  try {
    JSON.parse(await pkgJsonFile.text());
  } catch {
    throw new Error('No valid package.json found in current directory. Run this command from a plugin directory.');
  }

  // Determine entry point — look for compiled output in dist/
  const entryPoint = resolve(projectDir, 'dist', 'index.js');
  const sourceEntry = resolve(projectDir, 'src', 'index.ts');

  if (!(await Bun.file(entryPoint).exists())) {
    throw new Error(`Compiled entry point not found at ${entryPoint}. Run tsc first, then retry opentabs build.`);
  }

  // Step 2: Dynamically import the plugin module (cache-bust for watch mode rebuilds)
  console.log(pc.dim('Loading plugin module...'));
  const mod = (await import(`${entryPoint}?t=${String(Date.now())}`)) as { default?: OpenTabsPlugin };
  const defaultExport = mod.default;
  if (!defaultExport) {
    throw new Error('Plugin module must export a default instance of OpenTabsPlugin.');
  }
  const plugin = defaultExport;

  // Step 3: Validate
  console.log(pc.dim('Validating plugin...'));
  const errors = validatePlugin(plugin);
  if (errors.length > 0) {
    throw new Error(`Validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  // Step 4: Bundle IIFE (before manifest, so adapterHash can be included)
  console.log(pc.dim('Bundling adapter IIFE...'));
  const distDir = join(projectDir, 'dist');
  mkdirSync(distDir, { recursive: true });

  await bundleIIFE(sourceEntry, distDir, plugin.name);
  // Read the bundled IIFE and compute its SHA-256 hash. The hash is computed
  // from the core IIFE content (before the __adapterHash setter is appended).
  const iifePath = join(distDir, 'adapter.iife.js');
  const iifeContent = await Bun.file(iifePath).text();
  const adapterHash = new Bun.CryptoHasher('sha256').update(iifeContent).digest('hex');

  // Append a self-contained snippet that sets the adapter hash and then freezes
  // the adapter entry to prevent cross-adapter tampering. The freeze must happen
  // AFTER the hash is set (since frozen objects reject new properties). The
  // property descriptor uses writable:false + configurable:true so that:
  //   - Simple assignment by page scripts fails (non-writable)
  //   - Re-injection via Object.defineProperty succeeds (configurable)
  //   - Extension cleanup via Reflect.deleteProperty succeeds (configurable)
  const hashAndFreeze = `
(function(){var o=(globalThis).__openTabs;if(o&&o.adapters&&o.adapters[${JSON.stringify(plugin.name)}]){var a=o.adapters[${JSON.stringify(plugin.name)}];a.__adapterHash=${JSON.stringify(adapterHash)};if(a.tools&&Array.isArray(a.tools)){for(var i=0;i<a.tools.length;i++){Object.freeze(a.tools[i]);}Object.freeze(a.tools);}Object.freeze(a);Object.defineProperty(o.adapters,${JSON.stringify(plugin.name)},{value:a,writable:false,configurable:true,enumerable:true});}})();
`;
  await Bun.write(iifePath, iifeContent + hashAndFreeze);
  const iifeSize = (await Bun.file(iifePath).stat()).size;
  console.log(`  Written: ${pc.bold('dist/adapter.iife.js')} (${formatBytes(iifeSize)})`);

  // Step 5: Generate manifest (includes adapterHash from the IIFE)
  console.log(pc.dim('Generating manifest...'));
  const manifest = generateManifest(plugin);
  manifest.adapterHash = adapterHash;
  const manifestPath = join(projectDir, 'opentabs-plugin.json');
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `  Written: ${pc.bold('opentabs-plugin.json')} (${manifest.tools.length} tool${manifest.tools.length === 1 ? '' : 's'})`,
  );

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(pc.green(`Build complete for plugin "${plugin.name}" v${plugin.version} in ${elapsed}s`));
};

const handleBuild = async (options: { watch?: boolean }): Promise<void> => {
  const projectDir = process.cwd();

  // Initial build — always runs
  try {
    await runBuild(projectDir);
  } catch (err: unknown) {
    console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  if (!options.watch) return;

  // Watch mode: watch dist/ for changes to .js files and rebuild
  const distDir = join(projectDir, 'dist');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let building = false;

  const rebuild = async () => {
    if (building) return;
    building = true;
    console.log('');
    console.log(pc.dim(`[${formatTimestamp()}] Change detected, rebuilding...`));
    try {
      await runBuild(projectDir);
    } catch (err: unknown) {
      console.error(
        pc.red(`[${formatTimestamp()}] Rebuild failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    building = false;
  };

  let watcher: FSWatcher;
  try {
    watcher = watch(distDir, { recursive: true }, (_event, filename) => {
      // Only react to .js file changes (tsc output), skip adapter.iife.js
      // and temporary wrapper files to avoid rebuild loops
      if (
        !filename ||
        !filename.endsWith('.js') ||
        filename === 'adapter.iife.js' ||
        filename.startsWith('_adapter_entry_')
      )
        return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void rebuild(), DEBOUNCE_MS);
    });
  } catch {
    console.error(pc.red(`Error: Could not watch ${distDir}. Ensure the dist/ directory exists.`));
    process.exit(1);
  }

  console.log('');
  console.log(pc.cyan(`Watching ${pc.bold('dist/')} for changes... (Ctrl+C to stop)`));

  const cleanup = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
    console.log('');
    console.log(pc.dim('Watcher stopped.'));
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep the process alive
  await new Promise<never>(() => {});
};

const registerBuildCommand = (program: Command): void => {
  program
    .command('build')
    .description('Build the current plugin directory (manifest + adapter IIFE)')
    .option('-w, --watch', 'Watch dist/ for changes and rebuild automatically')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs build
  $ opentabs build --watch`,
    )
    .action((options: { watch?: boolean }) => handleBuild(options));
};

export { registerBuildCommand, validatePlugin };
