// Service manager types — adapted for the plugin architecture.
// Uses @opentabs/core types instead of @extension/shared.

import type { JsonRpcRequest, JsonRpcResponse, ServiceConnectionStatus } from '@opentabs/core';

/**
 * Common context needed by service controllers.
 * Passed in to provide dependencies without circular imports.
 *
 * Connection state (tab IDs, connected flags, auth session validity) is
 * never persisted to storage. All connection status is derived at runtime
 * through live queries: findTabs() → checkSession() → handleTabReady().
 */
export interface ServiceManagerContext {
  /** Send data via WebSocket */
  sendViaWebSocket: (data: unknown) => Promise<void>;
  /** Update badge/icon status */
  updateBadge: () => Promise<void>;
}

/**
 * Interface for all service controllers.
 * Each service-environment combination has its own instance.
 */
export interface ServiceManager {
  /** The service ID this manager handles */
  readonly serviceId: string;
  /** Find and connect to existing tabs for this service */
  findTabs: () => Promise<void>;
  /** Handle tab disconnection and find replacement */
  handleDisconnect: (closedTabId?: number) => Promise<void>;
  /** Handle tab ready message from content script */
  handleTabReady: (tabId: number, tabUrl: string) => void;
  /** Handle tab load completion - try to reconnect when a service tab finishes loading */
  handleTabLoadComplete: (tabId: number, url: string) => void;
  /** Focus the connected tab */
  focusTab: () => Promise<{ success: boolean; error?: string }>;
  /** Get the current tab ID */
  getTabId: () => number | null;
  /** Check if connected */
  isConnected: () => boolean;
  /** Run a health check on the service session */
  checkSession: () => Promise<boolean>;
  /** Get the connection status object for this service */
  getConnectionStatus: () => ServiceConnectionStatus;
  /** Handle an incoming JSON-RPC request from MCP */
  handleRequest: (request: JsonRpcRequest) => Promise<JsonRpcResponse>;
}
