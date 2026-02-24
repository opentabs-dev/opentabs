/**
 * Immutable plugin registry.
 *
 * Holds all discovered plugins, a pre-built O(1) tool lookup map with
 * compiled Ajv validators, and a list of discovery failures. The registry
 * is built once and never mutated — when plugins change, a new registry
 * is constructed and swapped atomically on ServerState.
 */

import { log } from './logger.js';
import { prefixedToolName, prefixedResourceUri, prefixedPromptName } from './state.js';
import AjvValidator from 'ajv';
import type {
  FailedPlugin,
  PluginRegistry,
  RegisteredPlugin,
  ResourceLookupEntry,
  PromptLookupEntry,
  ToolLookupEntry,
} from './state.js';
import type { ManifestTool, ManifestResource, ManifestPrompt, TrustTier } from '@opentabs-dev/shared';

/** Result of looking up a tool in the registry */
interface ToolLookupResult {
  readonly plugin: RegisteredPlugin;
  readonly tool: ManifestTool;
  readonly lookup: ToolLookupEntry;
}

/** Result of looking up a resource in the registry */
interface ResourceLookupResult {
  readonly plugin: RegisteredPlugin;
  readonly resource: ManifestResource;
}

/** Result of looking up a prompt in the registry */
interface PromptLookupResult {
  readonly plugin: RegisteredPlugin;
  readonly prompt: ManifestPrompt;
}

/** Map trust tier to a human-readable prefix for MCP tool descriptions */
const trustTierPrefix = (tier: TrustTier): string => {
  switch (tier) {
    case 'official':
      return '[Official] ';
    case 'community':
      return '[Community plugin — unverified] ';
    case 'local':
      return '[Local plugin] ';
  }
};

/**
 * Compile a JSON Schema into an Ajv validate function.
 * Returns a ToolLookupEntry with the validate fn and error formatter.
 * If compilation fails, validate is null and errors are logged.
 */
const compileToolValidator = (
  ajv: InstanceType<typeof AjvValidator>,
  pluginName: string,
  toolName: string,
  inputSchema: Record<string, unknown>,
): Pick<ToolLookupEntry, 'validate' | 'validationErrors'> => {
  try {
    const validate = ajv.compile(inputSchema);
    return {
      validate,
      validationErrors: () => {
        if (!validate.errors?.length) return 'Unknown validation error';
        return validate.errors
          .map(e => {
            const path = e.instancePath || '(root)';
            return `  - ${path}: ${e.message ?? 'invalid'}`;
          })
          .join('\n');
      },
    };
  } catch (err) {
    log.warn(`Failed to compile JSON Schema for ${pluginName}/${toolName}:`, err);
    return {
      validate: null,
      validationErrors: () => 'Schema compilation failed — validation skipped',
    };
  }
};

/**
 * Build an immutable PluginRegistry from loaded plugins and failures.
 *
 * Compiles Ajv validators for each tool's input schema during construction
 * so that tool dispatch has O(1) lookup with pre-compiled validation.
 *
 * All returned objects are frozen to prevent accidental mutation.
 */
const buildRegistry = (
  loadedPlugins: readonly RegisteredPlugin[],
  failures: readonly FailedPlugin[],
): PluginRegistry => {
  const ajv = new AjvValidator({ allErrors: false });
  const plugins = new Map<string, RegisteredPlugin>();
  const toolLookup = new Map<string, ToolLookupEntry>();
  const resourceLookup = new Map<string, ResourceLookupEntry>();
  const promptLookup = new Map<string, PromptLookupEntry>();

  for (const plugin of loadedPlugins) {
    plugins.set(plugin.name, plugin);
    for (const toolDef of plugin.tools) {
      const prefixed = prefixedToolName(plugin.name, toolDef.name);
      const { validate, validationErrors } = compileToolValidator(ajv, plugin.name, toolDef.name, toolDef.input_schema);
      toolLookup.set(prefixed, { pluginName: plugin.name, toolName: toolDef.name, validate, validationErrors });
    }
    for (const resource of plugin.resources) {
      const prefixed = prefixedResourceUri(plugin.name, resource.uri);
      resourceLookup.set(prefixed, { pluginName: plugin.name, originalUri: resource.uri });
    }
    for (const prompt of plugin.prompts) {
      const prefixed = prefixedPromptName(plugin.name, prompt.name);
      promptLookup.set(prefixed, { pluginName: plugin.name, originalName: prompt.name });
    }
  }

  const registry: PluginRegistry = {
    plugins,
    toolLookup,
    resourceLookup,
    promptLookup,
    failures,
  };

  return Object.freeze(registry);
};

/** Create an empty registry (used for initial state) */
const emptyRegistry = (): PluginRegistry => buildRegistry([], []);

/** Get a plugin by internal name, or undefined if not found */
const getPlugin = (registry: PluginRegistry, name: string): RegisteredPlugin | undefined => registry.plugins.get(name);

/** Get a tool by prefixed name, or undefined if not found */
const getTool = (registry: PluginRegistry, prefixedName: string): ToolLookupResult | undefined => {
  const lookup = registry.toolLookup.get(prefixedName);
  if (!lookup) return undefined;

  const plugin = registry.plugins.get(lookup.pluginName);
  if (!plugin) return undefined;

  const tool = plugin.tools.find(t => t.name === lookup.toolName);
  if (!tool) return undefined;

  return { plugin, tool, lookup };
};

/** Look up a resource by its prefixed URI */
const getResource = (registry: PluginRegistry, prefixedUri: string): ResourceLookupResult | undefined => {
  const lookup = registry.resourceLookup.get(prefixedUri);
  if (!lookup) return undefined;

  const plugin = registry.plugins.get(lookup.pluginName);
  if (!plugin) return undefined;

  const resource = plugin.resources.find(r => r.uri === lookup.originalUri);
  if (!resource) return undefined;

  return { plugin, resource };
};

/** Look up a prompt by its prefixed name */
const getPrompt = (registry: PluginRegistry, prefixedName: string): PromptLookupResult | undefined => {
  const lookup = registry.promptLookup.get(prefixedName);
  if (!lookup) return undefined;

  const plugin = registry.plugins.get(lookup.pluginName);
  if (!plugin) return undefined;

  const prompt = plugin.prompts.find(p => p.name === lookup.originalName);
  if (!prompt) return undefined;

  return { plugin, prompt };
};

/** Return all resources from all plugins with prefixed URIs for MCP resources/list responses */
const listAllResources = (
  registry: PluginRegistry,
): Array<{ uri: string; name: string; description?: string; mimeType?: string }> => {
  const resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }> = [];

  for (const plugin of registry.plugins.values()) {
    for (const resource of plugin.resources) {
      resources.push({
        uri: prefixedResourceUri(plugin.name, resource.uri),
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      });
    }
  }

  return resources;
};

/** Return all prompts from all plugins with prefixed names for MCP prompts/list responses */
const listAllPrompts = (
  registry: PluginRegistry,
): Array<{
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}> => {
  const prompts: Array<{
    name: string;
    description?: string;
    arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  }> = [];

  for (const plugin of registry.plugins.values()) {
    for (const prompt of plugin.prompts) {
      prompts.push({
        name: prefixedPromptName(plugin.name, prompt.name),
        description: prompt.description,
        arguments: prompt.arguments,
      });
    }
  }

  return prompts;
};

export {
  buildRegistry,
  emptyRegistry,
  getPlugin,
  getPrompt,
  getResource,
  getTool,
  listAllPrompts,
  listAllResources,
  trustTierPrefix,
};
export type { PromptLookupResult, ResourceLookupResult, ToolLookupResult };
