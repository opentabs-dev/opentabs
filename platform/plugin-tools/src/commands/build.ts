/**
 * `opentabs-plugin build` command — generates dist/tools.json and bundles the adapter IIFE.
 * Plugin metadata (name, version, displayName, description, urlPatterns) is read from
 * package.json's `opentabs` field; tool schemas are serialized from the plugin module.
 * With `--watch`, rebuilds automatically when tsc output in `dist/` changes.
 */

import { validatePluginName, validateUrlPattern, LUCIDE_ICON_NAMES } from '@opentabs-dev/plugin-sdk';
import { parsePluginPackageJson } from '@opentabs-dev/shared';
import pc from 'picocolors';
import { z } from 'zod';
import { mkdirSync, watch } from 'node:fs';
import { chmod, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, relative, dirname } from 'node:path';
import type {
  ManifestTool,
  OpenTabsPlugin,
  PromptDefinition,
  ResourceDefinition,
  ToolDefinition,
} from '@opentabs-dev/plugin-sdk';
import type { ManifestPrompt, ManifestPromptArgument, ManifestResource, PluginPackageJson } from '@opentabs-dev/shared';
import type { Command } from 'commander';
import type { FSWatcher } from 'node:fs';

const DEBOUNCE_MS = 100;
const DEFAULT_PORT = 9515;

// ---------------------------------------------------------------------------
// Config helpers — lightweight versions for the build tool, which cannot
// depend on the CLI or MCP server packages.
// ---------------------------------------------------------------------------

const getConfigDir = (): string => Bun.env.OPENTABS_CONFIG_DIR || join(homedir(), '.opentabs');
const getConfigPath = (): string => join(getConfigDir(), 'config.json');

/** Write config atomically via tmp-file + rename. */
const atomicWriteConfig = async (configPath: string, content: string): Promise<void> => {
  const tmpPath = configPath + '.tmp';
  try {
    await Bun.write(tmpPath, content);
    await chmod(tmpPath, 0o600).catch(() => {});
    await rename(tmpPath, configPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
};

/**
 * Add the plugin directory to localPlugins in ~/.opentabs/config.json.
 * Uses a relative path from the config directory for portability.
 * Returns true if newly registered, false if already present.
 */
const registerInConfig = async (projectDir: string): Promise<boolean> => {
  const configPath = getConfigPath();
  const configFile = Bun.file(configPath);
  if (!(await configFile.exists())) {
    console.warn(pc.yellow('Warning: Config file not found — skipping auto-registration.'));
    console.warn(pc.yellow(`  Run ${pc.cyan('opentabs start')} to create ~/.opentabs/config.json`));
    return false;
  }

  let config: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await configFile.text());
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn(pc.yellow('Warning: Config file is not a JSON object — skipping auto-registration.'));
      return false;
    }
    config = parsed as Record<string, unknown>;
  } catch {
    console.warn(pc.yellow('Warning: Config file has invalid JSON — skipping auto-registration.'));
    return false;
  }

  if (!Array.isArray(config.localPlugins)) config.localPlugins = [];
  const plugins = config.localPlugins as string[];

  const configDir = dirname(configPath);
  const pluginPath = relative(configDir, projectDir);

  if (plugins.includes(pluginPath)) return false;

  plugins.push(pluginPath);
  await atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');
  return true;
};

/**
 * Notify the running MCP server to reload plugins by calling POST /reload.
 * Fails silently — the build succeeds regardless of whether the server is running.
 */
const notifyServer = async (): Promise<void> => {
  const configPath = getConfigPath();
  const configFile = Bun.file(configPath);
  if (!(await configFile.exists())) return;

  let secret: string | undefined;
  try {
    const parsed: unknown = JSON.parse(await configFile.text());
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.secret === 'string') secret = record.secret;
    }
  } catch {
    return;
  }

  if (!secret) return;

  const port = Bun.env.OPENTABS_PORT ? Number(Bun.env.OPENTABS_PORT) : DEFAULT_PORT;
  if (!Number.isFinite(port) || port < 1 || port > 65535) return;

  try {
    const res = await fetch(`http://localhost:${port}/reload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (res.ok) {
      console.log(pc.dim('Notified MCP server to reload plugins.'));
    }
  } catch {
    // Server not running — ignore
  }
};

/**
 * Validate the plugin's package.json has the required `opentabs` field.
 * Returns the parsed PluginPackageJson or throws with a descriptive error.
 */
const validatePackageJson = (pkgJson: unknown, projectDir: string): PluginPackageJson => {
  const result = parsePluginPackageJson(pkgJson, projectDir);
  if (!result.ok) {
    throw new Error(result.error);
  }

  // Additional validation: URL patterns
  for (const pattern of result.value.opentabs.urlPatterns) {
    const patternError = validateUrlPattern(pattern);
    if (patternError) throw new Error(patternError);
  }

  return result.value;
};

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

  // Display name
  if (plugin.displayName.length === 0) errors.push('Plugin displayName is required');

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
      if (!tool.displayName || tool.displayName.length === 0)
        errors.push(`Tool "${tool.name || '(unnamed)'}" is missing a displayName`);
      if (tool.description.length === 0) errors.push(`Tool "${tool.name || '(unnamed)'}" is missing a description`);
      if (!LUCIDE_ICON_NAMES.has(tool.icon)) {
        errors.push(
          `Tool "${tool.name || '(unnamed)'}" has invalid icon "${tool.icon}" — must be a valid Lucide icon name (kebab-case). See https://lucide.dev/icons`,
        );
      }
      if (tool.name.length > 0 && toolNames.has(tool.name)) {
        errors.push(`Duplicate tool name "${tool.name}"`);
      }
      if (tool.name.length > 0) toolNames.add(tool.name);
    }
  }

  // Resources (optional)
  if (plugin.resources && plugin.resources.length > 0) {
    const resourceUris = new Set<string>();
    for (const resource of plugin.resources) {
      if (resource.uri.length === 0) {
        errors.push('Resource URI is required');
      }
      if (resource.name.length === 0) {
        errors.push(`Resource "${resource.uri || '(unnamed)'}" is missing a name`);
      }
      if (resource.uri.length > 0 && resourceUris.has(resource.uri)) {
        errors.push(`Duplicate resource URI "${resource.uri}"`);
      }
      if (resource.uri.length > 0) resourceUris.add(resource.uri);
    }
  }

  // Prompts (optional)
  if (plugin.prompts && plugin.prompts.length > 0) {
    const PROMPT_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
    const promptNames = new Set<string>();
    for (const prompt of plugin.prompts) {
      if (prompt.name.length === 0) {
        errors.push('Prompt name is required');
      } else if (!PROMPT_NAME_REGEX.test(prompt.name)) {
        errors.push(
          `Prompt name "${prompt.name}" must match [a-z0-9_-]+ pattern (lowercase alphanumeric with underscores and hyphens)`,
        );
      }
      if (prompt.arguments) {
        for (const arg of prompt.arguments) {
          if (arg.name.length === 0) {
            errors.push(`Prompt "${prompt.name || '(unnamed)'}" has an argument with an empty name`);
          }
        }
      }
      if (prompt.name.length > 0 && promptNames.has(prompt.name)) {
        errors.push(`Duplicate prompt name "${prompt.name}"`);
      }
      if (prompt.name.length > 0) promptNames.add(prompt.name);
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

/** Full manifest shape written to dist/tools.json */
interface PluginManifestOutput {
  sdkVersion: string;
  tools: ManifestTool[];
  resources: ManifestResource[];
  prompts: ManifestPrompt[];
}

/** Serialize plugin tools to ManifestTool[] */
const generateToolsManifest = (plugin: OpenTabsPlugin): ManifestTool[] =>
  plugin.tools.map(tool => {
    const { inputSchema, outputSchema } = convertToolSchemas(tool);
    return {
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      icon: tool.icon,
      input_schema: inputSchema,
      output_schema: outputSchema,
    };
  });

/** Extract serializable resource metadata from plugin resource definitions */
const generateResourcesManifest = (resources: ResourceDefinition[]): ManifestResource[] =>
  resources.map(r => {
    const entry: ManifestResource = { uri: r.uri, name: r.name };
    if (r.description !== undefined) entry.description = r.description;
    if (r.mimeType !== undefined) entry.mimeType = r.mimeType;
    return entry;
  });

/** Extract serializable prompt metadata from plugin prompt definitions */
const generatePromptsManifest = (prompts: PromptDefinition[]): ManifestPrompt[] =>
  prompts.map(p => {
    const entry: ManifestPrompt = { name: p.name };
    if (p.description !== undefined) entry.description = p.description;
    if (p.arguments !== undefined) {
      entry.arguments = p.arguments.map(a => {
        const arg: ManifestPromptArgument = { name: a.name };
        if (a.description !== undefined) arg.description = a.description;
        if (a.required !== undefined) arg.required = a.required;
        return arg;
      });
    }
    return entry;
  });

/**
 * Resolve the installed @opentabs-dev/plugin-sdk version from the plugin's node_modules.
 * Returns the exact semver version string (e.g. '0.0.10'), not a range.
 * Throws with a descriptive error if the SDK is not installed.
 */
const resolveSdkVersion = async (projectDir: string): Promise<string> => {
  const sdkPkgPath = join(projectDir, 'node_modules', '@opentabs-dev', 'plugin-sdk', 'package.json');
  const sdkPkgFile = Bun.file(sdkPkgPath);
  if (!(await sdkPkgFile.exists())) {
    throw new Error('Could not resolve @opentabs-dev/plugin-sdk version. Ensure the package is installed.');
  }
  let sdkPkg: unknown;
  try {
    sdkPkg = JSON.parse(await sdkPkgFile.text());
  } catch {
    throw new Error('Could not resolve @opentabs-dev/plugin-sdk version. Ensure the package is installed.');
  }
  if (typeof sdkPkg !== 'object' || sdkPkg === null || !('version' in sdkPkg)) {
    throw new Error('Could not resolve @opentabs-dev/plugin-sdk version. Ensure the package is installed.');
  }
  const version = (sdkPkg as Record<string, unknown>).version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Could not resolve @opentabs-dev/plugin-sdk version. Ensure the package is installed.');
  }
  return version;
};

/** Generate the full manifest (tools + resources + prompts) for dist/tools.json */
const generateManifest = (plugin: OpenTabsPlugin, sdkVersion: string): PluginManifestOutput => ({
  sdkVersion,
  tools: generateToolsManifest(plugin),
  resources: generateResourcesManifest(plugin.resources ?? []),
  prompts: generatePromptsManifest(plugin.prompts ?? []),
});

const bundleIIFE = async (sourceEntry: string, outDir: string, pluginName: string): Promise<void> => {
  // Create a temporary wrapper entry that imports the plugin and registers it
  // on window.__openTabs.adapters. This is bundled as an IIFE so the adapter
  // is available when executed in MAIN world.
  const wrapperPath = join(outDir, `_adapter_entry_${crypto.randomUUID()}.ts`);
  const relativeImport = './' + relative(outDir, sourceEntry).replace(/\.ts$/, '.js');

  const name = JSON.stringify(pluginName);
  const wrapperCode = `import plugin from ${JSON.stringify(relativeImport)};
(globalThis as any).__openTabs = (globalThis as any).__openTabs || {};
(globalThis as any).__openTabs.adapters = (globalThis as any).__openTabs.adapters || {};
const adapters = (globalThis as any).__openTabs.adapters;

// --- Log transport: batch entries and flush via postMessage to the relay ---
// Access _setLogTransport from globalThis (registered by the SDK's log module
// at import time) rather than via a direct import, so the wrapper works even
// when the plugin's installed SDK version predates the log module.
const setLogTransport = (globalThis as any).__openTabs?._setLogTransport as
  | ((fn: (entry: { level: string; message: string; data: unknown[]; ts: string }) => void) => () => void)
  | undefined;

const LOG_FLUSH_INTERVAL = 100;
const LOG_BATCH_MAX = 50;
let logBatch: Array<{ level: string; message: string; data: unknown[]; ts: string }> = [];
let logFlushTimer: ReturnType<typeof setTimeout> | null = null;

const flushLogs = () => {
  if (logBatch.length === 0) return;
  const entries = logBatch;
  logBatch = [];
  try {
    const nonce = ((globalThis as any).__openTabs as any)?._logNonce as string | undefined;
    window.postMessage({ type: 'opentabs:plugin-logs', plugin: ${name}, entries, nonce: nonce ?? '' }, '*');
  } catch {
    // Extension not available — drop silently
  }
};

const logTransport = (entry: { level: string; message: string; data: unknown[]; ts: string }) => {
  logBatch.push(entry);
  if (logBatch.length >= LOG_BATCH_MAX) {
    if (logFlushTimer !== null) { clearTimeout(logFlushTimer); logFlushTimer = null; }
    flushLogs();
  } else if (logFlushTimer === null) {
    logFlushTimer = setTimeout(() => { logFlushTimer = null; flushLogs(); }, LOG_FLUSH_INTERVAL);
  }
};

const restoreTransport = setLogTransport ? setLogTransport(logTransport) : undefined;

const existing = adapters[${name}];
if (existing) {
  if (typeof existing.onDeactivate === 'function') {
    try { existing.onDeactivate(); } catch (e) { console.warn('[OpenTabs] onDeactivate failed for ' + ${name} + ':', e); }
  }
  if (typeof existing.teardown === 'function') {
    try { existing.teardown(); } catch (e) { console.warn('[OpenTabs] teardown failed for ' + ${name} + ':', e); }
  }
}
Reflect.deleteProperty(adapters, ${name});

// Wire onToolInvocationStart / onToolInvocationEnd around each tool.handle()
if (typeof plugin.onToolInvocationStart === 'function' || typeof plugin.onToolInvocationEnd === 'function') {
  for (const tool of plugin.tools) {
    const origHandle = tool.handle;
    tool.handle = async function() {
      const handleArgs = arguments;
      const startTime = performance.now();
      if (typeof plugin.onToolInvocationStart === 'function') {
        try { plugin.onToolInvocationStart(tool.name); } catch (e) { console.warn('[OpenTabs] onToolInvocationStart failed:', e); }
      }
      let success = true;
      try {
        return await origHandle.apply(this, handleArgs as any);
      } catch (err) {
        success = false;
        throw err;
      } finally {
        const durationMs = performance.now() - startTime;
        if (typeof plugin.onToolInvocationEnd === 'function') {
          try { plugin.onToolInvocationEnd(tool.name, success, durationMs); } catch (e) { console.warn('[OpenTabs] onToolInvocationEnd failed:', e); }
        }
      }
    };
  }
}

adapters[${name}] = plugin;

// Wire onActivate
if (typeof plugin.onActivate === 'function') {
  try { plugin.onActivate(); } catch (e) { console.warn('[OpenTabs] onActivate failed for ' + ${name} + ':', e); }
}

// Wire onNavigate — intercept history methods and listen for popstate/hashchange
if (typeof plugin.onNavigate === 'function') {
  let lastUrl = location.href;
  const checkUrl = () => {
    const newUrl = location.href;
    if (newUrl !== lastUrl) {
      lastUrl = newUrl;
      try { plugin.onNavigate!(newUrl); } catch (e) { console.warn('[OpenTabs] onNavigate failed:', e); }
    }
  };
  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);
  history.pushState = function(...args: Parameters<typeof history.pushState>) {
    origPushState(...args);
    checkUrl();
  };
  history.replaceState = function(...args: Parameters<typeof history.replaceState>) {
    origReplaceState(...args);
    checkUrl();
  };
  window.addEventListener('popstate', checkUrl);
  window.addEventListener('hashchange', checkUrl);

  // Wrap teardown to restore navigation listeners when this adapter is later replaced
  const origTeardown = typeof plugin.teardown === 'function' ? plugin.teardown.bind(plugin) : undefined;
  const origOnDeactivate = typeof plugin.onDeactivate === 'function' ? plugin.onDeactivate.bind(plugin) : undefined;
  plugin.teardown = function() {
    if (origOnDeactivate) {
      try { origOnDeactivate(); } catch (e) { console.warn('[OpenTabs] onDeactivate failed for ' + ${name} + ':', e); }
    }
    history.pushState = origPushState;
    history.replaceState = origReplaceState;
    window.removeEventListener('popstate', checkUrl);
    window.removeEventListener('hashchange', checkUrl);
    // Flush remaining logs and tear down log transport
    if (logFlushTimer !== null) { clearTimeout(logFlushTimer); logFlushTimer = null; }
    flushLogs();
    if (restoreTransport) restoreTransport();
    if (origTeardown) origTeardown();
  };
  plugin.onDeactivate = undefined as any;
} else {
  // No onNavigate — still wrap teardown for onDeactivate ordering and log cleanup
  const origTeardown = typeof plugin.teardown === 'function' ? plugin.teardown.bind(plugin) : undefined;
  const origOnDeactivate = typeof plugin.onDeactivate === 'function' ? plugin.onDeactivate.bind(plugin) : undefined;
  plugin.teardown = function() {
    if (origOnDeactivate) {
      try { origOnDeactivate(); } catch (e) { console.warn('[OpenTabs] onDeactivate failed for ' + ${name} + ':', e); }
    }
    // Flush remaining logs and tear down log transport
    if (logFlushTimer !== null) { clearTimeout(logFlushTimer); logFlushTimer = null; }
    flushLogs();
    if (restoreTransport) restoreTransport();
    if (origTeardown) origTeardown();
  };
  plugin.onDeactivate = undefined as any;
}
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

  // Step 1: Read and validate package.json (must have opentabs field)
  const pkgJsonFile = Bun.file(join(projectDir, 'package.json'));
  if (!(await pkgJsonFile.exists())) {
    throw new Error('No valid package.json found in current directory. Run this command from a plugin directory.');
  }
  let pkgJsonRaw: unknown;
  try {
    pkgJsonRaw = JSON.parse(await pkgJsonFile.text());
  } catch {
    throw new Error('No valid package.json found in current directory. Run this command from a plugin directory.');
  }

  console.log(pc.dim('Validating package.json opentabs field...'));
  const pkgJson = validatePackageJson(pkgJsonRaw, projectDir);

  // Determine entry point — look for compiled output in dist/
  const entryPoint = resolve(projectDir, 'dist', 'index.js');
  const sourceEntry = resolve(projectDir, 'src', 'index.ts');

  if (!(await Bun.file(entryPoint).exists())) {
    throw new Error(
      `Compiled entry point not found at ${entryPoint}. Run tsc first, then retry opentabs-plugin build.`,
    );
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

  // Step 5: Resolve installed SDK version
  console.log(pc.dim('Resolving SDK version...'));
  const sdkVersion = await resolveSdkVersion(projectDir);

  // Step 6: Generate dist/tools.json (tool schemas + resource/prompt metadata)
  console.log(pc.dim('Generating tools.json...'));
  const manifest = generateManifest(plugin, sdkVersion);
  const toolsJsonPath = join(distDir, 'tools.json');
  await Bun.write(toolsJsonPath, JSON.stringify(manifest, null, 2) + '\n');
  const toolCount = manifest.tools.length;
  const resourceCount = manifest.resources.length;
  const promptCount = manifest.prompts.length;
  const parts = [`${toolCount} tool${toolCount === 1 ? '' : 's'}`];
  if (resourceCount > 0) parts.push(`${resourceCount} resource${resourceCount === 1 ? '' : 's'}`);
  if (promptCount > 0) parts.push(`${promptCount} prompt${promptCount === 1 ? '' : 's'}`);
  console.log(`  Written: ${pc.bold('dist/tools.json')} (${parts.join(', ')})`);

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(pc.green(`Build complete for plugin "${pkgJson.name}" v${pkgJson.version} in ${elapsed}s`));
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

  // Auto-register in config (first build only) and notify server
  try {
    const registered = await registerInConfig(projectDir);
    if (registered) {
      console.log(pc.green('Registered in ~/.opentabs/config.json'));
    }
  } catch (err: unknown) {
    console.warn(
      pc.yellow(`Warning: Could not auto-register plugin: ${err instanceof Error ? err.message : String(err)}`),
    );
  }
  try {
    await notifyServer();
  } catch {
    // Notification failures are non-fatal
  }

  if (!options.watch) return;

  // Watch mode: watch dist/ for changes to .js files and rebuild
  const distDir = join(projectDir, 'dist');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let building = false;
  let pendingRebuild = false;

  const rebuild = async () => {
    if (building) {
      pendingRebuild = true;
      return;
    }
    building = true;
    console.log('');
    console.log(pc.dim(`[${formatTimestamp()}] Change detected, rebuilding...`));
    try {
      await runBuild(projectDir);
      // Notify server after each successful rebuild in watch mode
      try {
        await notifyServer();
      } catch {
        // Notification failures are non-fatal
      }
    } catch (err: unknown) {
      console.error(
        pc.red(`[${formatTimestamp()}] Rebuild failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    } finally {
      building = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        void rebuild();
      }
    }
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
    .description('Build the current plugin directory (dist/tools.json + adapter IIFE)')
    .option('-w, --watch', 'Watch dist/ for changes and rebuild automatically')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs-plugin build
  $ opentabs-plugin build --watch`,
    )
    .action((options: { watch?: boolean }) => handleBuild(options));
};

export {
  convertToolSchemas,
  formatBytes,
  formatTimestamp,
  generateManifest,
  generatePromptsManifest,
  generateResourcesManifest,
  generateToolsManifest,
  notifyServer,
  registerBuildCommand,
  registerInConfig,
  resolveSdkVersion,
  validatePackageJson,
  validatePlugin,
};
