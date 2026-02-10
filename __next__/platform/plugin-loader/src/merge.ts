import { discoverPlugins, validatePluginManifest } from './index.js';
import { addServiceDefinitions } from '@opentabs/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DiscoverOptions, DiscoveredPlugin } from './index.js';
import type {
  PluginManifest,
  StoredPluginManifest,
  StoredServiceDefinition,
  StoredServiceConfig,
  PluginInstallPayload,
  ServiceDefinition,
  ResolvedPlugin,
  ToolRegistrationFn,
  PluginInstallContext,
  PluginUninstallContext,
  PluginEnableContext,
  PluginDisableContext,
  PluginSettingsChangeContext,
  TrustTier,
} from '@opentabs/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single plugin that failed to load */
interface PluginFailure {
  /** Plugin package name or path */
  readonly name: string;
  /** What went wrong */
  readonly error: string;
}

/** Tool registration function paired with the plugin it came from */
interface PluginToolRegistration {
  /** Plugin name */
  readonly pluginName: string;
  /** Trust tier */
  readonly trustTier: TrustTier;
  /** Tool registration function from the plugin's tool module */
  readonly registerTools: ToolRegistrationFn;
}

/** Result of the full loading pipeline */
interface LoadPluginsResult {
  /** Successfully loaded plugins */
  readonly plugins: readonly ResolvedPlugin[];
  /** Plugins that failed to load (with error details) */
  readonly failures: readonly PluginFailure[];
  /** Service definitions to add to the registry */
  readonly registry: readonly ServiceDefinition[];
  /** Tool registrations for the MCP server */
  readonly toolRegistrations: readonly PluginToolRegistration[];
  /** Install payloads for the Chrome extension */
  readonly installPayloads: readonly PluginInstallPayload[];
}

// ---------------------------------------------------------------------------
// Manifest-to-runtime converters
// ---------------------------------------------------------------------------

/**
 * Convert a PluginManifest to a ServiceDefinition for the service registry.
 * Maps manifest fields to the ServiceDefinition interface.
 */
const manifestToServiceDefinition = (manifest: PluginManifest, packageName: string): ServiceDefinition => ({
  type: manifest.name,
  displayName: manifest.displayName,
  environments: [...manifest.service.environments],
  domains: [...manifest.adapter.domains],
  urlPatterns: [...manifest.adapter.urlPatterns],
  iconName: manifest.icon,
  timeout: manifest.service.timeout,
  defaultUrl: manifest.adapter.defaultUrl,
  hostPermissions: [...manifest.adapter.hostPermissions],
  source: 'plugin',
  packageName,
});

/**
 * Convert a PluginManifest to a StoredServiceConfig for the Chrome extension.
 */
const manifestToServiceConfigs = (manifest: PluginManifest): StoredServiceConfig[] => [
  {
    type: manifest.name,
    timeout: manifest.service.timeout,
    environments: [...manifest.service.environments],
    authErrorPatterns: manifest.service.authErrorPatterns ? [...manifest.service.authErrorPatterns] : [],
    healthCheck: manifest.service.healthCheck,
    notConnectedMessage: manifest.service.notConnectedMessage,
    tabNotFoundMessage: manifest.service.tabNotFoundMessage,
  },
];

/**
 * Convert a PluginManifest to a StoredServiceDefinition for the install payload.
 */
const manifestToStoredServiceDefinition = (manifest: PluginManifest, packageName: string): StoredServiceDefinition => ({
  type: manifest.name,
  displayName: manifest.displayName,
  environments: [...manifest.service.environments],
  domains: [...manifest.adapter.domains],
  urlPatterns: [...manifest.adapter.urlPatterns],
  iconName: manifest.icon,
  timeout: manifest.service.timeout,
  defaultUrl: manifest.adapter.defaultUrl,
  hostPermissions: [...manifest.adapter.hostPermissions],
  source: 'plugin',
  packageName,
});

/**
 * Convert a PluginManifest to a StoredPluginManifest (JSON-serializable).
 */
const manifestToStored = (manifest: PluginManifest): StoredPluginManifest => ({
  name: manifest.name,
  displayName: manifest.displayName,
  version: manifest.version,
  description: manifest.description,
  author: manifest.author,
  icon: manifest.icon,
  adapter: manifest.adapter,
  service: manifest.service,
  tools: manifest.tools,
  permissions: manifest.permissions,
});

// ---------------------------------------------------------------------------
// Single-plugin load pipeline
// ---------------------------------------------------------------------------

interface LoadedPlugin {
  readonly resolved: ResolvedPlugin;
  readonly serviceDefinition: ServiceDefinition;
  readonly installPayload: PluginInstallPayload;
  readonly toolRegistration: PluginToolRegistration;
}

/**
 * Read and validate the opentabs-plugin.json from a discovered plugin.
 */
const readAndValidateManifest = (discovered: DiscoveredPlugin): { manifest: PluginManifest } | { error: string } => {
  const manifestPath = path.join(discovered.packagePath, 'opentabs-plugin.json');

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Failed to read manifest: ${msg}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { error: 'Manifest is not valid JSON' };
  }

  const result = validatePluginManifest(parsed);
  if (!result.success) {
    const issues = result.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    return { error: `Manifest validation failed:\n${issues}` };
  }

  return { manifest: result.data };
};

/**
 * Read the adapter IIFE source code from disk.
 * Looks for a pre-built dist/adapter.js or falls back to src/adapter.ts.
 */
const readAdapterCode = (packagePath: string): string | undefined => {
  const candidates = ['dist/adapter.iife.js', 'dist/adapter.js'];

  for (const candidate of candidates) {
    const adapterPath = path.join(packagePath, candidate);
    try {
      if (fs.existsSync(adapterPath)) {
        return fs.readFileSync(adapterPath, 'utf8');
      }
    } catch {
      continue;
    }
  }

  return undefined;
};

/**
 * Dynamically import a plugin's tool module and extract exports.
 * Uses cache-busting query params to enable hot reload.
 */
const importToolModule = async (
  packagePath: string,
): Promise<
  | {
      registerTools?: ToolRegistrationFn;
      isHealthy?: (response: unknown) => boolean;
      hooks: ResolvedPlugin['hooks'];
    }
  | { error: string }
> => {
  const toolModuleCandidates = ['dist/tools/index.js', 'src/tools/index.ts'];
  let modulePath: string | undefined;

  for (const candidate of toolModuleCandidates) {
    const fullPath = path.join(packagePath, candidate);
    if (fs.existsSync(fullPath)) {
      modulePath = fullPath;
      break;
    }
  }

  if (modulePath === undefined) {
    return { error: 'No tool module found (expected dist/tools/index.js or src/tools/index.ts)' };
  }

  const cacheBuster = `?t=${Date.now()}`;
  const importUrl = `${modulePath}${cacheBuster}`;

  let moduleExports: Record<string, unknown>;
  try {
    moduleExports = (await import(importUrl)) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Failed to import tool module: ${msg}` };
  }

  const registerTools = moduleExports['registerTools'] as ToolRegistrationFn | undefined;
  if (typeof registerTools !== 'function') {
    return { error: 'Tool module must export a registerTools function' };
  }

  const isHealthy =
    typeof moduleExports['isHealthy'] === 'function'
      ? (moduleExports['isHealthy'] as (response: unknown) => boolean)
      : undefined;

  const hooks: ResolvedPlugin['hooks'] = {
    onInstall:
      typeof moduleExports['onInstall'] === 'function'
        ? (moduleExports['onInstall'] as (ctx: PluginInstallContext) => void | Promise<void>)
        : undefined,
    onUninstall:
      typeof moduleExports['onUninstall'] === 'function'
        ? (moduleExports['onUninstall'] as (ctx: PluginUninstallContext) => void | Promise<void>)
        : undefined,
    onEnable:
      typeof moduleExports['onEnable'] === 'function'
        ? (moduleExports['onEnable'] as (ctx: PluginEnableContext) => void | Promise<void>)
        : undefined,
    onDisable:
      typeof moduleExports['onDisable'] === 'function'
        ? (moduleExports['onDisable'] as (ctx: PluginDisableContext) => void | Promise<void>)
        : undefined,
    onSettingsChange:
      typeof moduleExports['onSettingsChange'] === 'function'
        ? (moduleExports['onSettingsChange'] as (ctx: PluginSettingsChangeContext) => void | Promise<void>)
        : undefined,
  };

  return { registerTools, isHealthy, hooks };
};

/**
 * Load a single discovered plugin through the full pipeline:
 * validate manifest -> import tool module -> read adapter -> build payloads
 */
const loadSinglePlugin = async (discovered: DiscoveredPlugin): Promise<LoadedPlugin | PluginFailure> => {
  const manifestResult = readAndValidateManifest(discovered);
  if ('error' in manifestResult) {
    return { name: discovered.packageName, error: manifestResult.error };
  }
  const { manifest } = manifestResult;

  const toolResult = await importToolModule(discovered.packagePath);
  if ('error' in toolResult) {
    return { name: discovered.packageName, error: toolResult.error };
  }

  const adapterCode = readAdapterCode(discovered.packagePath) ?? '';

  const serviceDefinition = manifestToServiceDefinition(manifest, discovered.packageName);
  const storedServiceDef = manifestToStoredServiceDefinition(manifest, discovered.packageName);
  const serviceConfigs = manifestToServiceConfigs(manifest);

  const installPayload: PluginInstallPayload = {
    name: manifest.name,
    adapterCode,
    manifest: manifestToStored(manifest),
    serviceDefinitions: [storedServiceDef],
    serviceConfigs,
    version: manifest.version,
    trustTier: discovered.trustTier,
  };

  const resolved: ResolvedPlugin = {
    name: manifest.name,
    manifest,
    trustTier: discovered.trustTier,
    path: discovered.packagePath,
    registerTools: toolResult.registerTools!,
    isHealthy: toolResult.isHealthy,
    hooks: toolResult.hooks,
  };

  const toolRegistration: PluginToolRegistration = {
    pluginName: manifest.name,
    trustTier: discovered.trustTier,
    registerTools: toolResult.registerTools!,
  };

  return {
    resolved,
    serviceDefinition,
    installPayload,
    toolRegistration,
  };
};

// ---------------------------------------------------------------------------
// Main loading pipeline
// ---------------------------------------------------------------------------

/**
 * Orchestrate the full plugin loading pipeline:
 * discover -> validate -> load -> merge into service registry
 *
 * Failed plugins produce clear error messages and don't crash the platform.
 * Returns all successfully loaded plugins, failures, and artifacts for
 * the MCP server and Chrome extension.
 */
const loadPlugins = async (options?: DiscoverOptions): Promise<LoadPluginsResult> => {
  const discovered = discoverPlugins(options);

  const plugins: ResolvedPlugin[] = [];
  const failures: PluginFailure[] = [];
  const registry: ServiceDefinition[] = [];
  const toolRegistrations: PluginToolRegistration[] = [];
  const installPayloads: PluginInstallPayload[] = [];

  // Report discovery errors as failures
  for (const error of discovered.errors) {
    failures.push({ name: 'discovery', error });
  }

  // Load each discovered plugin
  const loadResults = await Promise.allSettled(discovered.plugins.map(plugin => loadSinglePlugin(plugin)));

  for (const result of loadResults) {
    if (result.status === 'rejected') {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push({ name: 'unknown', error: `Unexpected error: ${msg}` });
      continue;
    }

    const loaded = result.value;

    if ('error' in loaded) {
      failures.push(loaded);
      continue;
    }

    plugins.push(loaded.resolved);
    registry.push(loaded.serviceDefinition);
    toolRegistrations.push(loaded.toolRegistration);
    installPayloads.push(loaded.installPayload);
  }

  // Merge service definitions into the global registry
  if (registry.length > 0) {
    addServiceDefinitions(registry);
  }

  return {
    plugins,
    failures,
    registry,
    toolRegistrations,
    installPayloads,
  };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  loadPlugins,
  manifestToServiceDefinition,
  manifestToServiceConfigs,
  type LoadPluginsResult,
  type PluginFailure,
  type PluginToolRegistration,
};
