// WebSocket relay between MCP server and Chrome extension
//
// Ported from packages/mcp-server/src/websocket-relay.ts — adapted to use
// dynamic service registry from @opentabs/core instead of static constants
// from @extension/shared. Service timeouts, display names, and URLs are now
// looked up at call time from the dynamic registry populated by plugins.

import { isJsonRpcResponse, isJsonRpcError } from './types.js';
import { getServiceTimeouts, getServiceDisplayNames, getServiceUrl } from '@opentabs/core';
import open from 'open';
import { WebSocketServer, WebSocket } from 'ws';
import { dirname } from 'node:path';
import type { JsonRpcRequest, JsonRpcResponse, WebSocketMessage } from './types.js';

const DEFAULT_PORT = 8765;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 10000; // 10 seconds to respond

/** Default timeout for native services (browser, system) */
const NATIVE_TIMEOUT_MS = 10000;
const NATIVE_NOT_CONNECTED_ERROR =
  'Chrome extension not connected. Please ensure the OpenTabs extension is installed and active.';

/** Default timeout for webapp services not in the registry */
const DEFAULT_SERVICE_TIMEOUT_MS = 30000;

class WebSocketRelay {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }> =
    new Map();
  private requestIdCounter = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private isAlive = false;
  private port: number = DEFAULT_PORT;
  private serverPath: string = process.argv[1] || process.cwd();

  start(port: number = DEFAULT_PORT): Promise<void> {
    this.port = port;
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' });

        this.wss.on('connection', ws => {
          console.error('[MCP] Chrome extension connected');

          // Close existing client if any
          if (this.client && this.client.readyState === WebSocket.OPEN) {
            console.error('[MCP] Closing previous connection');
            this.client.close();
          }

          this.client = ws;
          this.isAlive = true;
          this.startHeartbeat();

          // Send server info to the extension when it connects
          this.sendServerInfo();

          ws.on('message', data => {
            this.handleMessage(data.toString());
          });

          ws.on('pong', () => {
            this.isAlive = true;
            if (this.heartbeatTimeout) {
              clearTimeout(this.heartbeatTimeout);
              this.heartbeatTimeout = null;
            }
          });

          ws.on('close', () => {
            console.error('[MCP] Chrome extension disconnected');
            this.cleanup();
          });

          ws.on('error', err => {
            console.error('[MCP] WebSocket error:', err.message);
          });
        });

        this.wss.on('listening', () => {
          console.error(`[MCP] WebSocket server listening on ws://127.0.0.1:${this.port}`);
          resolve();
        });

        this.wss.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            console.error(`[MCP] Port ${this.port} is already in use. Is another MCP server running?`);
          } else {
            console.error('[MCP] WebSocket server error:', err.message);
          }
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  stop(): void {
    this.stopHeartbeat();
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN && this.isAlive;
  }

  /**
   * Check if the WebSocket server is listening.
   * Used by hot reload to avoid re-binding the port.
   */
  isStarted(): boolean {
    return this.wss !== null;
  }

  private sendServerInfo(): void {
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      const serverInfo = {
        type: 'server_info',
        serverPath: this.serverPath,
      };
      this.client.send(JSON.stringify(serverInfo));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (!this.client || this.client.readyState !== WebSocket.OPEN) {
        return;
      }

      if (!this.isAlive) {
        // No response to previous ping, connection is stale
        console.error('[MCP] Connection stale, closing...');
        this.client.terminate();
        return;
      }

      this.isAlive = false;
      this.client.ping();

      // Set timeout for pong response
      this.heartbeatTimeout = setTimeout(() => {
        if (!this.isAlive && this.client) {
          console.error('[MCP] Heartbeat timeout, closing connection...');
          this.client.terminate();
        }
      }, HEARTBEAT_TIMEOUT);
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    this.client = null;
    this.isAlive = false;

    // Reject all pending requests
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Handle incoming WebSocket messages.
   * Supports JSON-RPC responses and special commands.
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WebSocketMessage;

      // Handle JSON-RPC responses
      if (isJsonRpcResponse(message)) {
        this.resolveJsonRpcResponse(message);
        return;
      }

      // Handle special commands (not JSON-RPC)
      if ('type' in message && message.type === 'open_server_folder') {
        this.openServerFolder();
      }
    } catch (err) {
      console.error('[MCP] Failed to parse message:', err);
    }
  }

  /**
   * Resolve a pending JSON-RPC request.
   */
  private resolveJsonRpcResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      if (isJsonRpcError(response)) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
      this.pendingRequests.delete(response.id);
    }
  }

  private openServerFolder(): void {
    const folderPath = dirname(this.serverPath);
    open(folderPath).catch(err => {
      console.error('[MCP] Failed to open folder:', err);
    });
  }

  // ============================================================================
  // Core request method — single implementation for all JSON-RPC sends
  // ============================================================================

  /**
   * Send a JSON-RPC request to the Chrome extension and wait for a response.
   * All public send methods delegate here.
   */
  private async sendRequest<T>(
    idPrefix: string,
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
    notConnectedError: string,
  ): Promise<T> {
    if (!this.isConnected()) {
      throw new Error(notConnectedError);
    }

    const id = `${idPrefix}_${++this.requestIdCounter}`;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params && { params }),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out after ${timeoutMs / 1000} seconds`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: value => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: reason => {
          clearTimeout(timeout);
          reject(reason);
        },
      });

      this.client!.send(JSON.stringify(request));
    });
  }

  // ============================================================================
  // Webapp service methods
  // ============================================================================

  /**
   * Send a request to any webapp service adapter.
   * The JSON-RPC method is `{service}.{action}` (default action: "api").
   *
   * Service timeouts and display names are looked up from the dynamic registry
   * populated by plugins at startup. Falls back to a default timeout if the
   * service is not found in the registry.
   */
  async sendServiceRequest<T>(service: string, params: Record<string, unknown>, action: string = 'api'): Promise<T> {
    const timeouts = getServiceTimeouts();
    const displayNames = getServiceDisplayNames();
    const timeoutMs = timeouts[service] ?? DEFAULT_SERVICE_TIMEOUT_MS;
    const displayName = displayNames[service] ?? service;
    const serviceUrl = getServiceUrl(service);

    return this.sendRequest<T>(
      service,
      `${service}.${action}`,
      params,
      timeoutMs,
      `Chrome extension not connected. Please open ${displayName} (${serviceUrl}) in Chrome with the extension installed.`,
    );
  }

  /**
   * Send a request to Slack's Enterprise Edge API (separate routing from standard API).
   */
  async sendSlackEdgeRequest(endpoint: string, params: Record<string, unknown>, toolId?: string): Promise<unknown> {
    const timeouts = getServiceTimeouts();
    const displayNames = getServiceDisplayNames();
    const timeoutMs = timeouts['slack'] ?? DEFAULT_SERVICE_TIMEOUT_MS;
    const displayName = displayNames['slack'] ?? 'Slack';
    const serviceUrl = getServiceUrl('slack');

    return this.sendRequest<unknown>(
      'slack',
      'slack.edgeApi',
      { endpoint, params, toolId },
      timeoutMs,
      `Chrome extension not connected. Please open ${displayName} (${serviceUrl}) in Chrome with the extension installed.`,
    );
  }

  // ============================================================================
  // Native service methods (browser, system)
  // ============================================================================

  async sendBrowserRequest<T>(action: string, params?: Record<string, unknown>): Promise<T> {
    return this.sendRequest<T>('browser', `browser.${action}`, params, NATIVE_TIMEOUT_MS, NATIVE_NOT_CONNECTED_ERROR);
  }

  async reloadExtension(): Promise<{ reloading: boolean }> {
    return this.sendRequest<{ reloading: boolean }>(
      'system',
      'system.reload',
      undefined,
      NATIVE_TIMEOUT_MS,
      NATIVE_NOT_CONNECTED_ERROR,
    );
  }
}

// Persist the relay singleton across bun --hot reloads via globalThis.
// On first load, a new instance is created. On subsequent hot reloads,
// the existing instance (with its WebSocket connections) is reused but
// its prototype is updated to the fresh class definition so that any
// new or changed methods take effect immediately.
const relay: WebSocketRelay = globalThis.__openTabsHotState?.relay ?? new WebSocketRelay();
Object.setPrototypeOf(relay, WebSocketRelay.prototype);

export { DEFAULT_PORT, WebSocketRelay, relay };
