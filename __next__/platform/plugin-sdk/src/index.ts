import type { PluginManifest } from '@opentabs/core';

/**
 * Define a plugin manifest with full type checking.
 * Identity function — returns the manifest unchanged.
 */
const definePlugin = (manifest: PluginManifest): PluginManifest => manifest;

export { definePlugin };

export type {
  PluginManifest,
  PluginAdapterConfig,
  PluginHealthCheckConfig,
  PluginServiceConfig,
  PluginToolCategory,
  PluginPermissions,
  NativeApiPermission,
  TrustTier,
  StoredPluginManifest,
  StoredServiceDefinition,
  StoredServiceConfig,
  PluginInstallPayload,
  ServiceDefinition,
  ServiceEnvironment,
  ServiceSource,
  ConnectionStatus,
  ServiceConnectionStatus,
  PluginLifecycleContext,
  PluginInstallContext,
  PluginUninstallContext,
  PluginEnableContext,
  PluginDisableContext,
  PluginSettingsChangeContext,
  LifecycleHookName,
  ToolRegistrationFn,
  McpServerLike,
  RegisteredToolLike,
  ResolvedPlugin,
} from '@opentabs/core';
