// =============================================================================
// @opentabs/plugin-sdk — Main Entry
//
// The public SDK for building OpenTabs plugins. This is the primary entry point
// that plugin authors import for types and the definePlugin() helper.
//
// For adapter code, import from '@opentabs/plugin-sdk/adapter'.
// For MCP tool code, import from '@opentabs/plugin-sdk/server'.
//
// This module re-exports commonly needed types from @opentabs/core so that
// plugin authors don't need to add @opentabs/core as a direct dependency.
// =============================================================================

// -----------------------------------------------------------------------------
// Plugin Manifest Types — Re-exported from @opentabs/core
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// definePlugin() — Type-Safe Plugin Manifest Helper
//
// Plugin authors who prefer TypeScript configuration files (instead of raw
// JSON) can use this function for type checking and autocompletion.
//
// Usage in a plugin's configuration:
//
//   import { definePlugin } from '@opentabs/plugin-sdk';
//
//   export default definePlugin({
//     name: 'jira',
//     displayName: 'Jira',
//     version: '1.0.0',
//     description: 'Jira integration for OpenTabs',
//     adapter: { ... },
//     service: { ... },
//     tools: { ... },
//     permissions: { ... },
//   });
//
// The function is an identity function — it returns the manifest unchanged.
// Its sole purpose is to provide TypeScript type checking and IDE support.
// -----------------------------------------------------------------------------

import type { PluginManifest } from '@opentabs/core';

export type {
  PluginManifest,
  PluginAdapterConfig,
  PluginServiceConfig,
  PluginHealthCheckConfig,
  PluginToolsConfig,
  PluginToolCategory,
  PluginPermissions,
  NativeApiPermission,
  PluginSettingDefinition,
  PluginSettingOption,
  HealthCheckEvaluator,
  ResolvedPlugin,
  PluginTrustTier,
  ToolRegistrationFn,
} from '@opentabs/core';

// -----------------------------------------------------------------------------
// JSON-RPC Types — Re-exported for convenience
// -----------------------------------------------------------------------------

export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcError,
} from '@opentabs/core';

export {
  JsonRpcErrorCode,
  createJsonRpcSuccess,
  createJsonRpcError,
  isJsonRpcError,
  isJsonRpcRequest,
  isJsonRpcResponse,
} from '@opentabs/core';

// -----------------------------------------------------------------------------
// Service Types — Re-exported for convenience
// -----------------------------------------------------------------------------

export type { ServiceEnv, ServiceDefinition, ServiceId } from '@opentabs/core';

/**
 * Define a plugin manifest with full TypeScript type checking.
 *
 * This is an identity function — it returns the manifest object unchanged.
 * Use it in a TypeScript configuration file for autocompletion and validation.
 *
 * For JSON-based manifests (opentabs-plugin.json), use the JSON schema
 * reference instead: `"$schema": "https://opentabs.dev/schemas/plugin-v1.json"`
 *
 * @param manifest - The plugin manifest object
 * @returns The same manifest object, unchanged
 *
 * @example
 * ```ts
 * // opentabs-plugin.config.ts
 * import { definePlugin } from '@opentabs/plugin-sdk';
 *
 * export default definePlugin({
 *   name: 'jira',
 *   displayName: 'Jira',
 *   version: '1.0.0',
 *   description: 'Manage Jira issues from AI agents',
 *   adapter: {
 *     entry: './dist/adapter.js',
 *     domains: { production: '.atlassian.net' },
 *     urlPatterns: { production: ['*://*.atlassian.net/*'] },
 *   },
 *   service: {
 *     timeout: 30000,
 *     environments: ['production'],
 *     authErrorPatterns: ['401', 'Unauthorized'],
 *     healthCheck: {
 *       method: 'jira.api',
 *       params: { endpoint: '/rest/api/3/myself', method: 'GET' },
 *     },
 *   },
 *   tools: {
 *     entry: './dist/tools/index.js',
 *   },
 *   permissions: {
 *     network: ['*.atlassian.net'],
 *   },
 * });
 * ```
 */
export const definePlugin = <T extends PluginManifest>(manifest: T): T => manifest;

// -----------------------------------------------------------------------------
// Version Constant
//
// Exposed so that plugins and the platform can check SDK version compatibility
// at runtime if needed. Matches the version in package.json.
// -----------------------------------------------------------------------------

/** The semantic version of the @opentabs/plugin-sdk package. */
export const SDK_VERSION = '1.0.0';

/**
 * Minimum SDK version required by the platform. Plugins built with an older
 * SDK version may not be compatible. The plugin-loader checks this during
 * discovery and warns (or rejects) incompatible plugins.
 */
export const MIN_COMPATIBLE_SDK_VERSION = '1.0.0';
