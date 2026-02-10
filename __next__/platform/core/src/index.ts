// =============================================================================
// @opentabs/core — Barrel Export
//
// Core types, constants, and utilities shared across the entire OpenTabs
// platform. This package has zero dependencies on other OpenTabs packages
// and forms the foundation of the dependency graph.
//
// Re-exports are organized by domain:
// - json-rpc: Wire protocol types and utilities
// - messaging: Chrome extension internal communication
// - services: Service identity types and dynamic registry
// - plugin-manifest: Plugin contract types
// =============================================================================

// -----------------------------------------------------------------------------
// JSON-RPC — Wire protocol
// -----------------------------------------------------------------------------

export {
  JsonRpcErrorCode,
  createJsonRpcSuccess,
  createJsonRpcError,
  isJsonRpcError,
  isJsonRpcRequest,
  isJsonRpcResponse,
} from './json-rpc.js';

export type {
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcError,
  JsonRpcErrorResponse,
  JsonRpcResponse,
  JsonRpcErrorCodeValue,
} from './json-rpc.js';

// -----------------------------------------------------------------------------
// Messaging — Extension internal communication
// -----------------------------------------------------------------------------

export { MessageTypes, Defaults, isOffscreenMessage } from './messaging.js';

export type {
  MessageType,
  OffscreenConnectedMessage,
  OffscreenDisconnectedMessage,
  OffscreenDataMessage,
  OffscreenToBackgroundMessage,
  TabReadyMessage,
  GetStatusMessage,
  SetPortMessage,
  FocusTabMessage,
  OpenServerFolderMessage,
  SidePanelOpenedMessage,
  SidePanelClosedMessage,
  PluginEnableMessage,
  PluginDisableMessage,
  PluginListMessage,
  BackgroundMessage,
  StatusUpdateMessage,
  CloseSidePanelMessage,
  BackgroundBroadcastMessage,
  OffscreenConnectMessage,
  OffscreenDisconnectMessage,
  OffscreenSendMessage,
  OffscreenStatusMessage,
  OffscreenUpdateUrlMessage,
  OffscreenKeepaliveMessage,
  OffscreenMessage,
  PingMessage,
  GetTabStatusMessage,
  ContentScriptMessage,
  ServiceConnectionStatus,
  ConnectionStatus,
  ToolPermissions,
  InstalledPluginStatus,
} from './messaging.js';

// -----------------------------------------------------------------------------
// Services — Service identity and dynamic registry
// -----------------------------------------------------------------------------

export {
  getServiceRegistry,
  setServiceRegistry,
  resetServiceRegistry,
  addServiceDefinitions,
  removeServiceDefinitions,
  onRegistryChange,
  getServiceIds,
  getServiceTypes,
  getServiceUrlPatterns,
  getServiceDomains,
  getServiceTimeouts,
  getServiceDisplayNames,
  getSingleEnvServices,
  getServiceType,
  getServiceTypeFromHostname,
  getServiceDefinition,
  getServiceEnv,
  getServiceUrl,
  computeServiceIds,
} from './services.js';

export type { ServiceEnv, ServiceDefinition, ServiceId, HealthCheckConfig, WebappServiceConfig } from './services.js';

// -----------------------------------------------------------------------------
// Plugin Manifest — Plugin contract types
// -----------------------------------------------------------------------------

export { RESERVED_PLUGIN_NAMES, checkReservedName } from './plugin-manifest.js';

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
  McpServerLike,
  RegisteredToolLike,
} from './plugin-manifest.js';

// -----------------------------------------------------------------------------
// Plugin Lifecycle — Lifecycle hooks and dynamic storage types
// -----------------------------------------------------------------------------

export { LIFECYCLE_HOOK_NAMES } from './plugin-lifecycle.js';

export type {
  PluginLifecycleContext,
  PluginInstallContext,
  PluginUninstallContext,
  PluginEnableContext,
  PluginDisableContext,
  PluginSettingsChangeContext,
  OnInstallHook,
  OnUninstallHook,
  OnEnableHook,
  OnDisableHook,
  OnSettingsChangeHook,
  PluginLifecycleHooks,
  LifecycleHookName,
  StoredPluginData,
  StoredPluginManifest,
  StoredServiceDefinition,
  StoredServiceConfig,
  PluginInstallPayload,
  PluginUninstallPayload,
  PluginInstallResult,
  PluginUninstallResult,
} from './plugin-lifecycle.js';
