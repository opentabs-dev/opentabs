export {
  pluginManifestSchema,
  validatePluginManifest,
  detectConflicts,
  RESERVED_NAMES,
  type ValidationResult,
  type ValidationSuccess,
  type ValidationFailure,
  type ValidationIssue,
  type NameConflict,
  type UrlPatternOverlap,
  type ConflictDetectionResult,
} from './manifest-schema.js';

export {
  discoverPlugins,
  readProjectConfig,
  scanNodeModules,
  isLocalPath,
  OFFICIAL_PREFIX,
  COMMUNITY_PREFIX,
  PLUGIN_KEYWORD,
  type DiscoveredPlugin,
  type DiscoverOptions,
  type DiscoverResult,
  type DiscoverySource,
  type OpenTabsProjectConfig,
} from './discover.js';
