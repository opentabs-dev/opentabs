// =============================================================================
// @opentabs/plugin-loader — Barrel Export
//
// Plugin discovery, validation, and registry merging for the OpenTabs platform.
// This package is the bridge between installed plugin npm packages and the
// platform's runtime. It is consumed by:
//
// - @opentabs/mcp-server: to discover and load plugin tool registrations
// - @opentabs/browser-extension: build scripts to discover plugin adapters
//   and generate manifest entries
//
// The primary entry point is `loadPlugins()` which runs the full pipeline:
//   discover → validate → load modules → merge into registry
// =============================================================================

// -----------------------------------------------------------------------------
// Discover — Find plugins in node_modules and config files
// -----------------------------------------------------------------------------

export { discoverPlugins, determineTrustTier } from './discover.js';

export type { DiscoveredPlugin, OpenTabsConfig, DiscoveryOptions } from './discover.js';

// -----------------------------------------------------------------------------
// Manifest Schema — Zod-based validation and JSON Schema generation
// -----------------------------------------------------------------------------

export {
  pluginManifestSchema,
  rawManifestSchema,
  pluginNameSchema,
  zodErrorToValidationErrors,
} from './manifest-schema.js';

// -----------------------------------------------------------------------------
// Validate — Check plugin manifests against the platform schema
//
// Validation functions are re-exported from manifest-schema.ts which uses Zod
// for declarative schema validation with cross-field consistency checks.
// -----------------------------------------------------------------------------

export { validatePluginManifest, validateOrThrow, checkNameConflicts } from './manifest-schema.js';

export type { ValidationError, ValidationResult } from './manifest-schema.js';

// -----------------------------------------------------------------------------
// Merge — Convert manifests to platform types and wire into the registry
// -----------------------------------------------------------------------------

export {
  manifestToServiceDefinition,
  manifestToServiceConfigs,
  resolvePlugin,
  mergeIntoRegistry,
  mergeToolRegistrations,
  mergeServiceConfigs,
  loadPlugins,
} from './merge.js';

export type {
  ServiceControllerHealthCheck,
  WebappServiceConfig,
  LoadPluginsResult,
  PluginLoadFailure,
} from './merge.js';
