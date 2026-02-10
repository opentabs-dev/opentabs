// ---------------------------------------------------------------------------
// WebSocket Relay — bidirectional communication with the Chrome extension
// ---------------------------------------------------------------------------

import { WebSocketServer } from 'ws';
import type {
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
} from '@opentabs/core';
import type { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExtensionStatus = 'connected' | 'disconnected';

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// WebSocketRelay class
// ---------------------------------------------------------------------------

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

class WebSocketRelay {
  private wss: WebSocketServer | undefined;
  private extensionSocket: WebSocket | undefined;
  private pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private nextRequestId = 1;

  /** Current extension connection status */
  get extensionStatus(): ExtensionStatus {
    return this.extensionSocket !== undefined && this.extensionSocket.readyState === this.extensionSocket.OPEN
      ? 'connected'
      : 'disconnected';
  }

  /** Start the WebSocket server on the given port */
  start(port: number): void {
    if (this.wss !== undefined) {
      console.log(`[ws-relay] WebSocket server already running`);
      return;
    }

    this.wss = new WebSocketServer({ port });

    this.wss.on('listening', () => {
      console.log(`[ws-relay] WebSocket server listening on ws://127.0.0.1:${port}`);
    });

    this.wss.on('connection', (socket: WebSocket) => {
      console.log('[ws-relay] Extension connected');

      if (this.extensionSocket !== undefined) {
        console.log('[ws-relay] Replacing existing extension connection');
        this.extensionSocket.close();
      }

      this.extensionSocket = socket;

      socket.on('message', (data: Buffer | string) => {
        this.handleMessage(data);
      });

      socket.on('close', () => {
        console.log('[ws-relay] Extension disconnected');
        if (this.extensionSocket === socket) {
          this.extensionSocket = undefined;
        }
        this.rejectAllPending('Extension disconnected');
      });

      socket.on('error', (err: Error) => {
        console.error('[ws-relay] WebSocket error:', err.message);
      });
    });

    this.wss.on('error', (err: Error) => {
      console.error('[ws-relay] Server error:', err.message);
    });
  }

  /**
   * Send a request to a webapp service through the extension.
   * The extension routes the request to the matching tab's adapter.
   */
  sendServiceRequest(service: string, params: Record<string, unknown>, action?: string): Promise<unknown> {
    const method = action !== undefined ? `${service}.${action}` : service;
    return this.sendRequest(method, params);
  }

  /**
   * Send a request to the browser via chrome.* APIs through the extension.
   * Routes to the extension's browser controller.
   */
  sendBrowserRequest(action: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.sendRequest(`browser.${action}`, params);
  }

  /** Send a reload command to the extension (triggers chrome.runtime.reload) */
  async reloadExtension(): Promise<void> {
    await this.sendRequest('system.reload_extension');
  }

  /**
   * Send a fire-and-forget message to the extension (no response expected).
   * Used for events like tool_invocation_start/end.
   */
  notify(method: string, params?: Record<string, unknown>): void {
    if (this.extensionSocket === undefined || this.extensionSocket.readyState !== this.extensionSocket.OPEN) {
      return;
    }

    const message: Omit<JsonRpcRequest, 'id'> = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };

    this.extensionSocket.send(JSON.stringify(message));
  }

  /** Shut down the WebSocket server and reject all pending requests */
  async close(): Promise<void> {
    this.rejectAllPending('WebSocket relay shutting down');

    if (this.extensionSocket !== undefined) {
      this.extensionSocket.close();
      this.extensionSocket = undefined;
    }

    if (this.wss !== undefined) {
      await new Promise<void>(resolve => {
        this.wss!.close(() => {
          resolve();
        });
      });
      this.wss = undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Private methods
  // -------------------------------------------------------------------------

  /** Send a JSON-RPC request to the extension and return a Promise of the response */
  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (this.extensionSocket === undefined || this.extensionSocket.readyState !== this.extensionSocket.OPEN) {
        reject(new Error('Extension not connected'));
        return;
      }

      const id = this.nextRequestId++;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      };

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out: ${method} (id=${id})`));
      }, DEFAULT_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timer });

      this.extensionSocket.send(JSON.stringify(request));
    });
  }

  /** Handle an incoming message from the extension */
  private handleMessage(data: Buffer | string): void {
    const raw = typeof data === 'string' ? data : data.toString('utf-8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      console.error('[ws-relay] Failed to parse message:', raw.slice(0, 200));
      return;
    }

    const msg = parsed as Record<string, unknown>;

    if (msg['id'] !== undefined && (msg['result'] !== undefined || msg['error'] !== undefined)) {
      this.handleResponse(msg as unknown as JsonRpcResponse);
      return;
    }

    // Non-RPC event messages (e.g., tab state updates) will be handled in future stories
  }

  /** Handle a JSON-RPC response that resolves a pending request */
  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending === undefined) {
      console.warn(`[ws-relay] Received response for unknown request id=${String(response.id)}`);
      return;
    }

    this.pendingRequests.delete(response.id);
    clearTimeout(pending.timer);

    if ('error' in response) {
      const errResp = response as JsonRpcErrorResponse;
      pending.reject(new Error(errResp.error.message));
    } else {
      const successResp = response as JsonRpcSuccessResponse;
      pending.resolve(successResp.result);
    }
  }

  /** Reject all pending requests with an error */
  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Hot-reload-safe singleton via globalThis
// ---------------------------------------------------------------------------

const RELAY_KEY = '__opentabs_ws_relay__';

/**
 * Retrieve the existing relay singleton from globalThis, or create a new one.
 * On hot reload, the prototype is updated to the fresh class definition so
 * new/changed methods take effect immediately while preserving state
 * (pending requests, connection, WebSocket server).
 */
const getOrCreateRelay = (): WebSocketRelay => {
  const g = globalThis as Record<string, unknown>;
  const existing = g[RELAY_KEY] as WebSocketRelay | undefined;

  if (existing !== undefined) {
    Object.setPrototypeOf(existing, WebSocketRelay.prototype);
    return existing;
  }

  const relay = new WebSocketRelay();
  g[RELAY_KEY] = relay;
  return relay;
};

/** Module-level relay singleton — persists across hot reloads */
const relay = getOrCreateRelay();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { WebSocketRelay, relay, type ExtensionStatus };
