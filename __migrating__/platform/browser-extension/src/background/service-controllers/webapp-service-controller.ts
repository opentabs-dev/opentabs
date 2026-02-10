/**
 * Webapp service controller — unified tab lifecycle, health checks, tool
 * permissions, and request dispatch for all webapp services.
 *
 * Each service is defined by a WebappServiceConfig (produced from plugin
 * manifests by @opentabs/plugin-loader at build time). This single concrete
 * class handles all webapp services without per-service subclasses.
 *
 * Ported from the original chrome-extension/src/background/service-controllers/
 * webapp-service-controller.ts. Key changes:
 * - Imports from @opentabs/core instead of @extension/shared
 * - WebappServiceConfig defined locally (mirrors plugin-loader's shape)
 * - ServiceId / ServiceType are plain strings (no branded types)
 */

import { dispatchToAdapter } from '../adapter-manager.js';
import { MessageTypes, createJsonRpcError, JsonRpcErrorCode, isJsonRpcError } from '@opentabs/core';
import type { ServiceManagerContext, ServiceManager } from '../service-managers/types.js';
import type {
  ConnectionStatus,
  ServiceConnectionStatus,
  JsonRpcRequest,
  JsonRpcResponse,
  ToolPermissions,
} from '@opentabs/core';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Health check definition — the JSON-RPC method + params to send.
 */
interface HealthCheckConfig {
  /** JSON-RPC method (e.g. 'slack.api', 'datadog.api', 'snowflake.healthCheck') */
  readonly method: string;
  /** JSON-RPC params for the health check request */
  readonly params: Record<string, unknown>;
}

/**
 * Declarative configuration for a webapp service controller.
 *
 * Produced from plugin manifests by @opentabs/plugin-loader's
 * manifestToServiceConfigs() at build time. Most services differ only in
 * data (URLs, auth patterns, health check endpoint). Services with unique
 * health-check logic supply an `isHealthy` override.
 */
interface WebappServiceConfig {
  /** Unique service identifier (e.g. 'slack', 'datadog_production') */
  readonly serviceId: string;
  /** Display name for logging and error messages */
  readonly displayName: string;
  /** Base service type / adapter name (e.g. 'datadog' for both production and staging) */
  readonly adapterName: string;
  /** URL patterns for chrome.tabs.query */
  readonly urlPatterns: string[];
  /** Domain substring for URL matching (e.g. '.slack.com') */
  readonly domain: string;
  /** Strings that indicate authentication failure in error messages */
  readonly authErrorPatterns: string[];
  /** Health check configuration */
  readonly healthCheck: HealthCheckConfig;
  /**
   * Custom health check evaluator. Receives the JSON-RPC response and the
   * authErrorPatterns. Return true if the session is healthy.
   *
   * When omitted, the default is used: `!('error' in response)`.
   */
  readonly isHealthy?: (response: JsonRpcResponse, authErrorPatterns: string[]) => boolean;
  /** Override for the "not connected" error message */
  readonly notConnectedMessage?: string;
  /** Override for the "tab not found" error message */
  readonly tabNotFoundMessage?: string;
}

// ============================================================================
// Chrome storage helpers
// ============================================================================

const isChromeStorageAvailable = (): boolean => {
  try {
    return typeof chrome !== 'undefined' && typeof chrome.storage !== 'undefined' && !!chrome.storage.sync;
  } catch {
    return false;
  }
};

// ============================================================================
// Controller
// ============================================================================

class WebappServiceController implements ServiceManager {
  private tabId: number | null = null;
  private toolPermissions: ToolPermissions = {};
  private permissionsListenerSetup = false;

  private readonly connectionStatus: ConnectionStatus;
  private readonly ctx: ServiceManagerContext;
  private readonly config: WebappServiceConfig;

  constructor(connectionStatus: ConnectionStatus, ctx: ServiceManagerContext, config: WebappServiceConfig) {
    this.connectionStatus = connectionStatus;
    this.ctx = ctx;
    this.config = config;
    this.initializePermissions();
  }

  // ============================================================================
  // ServiceManager interface
  // ============================================================================

  get serviceId(): string {
    return this.config.serviceId;
  }

  getTabId(): number | null {
    return this.tabId;
  }

  isConnected(): boolean {
    return this.getConnectionStatus().connected;
  }

  getConnectionStatus(): ServiceConnectionStatus {
    return this.connectionStatus.services[this.config.serviceId] ?? { connected: false };
  }

  // ============================================================================
  // Request handling
  // ============================================================================

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const toolId = request.params?.toolId as string | undefined;

    if (!this.isToolEnabled(toolId)) {
      return createJsonRpcError(
        request.id,
        JsonRpcErrorCode.PERMISSION_DENIED,
        `Tool '${toolId}' is disabled. Enable it in the extension settings.`,
      );
    }

    if (!this.tabId) {
      await this.findTab();
    }

    if (!this.tabId) {
      const msg =
        this.config.notConnectedMessage ??
        `No ${this.config.displayName} tab found. Please open ${this.config.displayName} in a browser tab and ensure you are logged in.`;
      return createJsonRpcError(request.id, JsonRpcErrorCode.NOT_CONNECTED, msg);
    }

    try {
      return await this.dispatch(this.tabId, request);
    } catch (err) {
      this.tabId = null;
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes('Cannot access') || msg.includes('No tab with id')) {
        const tabMsg =
          this.config.tabNotFoundMessage ??
          `${this.config.displayName} tab not found. Please open ${this.config.displayName} in a browser tab and try again.`;
        return createJsonRpcError(request.id, JsonRpcErrorCode.NOT_CONNECTED, tabMsg);
      }

      return createJsonRpcError(request.id, JsonRpcErrorCode.INTERNAL_ERROR, msg);
    }
  }

  // ============================================================================
  // Health checks
  // ============================================================================

  async checkSession(): Promise<boolean> {
    if (!this.tabId) return false;

    try {
      const response = await this.dispatch(this.tabId, this.buildHealthCheckRequest());

      if (isJsonRpcError(response)) {
        const error = response.error.message || '';
        if (this.isAuthError(error)) {
          // Only trigger disconnect for previously-connected sessions to avoid retry loops
          if (this.getConnectionStatus().connected) {
            console.log(`[OpenTabs] ${this.config.displayName} session expired:`, error);
            await this.handleDisconnect(this.tabId);
          }
        }
        return false;
      }

      if (!this.evaluateHealth(response)) {
        return false;
      }

      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isConnectionError =
        msg.includes('Cannot access') || msg.includes('No tab with id') || msg.includes('Could not establish');

      if (isConnectionError) {
        console.log(`[OpenTabs] ${this.config.displayName} tab not responding (health check failed)`);
        await this.handleDisconnect(this.tabId);
      }

      return false;
    }
  }

  // ============================================================================
  // Tab lifecycle
  // ============================================================================

  async findTabs(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({ url: this.config.urlPatterns });

      for (const tab of tabs) {
        if (!tab.id || !tab.url) continue;
        if (!this.matchesUrl(tab.url)) continue;
        if (this.getConnectionStatus().connected) continue;

        await this.tryConnectTab(tab.id, tab.url);
      }

      await this.ctx.updateBadge();
    } catch (err) {
      console.error(`[OpenTabs] Error finding ${this.config.displayName} tabs:`, err);
    }
  }

  async handleDisconnect(closedTabId?: number): Promise<void> {
    if (closedTabId !== undefined && closedTabId !== this.tabId) {
      return;
    }

    console.log(`[OpenTabs] ${this.config.displayName} tab disconnected, looking for another tab...`);

    try {
      const tabs = await chrome.tabs.query({ url: this.config.urlPatterns });

      for (const tab of tabs) {
        if (!tab.id || !tab.url || tab.id === closedTabId) continue;
        if (!this.matchesUrl(tab.url)) continue;

        const connected = await this.tryConnectTab(tab.id, tab.url);
        if (connected) return;
      }
    } catch (err) {
      console.error(`[OpenTabs] Error finding replacement ${this.config.displayName} tab:`, err);
    }

    console.log(`[OpenTabs] No other ${this.config.displayName} tabs available`);
    this.tabId = null;
    this.setConnectionStatus({ connected: false, tabId: undefined, tabUrl: undefined });
    await this.ctx.updateBadge();
    await this.ctx.saveConnectionState();
  }

  handleTabReady(tabId: number, tabUrl: string): void {
    console.log(`[OpenTabs] ${this.config.displayName} tab ready`);

    this.tabId = tabId;
    this.setConnectionStatus({ tabId, tabUrl });

    this.checkSession().then(valid => {
      if (valid && !this.getConnectionStatus().connected) {
        this.setConnectionStatus({ connected: true, tabId, tabUrl });
        this.ctx.updateBadge();
        this.ctx.saveConnectionState();
      }
    });
  }

  handleTabLoadComplete(tabId: number, url: string): void {
    if (!this.matchesUrl(url)) return;

    if (this.getConnectionStatus().connected && this.tabId === tabId) {
      return;
    }

    if (!this.getConnectionStatus().connected) {
      console.log(`[OpenTabs] ${this.config.displayName} tab finished loading, attempting to connect...`);
      this.tryConnectTabOnLoad(tabId, url);
    }
  }

  async focusTab(): Promise<{ success: boolean; error?: string }> {
    if (this.tabId) {
      chrome.tabs.update(this.tabId, { active: true });
      const tab = await chrome.tabs.get(this.tabId);
      if (tab.windowId) {
        chrome.windows.update(tab.windowId, { focused: true });
      }
      return { success: true };
    }
    return { success: false, error: `No ${this.config.displayName} tab connected` };
  }

  // ============================================================================
  // Private — dispatch, health check, connection status
  // ============================================================================

  private dispatch(tabId: number, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return dispatchToAdapter(tabId, this.config.adapterName, request);
  }

  private buildHealthCheckRequest(): JsonRpcRequest {
    return {
      jsonrpc: '2.0',
      id: `health_${Date.now()}`,
      method: this.config.healthCheck.method,
      params: { ...this.config.healthCheck.params },
    };
  }

  private evaluateHealth(response: JsonRpcResponse): boolean {
    if (this.config.isHealthy) {
      return this.config.isHealthy(response, this.config.authErrorPatterns);
    }
    return !('error' in response);
  }

  private setConnectionStatus(status: Partial<ServiceConnectionStatus>): void {
    const current = this.connectionStatus.services[this.config.serviceId];
    if (current) {
      Object.assign(current, status);
    } else {
      this.connectionStatus.services[this.config.serviceId] = { connected: false, ...status };
    }
  }

  private matchesUrl(url: string): boolean {
    return url.includes(this.config.domain);
  }

  // ============================================================================
  // Private — tab connection helpers
  // ============================================================================

  private async tryConnectTab(tabId: number, tabUrl: string): Promise<boolean> {
    try {
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: MessageTypes.GET_TAB_STATUS,
        serviceId: this.config.serviceId,
      })) as Record<string, unknown> | undefined;

      if (response && !response.error) {
        console.log(`[OpenTabs] Found ${this.config.displayName} tab`);

        this.tabId = tabId;
        this.setConnectionStatus({ connected: false, tabId, tabUrl });

        const valid = await this.checkSession();
        if (valid) {
          this.setConnectionStatus({ connected: true });
          await this.ctx.updateBadge();
          this.ctx.saveConnectionState();
          return true;
        }
      }
    } catch {
      // Content script not ready yet — it will send TAB_READY when initialized
    }
    return false;
  }

  private async tryConnectTabOnLoad(tabId: number, tabUrl: string): Promise<void> {
    try {
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: MessageTypes.GET_TAB_STATUS,
        serviceId: this.config.serviceId,
      })) as Record<string, unknown> | undefined;

      if (response && !response.error) {
        this.handleTabReady(tabId, tabUrl);
      }
    } catch {
      // Content script not ready yet
    }
  }

  private async findTab(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({ url: this.config.urlPatterns });
      const tab = tabs[0];
      if (tab?.id) {
        this.tabId = tab.id;
      }
    } catch (err) {
      console.error(`[${this.config.displayName}] Failed to query tabs:`, err);
    }
  }

  private isAuthError(message: string): boolean {
    return this.config.authErrorPatterns.some(pattern => message.includes(pattern));
  }

  // ============================================================================
  // Tool permissions
  // ============================================================================

  private isToolEnabled(toolId?: string): boolean {
    if (!toolId) return true;
    return this.toolPermissions[toolId] !== false;
  }

  private initializePermissions(): void {
    if (isChromeStorageAvailable()) {
      this.loadToolPermissions();
      this.setupPermissionsListener();
    } else {
      setTimeout(() => {
        if (isChromeStorageAvailable()) {
          this.loadToolPermissions();
          this.setupPermissionsListener();
        }
      }, 100);
    }
  }

  private setupPermissionsListener(): void {
    if (this.permissionsListenerSetup) return;
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes.toolPermissions) {
          this.toolPermissions = (changes.toolPermissions.newValue as ToolPermissions) || {};
          console.log(`[${this.config.displayName}] Tool permissions updated`);
        }
      });
      this.permissionsListenerSetup = true;
    } catch {
      console.debug(`[${this.config.displayName}] Deferred permissions listener setup`);
    }
  }

  private async loadToolPermissions(): Promise<void> {
    try {
      const result = await chrome.storage.sync.get('toolPermissions');
      this.toolPermissions = (result.toolPermissions as ToolPermissions) || {};
    } catch {
      console.debug(`[${this.config.displayName}] Deferred tool permissions load`);
    }
  }
}

export { WebappServiceController };
export type { WebappServiceConfig };
