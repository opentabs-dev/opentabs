import type { PluginManifest, TrustTier } from './plugin-manifest.js';

// ---------------------------------------------------------------------------
// Lifecycle Hook Contexts
// ---------------------------------------------------------------------------

/** Base context available to all lifecycle hooks */
interface PluginLifecycleContext {
  /** Plugin package name */
  readonly pluginName: string;
  /** Current plugin manifest */
  readonly manifest: PluginManifest;
}

/** Context for the onInstall lifecycle hook */
interface PluginInstallContext extends PluginLifecycleContext {
  /** Reason for install: "install" (first time) or "update" (version change) */
  readonly reason: 'install' | 'update';
  /** Previous version if this is an update, undefined for first install */
  readonly previousVersion?: string;
}

/** Context for the onUninstall lifecycle hook */
type PluginUninstallContext = PluginLifecycleContext;

/** Context for the onEnable lifecycle hook */
type PluginEnableContext = PluginLifecycleContext;

/** Context for the onDisable lifecycle hook */
type PluginDisableContext = PluginLifecycleContext;

/** Context for the onSettingsChange lifecycle hook */
interface PluginSettingsChangeContext extends PluginLifecycleContext {
  /** Settings values before the change */
  readonly previousSettings: Record<string, unknown>;
  /** Keys that changed */
  readonly changedKeys: readonly string[];
}

/** Union of all lifecycle hook names */
type LifecycleHookName = 'onInstall' | 'onUninstall' | 'onEnable' | 'onDisable' | 'onSettingsChange';

// ---------------------------------------------------------------------------
// Tool Registration Abstractions
// ---------------------------------------------------------------------------

/**
 * Abstract type for a tool registration function.
 * Plugins export `registerTools` matching this signature.
 * Uses generic McpServerLike to avoid a hard dependency on @modelcontextprotocol/sdk.
 */
type ToolRegistrationFn = (server: McpServerLike, registrar: RegisteredToolLike) => void;

/**
 * Abstract MCP server interface — just enough for plugins to register tools.
 * The real McpServer satisfies this interface without plugins importing the SDK directly.
 */
interface McpServerLike {
  readonly tool: (...args: readonly unknown[]) => void;
}

/**
 * Abstract tool registrar interface — provides the define/tools API
 * used by createToolRegistrar in the plugin-sdk.
 */
interface RegisteredToolLike {
  readonly define: (...args: readonly unknown[]) => void;
  readonly tools: ReadonlyMap<string, unknown>;
}

// ---------------------------------------------------------------------------
// Resolved Plugin — fully loaded plugin ready for lifecycle invocation
// ---------------------------------------------------------------------------

/** A fully resolved plugin with extracted lifecycle hooks and tool registration */
interface ResolvedPlugin {
  /** Plugin package name */
  readonly name: string;
  /** Full manifest */
  readonly manifest: PluginManifest;
  /** Trust tier */
  readonly trustTier: TrustTier;
  /** Filesystem path to the plugin's root directory */
  readonly path: string;
  /** Tool registration function (from the plugin's tools module) */
  readonly registerTools: ToolRegistrationFn;
  /** Optional health check evaluator */
  readonly isHealthy?: (response: unknown) => boolean;
  /** Lifecycle hooks (all optional) */
  readonly hooks: {
    readonly onInstall?: (ctx: PluginInstallContext) => void | Promise<void>;
    readonly onUninstall?: (ctx: PluginUninstallContext) => void | Promise<void>;
    readonly onEnable?: (ctx: PluginEnableContext) => void | Promise<void>;
    readonly onDisable?: (ctx: PluginDisableContext) => void | Promise<void>;
    readonly onSettingsChange?: (ctx: PluginSettingsChangeContext) => void | Promise<void>;
  };
}

export {
  type PluginLifecycleContext,
  type PluginInstallContext,
  type PluginUninstallContext,
  type PluginEnableContext,
  type PluginDisableContext,
  type PluginSettingsChangeContext,
  type LifecycleHookName,
  type ToolRegistrationFn,
  type McpServerLike,
  type RegisteredToolLike,
  type ResolvedPlugin,
};
