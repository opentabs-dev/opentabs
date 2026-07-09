/**
 * Persistent WebSocket transport to the MCP server.
 *
 * This module owns the full connection lifecycle — connect, exponential-backoff
 * reconnect, ping/pong keepalive, inbound-message validation, and outbound send.
 * It is platform-neutral: it talks to its surrounding extension context only
 * through the injected {@link TransportHost}.
 *
 * Two contexts host this transport:
 *
 * - **Chrome**: an offscreen document (`src/offscreen/index.ts`) runs the
 *   transport because a Manifest V3 service worker cannot hold a long-lived
 *   WebSocket. The host relays inbound messages and state to the background
 *   service worker via `chrome.runtime.sendMessage`.
 * - **Firefox**: the background event page runs the transport directly
 *   (`src/transport/firefox-background-transport.ts`), since Firefox event
 *   pages can hold a long-lived WebSocket and Firefox has no offscreen API.
 *
 * Reconnection: exponential backoff (1s → 2s → … → 3s cap), resets on success.
 * Keepalive: sends ping every 15s; if no pong within 5s, the connection is
 *            considered dead and force-closed to trigger reconnect. This detects
 *            zombie connections caused by server hot reload where the TCP socket
 *            stays alive but the server-side handler has been replaced.
 *
 * The WebSocket URL defaults to ws://127.0.0.1:9515/ws. The port is configurable
 * by the host (read from chrome.storage.local in both contexts).
 */

import {
  buildWsUrl,
  DEFAULT_SERVER_PORT,
  WS_CLOSE_AUTH_FAILED,
  WS_CLOSE_PONG_TIMEOUT,
  WS_INFO_TIMEOUT_MS,
} from '../constants.js';
import type { DisconnectReason } from '../extension-messages.js';
import { ALL_ALLOWED_METHODS } from '../known-methods.js';
import { isValidWsOrigin, wsToHttpBase } from '../offscreen/ws-utils.js';

const DEFAULT_MCP_SERVER_URL = buildWsUrl(DEFAULT_SERVER_PORT);
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 3000;
const BACKOFF_MULTIPLIER = 2;

// Ping/pong keepalive — tuned for fast zombie detection during hot reload
const PING_INTERVAL_MS = 15_000; // Send ping every 15s
const PONG_TIMEOUT_MS = 5_000; // Expect pong within 5s or connection is dead

/**
 * Allowlist of expected JSON-RPC methods from the MCP server.
 * Messages with methods not in this set (and without an `id` response field)
 * are dropped to prevent forwarding unexpected payloads to the consumer.
 *
 * Derived from ALL_ALLOWED_METHODS in known-methods.ts — the single source of
 * truth for all recognized WebSocket methods.
 */
const ALLOWED_METHODS = new Set<string>(ALL_ALLOWED_METHODS);

/** Connection state surfaced to the host on every transition. */
export interface WsConnectionState {
  connected: boolean;
  disconnectReason?: DisconnectReason;
}

/**
 * Platform glue the transport needs from its surrounding extension context.
 * The transport never touches `chrome.*` APIs directly — every side effect
 * that differs between the Chrome offscreen document and the Firefox
 * background page goes through this interface.
 */
export interface TransportHost {
  /** Deliver a validated inbound JSON-RPC message to the consumer (background). */
  deliverMessage(msg: Record<string, unknown>): void;
  /** Notify the consumer of a connection-state transition. */
  notifyState(state: WsConnectionState): void;
  /**
   * Read the current shared secret (from auth.json). Called before each
   * connection attempt and on 401 retry so secret rotation is picked up
   * automatically. Returns the secret, or null if unavailable.
   */
  loadSecret(): Promise<string | null>;
  /**
   * Load the initial server URL and connection ID. Called once at startup.
   * Both are read from chrome.storage.local by the host.
   */
  loadInitialConfig(): Promise<{ url?: string; connectionId?: string }>;
}

/** Result of a {@link WsTransport.send} call. */
export interface SendResult {
  sent: boolean;
  reason?: string;
}

/** Result of a {@link WsTransport.setUrl} call. */
export interface SetUrlResult {
  ok: boolean;
  reason?: string;
}

export class WsTransport {
  private readonly host: TransportHost;

  private mcpServerUrl = DEFAULT_MCP_SERVER_URL;
  /** WebSocket auth token — sent via Sec-WebSocket-Protocol header, not URL query */
  private wsSecret: string | null = null;
  private ws: WebSocket | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private pingIntervalId: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private pongWatchdogId: ReturnType<typeof setTimeout> | null = null;
  private awaitingPong = false;
  /** Guard flag to prevent double reconnect when pong watchdog triggers ws.close() */
  private reconnectScheduledByWatchdog = false;
  /** Guard flag to prevent concurrent connect() calls during the async refreshWsUrl phase */
  private connecting = false;
  /** Tracks why the last connection attempt failed, for side panel error state display */
  private lastDisconnectReason: DisconnectReason | undefined;
  /** Stable connection ID per extension installation — sent in WebSocket subprotocol header */
  private connectionId: string | null = null;

  constructor(host: TransportHost) {
    this.host = host;
  }

  /**
   * Bootstrap the secret and initial config from the host, then connect.
   * Call exactly once after construction.
   */
  async start(): Promise<void> {
    this.wsSecret = await this.host.loadSecret();

    try {
      const config = await this.host.loadInitialConfig();
      if (config.url && typeof config.url === 'string' && config.url !== this.mcpServerUrl) {
        this.mcpServerUrl = config.url;
      }
      if (config.connectionId && typeof config.connectionId === 'string') {
        this.connectionId = config.connectionId;
      }
    } catch {
      // Config not ready — use URL from secret bootstrap or default
    }

    console.log(`[opentabs:transport] Connecting to ${this.mcpServerUrl}`);
    void this.connect();
  }

  /** Send a JSON-RPC message to the server. Returns whether it was sent. */
  send(data: unknown): SendResult {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (err) {
        const method =
          typeof data === 'object' && data !== null ? (data as Record<string, unknown>).method : undefined;
        console.error('[opentabs:transport] Failed to serialize message for WebSocket:', method, err);
      }
      return { sent: true };
    }
    return { sent: false, reason: 'not connected' };
  }

  /** Current connection state. */
  getState(): WsConnectionState {
    const isConnected = this.ws?.readyState === WebSocket.OPEN;
    return {
      connected: isConnected,
      disconnectReason: isConnected ? undefined : this.lastDisconnectReason,
    };
  }

  /**
   * Validate and apply a new server URL, then reconnect. The raw URL is
   * resolved against /ws-info and origin-checked before use.
   */
  async setUrl(rawUrl: string): Promise<SetUrlResult> {
    // Validate URL format and protocol before using it
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
        console.warn(`[opentabs:transport] Rejected setUrl with invalid protocol: ${parsed.protocol}`);
        return { ok: false, reason: 'Invalid WebSocket protocol' };
      }
    } catch {
      console.warn('[opentabs:transport] Rejected setUrl: invalid URL format');
      return { ok: false, reason: 'Invalid URL format' };
    }

    const httpBase = wsToHttpBase(rawUrl);
    let resolvedUrl = rawUrl;
    const result = await this.fetchWsInfo(httpBase);
    if ('response' in result && result.response.ok) {
      let wsInfo: { wsUrl?: string };
      try {
        wsInfo = (await result.response.json()) as { wsUrl?: string };
      } catch {
        console.warn('[opentabs:transport] Failed to parse /ws-info response as JSON');
        return { ok: false, reason: 'Invalid /ws-info response' };
      }
      if (typeof wsInfo.wsUrl === 'string' && wsInfo.wsUrl !== '') {
        if (isValidWsOrigin(wsInfo.wsUrl, httpBase)) {
          resolvedUrl = wsInfo.wsUrl;
        } else {
          return { ok: false, reason: 'WebSocket URL origin mismatch' };
        }
      } else if (typeof wsInfo.wsUrl === 'string') {
        console.warn('[opentabs:transport] /ws-info returned empty wsUrl, using fallback URL');
      }
    }
    if (!isValidWsOrigin(resolvedUrl, httpBase)) {
      return { ok: false, reason: 'WebSocket URL origin mismatch' };
    }
    if (resolvedUrl !== this.mcpServerUrl) {
      console.log(`[opentabs:transport] MCP server URL changed to ${resolvedUrl}`);
      this.mcpServerUrl = resolvedUrl;
      this.disconnectAndReconnect('URL changed');
    }
    return { ok: true };
  }

  /** Force a fresh reconnect (e.g., bg:forceReconnect). */
  forceReconnect(): void {
    this.disconnectAndReconnect('Force reconnect');
  }

  /** Apply a new port (builds the ws URL) and reconnect if it changed. */
  portChanged(port: number): void {
    const newUrl = buildWsUrl(port);
    if (newUrl !== this.mcpServerUrl) {
      console.log(`[opentabs:transport] Port changed to ${port}, reconnecting`);
      this.mcpServerUrl = newUrl;
      this.disconnectAndReconnect('Port changed');
    }
  }

  // --- /ws-info fetch ---

  /**
   * Fetch /ws-info from the MCP server with automatic 401 retry.
   *
   * On 401, re-reads the secret for the latest value and retries once.
   * Returns `{ response }` on success (caller inspects .ok / .status),
   * `{ reason: 'auth_failed' }` on double-401, or
   * `{ reason: 'connection_refused' }` on network error.
   */
  private async fetchWsInfo(httpBase: string): Promise<{ response: Response } | { reason: DisconnectReason }> {
    try {
      const headers: Record<string, string> = {};
      if (this.wsSecret) headers.Authorization = `Bearer ${this.wsSecret}`;
      let res = await fetch(`${httpBase}/ws-info`, {
        headers,
        signal: AbortSignal.timeout(WS_INFO_TIMEOUT_MS),
        cache: 'no-store',
      });
      // 401 means the secret is stale (e.g., server rotated secrets during hot
      // reload). Re-read the secret for the latest value and retry once.
      if (res.status === 401) {
        this.wsSecret = await this.host.loadSecret();
        const retryHeaders: Record<string, string> = {};
        if (this.wsSecret) retryHeaders.Authorization = `Bearer ${this.wsSecret}`;
        res = await fetch(`${httpBase}/ws-info`, {
          headers: retryHeaders,
          signal: AbortSignal.timeout(WS_INFO_TIMEOUT_MS),
          cache: 'no-store',
        });
      }
      if (res.status === 401) return { reason: 'auth_failed' };
      return { response: res };
    } catch {
      return { reason: 'connection_refused' };
    }
  }

  /**
   * Close any active WebSocket connection, cancel any pending reconnect timer,
   * reset backoff, and initiate a fresh connection.
   */
  private disconnectAndReconnect(closeReason: string): void {
    this.backoffMs = INITIAL_BACKOFF_MS;
    this.lastDisconnectReason = undefined;
    if (this.ws) {
      try {
        this.ws.close(1000, closeReason);
      } catch {
        // Already closed
      }
    } else if (this.reconnectTimeoutId !== null) {
      // No active connection and backoff timer is pending — cancel it
      // and connect immediately with the new URL.
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
      void this.connect();
    } else {
      // No active connection and no pending reconnect (backoff exhausted
      // or no connection was ever established) — connect immediately.
      void this.connect();
    }
  }

  // --- Ping/Pong watchdog ---

  private clearPingInterval(): void {
    if (this.pingIntervalId !== null) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  private clearPongWatchdog(): void {
    if (this.pongWatchdogId !== null) {
      clearTimeout(this.pongWatchdogId);
      this.pongWatchdogId = null;
    }
    this.awaitingPong = false;
  }

  /** Called when a pong is received — connection is healthy. */
  private onPongReceived(): void {
    this.clearPongWatchdog();
  }

  /**
   * Send a ping and arm the watchdog.
   * If the watchdog fires before a pong arrives, the connection is dead.
   */
  private sendPing = (): void => {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Don't stack pings — if we're still waiting for a pong from the last
    // ping, the watchdog is already running and will handle it.
    if (this.awaitingPong) return;

    this.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }));
    this.awaitingPong = true;

    // Arm the watchdog: if no pong within PONG_TIMEOUT_MS, kill the connection
    this.pongWatchdogId = setTimeout(() => {
      this.pongWatchdogId = null;

      if (!this.awaitingPong) return; // Pong arrived just in time

      console.warn(
        '[opentabs:transport] Pong timeout — connection is dead (likely server hot reload). Forcing reconnect.',
      );
      this.awaitingPong = false;

      // Force-close the zombie WebSocket. This triggers onclose → reconnect.
      // Set the guard flag so onclose doesn't schedule a second reconnect.
      if (this.ws) {
        this.reconnectScheduledByWatchdog = true;
        try {
          this.ws.close(WS_CLOSE_PONG_TIMEOUT, 'Pong timeout');
        } catch {
          // Already closed
        }
        this.ws = null;
        this.clearPingInterval();
        this.lastDisconnectReason = 'timeout';
        this.host.notifyState({ connected: false, disconnectReason: 'timeout' });
        this.scheduleReconnect();
      }
    }, PONG_TIMEOUT_MS);
  };

  private startPingInterval(): void {
    this.clearPingInterval();
    this.clearPongWatchdog();

    // Send pings on the regular interval (the first ping fires after one
    // interval, giving the server time to send sync.full).
    this.pingIntervalId = setInterval(this.sendPing, PING_INTERVAL_MS);
  }

  // --- Reconnect logic ---

  private scheduleReconnect(): void {
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
    }
    const delay = this.backoffMs;
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      void this.connect();
    }, delay);
    this.backoffMs = Math.min(this.backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
  }

  // --- Token refresh ---

  /**
   * Re-fetch the WebSocket URL and auth secret from /ws-info.
   * Called before each connection attempt so reconnects after secret rotation
   * pick up the new token automatically. Falls back to the current URL on error.
   *
   * Returns the disconnect reason if the server explicitly rejected us
   * (auth_failed) or could not be reached (connection_refused). Returns
   * undefined on success.
   */
  private async refreshWsUrl(): Promise<DisconnectReason | undefined> {
    const httpBase = wsToHttpBase(this.mcpServerUrl);
    const result = await this.fetchWsInfo(httpBase);
    if ('reason' in result) return result.reason;

    const res = result.response;
    if (!res.ok) return 'connection_refused';

    const wsInfo = (await res.json()) as { wsUrl?: string };
    if (typeof wsInfo.wsUrl === 'string' && wsInfo.wsUrl !== '' && wsInfo.wsUrl !== this.mcpServerUrl) {
      if (isValidWsOrigin(wsInfo.wsUrl, httpBase)) {
        this.mcpServerUrl = wsInfo.wsUrl;
      }
    }
    return undefined;
  }

  // --- Connection ---

  private connect = async (): Promise<void> => {
    if (
      this.connecting ||
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    this.connecting = true;
    try {
      this.wsSecret = await this.host.loadSecret();
      const reason = await this.refreshWsUrl();
      if (reason) {
        this.lastDisconnectReason = reason;
        this.host.notifyState({ connected: false, disconnectReason: reason });
        this.scheduleReconnect();
        return;
      }
      // Send auth token and connection ID via Sec-WebSocket-Protocol header (not URL query)
      // to keep them out of server logs, browser history, and proxy logs.
      // Format: ['opentabs', '<secret>', '<connectionId>']
      const protocols: string[] = ['opentabs'];
      if (this.wsSecret) protocols.push(this.wsSecret);
      if (this.connectionId) protocols.push(this.connectionId);
      this.ws = protocols.length > 1 ? new WebSocket(this.mcpServerUrl, protocols) : new WebSocket(this.mcpServerUrl);
    } catch {
      this.lastDisconnectReason = 'connection_refused';
      this.host.notifyState({ connected: false, disconnectReason: 'connection_refused' });
      this.scheduleReconnect();
      return;
    } finally {
      this.connecting = false;
    }

    this.ws.onopen = () => {
      this.backoffMs = INITIAL_BACKOFF_MS; // Reset backoff on success
      this.lastDisconnectReason = undefined;
      this.startPingInterval();
      this.host.notifyState({ connected: true });
    };

    this.ws.onmessage = event => {
      if (typeof event.data !== 'string') {
        console.warn('[opentabs:transport] Received non-string WebSocket message, discarding');
        return;
      }
      const text = event.data;
      try {
        const parsed: unknown = JSON.parse(text);

        if (typeof parsed !== 'object' || parsed === null) return;
        const msg = parsed as Record<string, unknown>;

        // Handle pong — cancel the watchdog, connection is alive
        if (msg.method === 'pong') {
          this.onPongReceived();
          return;
        }

        const method = msg.method as string | undefined;
        const hasId = 'id' in msg;

        // Allow response messages (have id, no method) — these are replies to
        // requests the background script sent to the server (e.g., config.*).
        // Allow request/notification messages only if their method is in the allowlist.
        if (method && !ALLOWED_METHODS.has(method)) {
          console.warn(`[opentabs:transport] Dropping message with unknown method: ${method}`);
          return;
        }

        if (!method && !hasId) {
          console.warn('[opentabs:transport] Dropping message with neither method nor id');
          return;
        }

        this.host.deliverMessage(msg);
      } catch {
        console.warn('[opentabs:transport] Failed to parse WebSocket message as JSON');
      }
    };

    this.ws.onclose = event => {
      // The pong watchdog sets ws = null before calling ws.close(), so onclose
      // fires with ws already null. Skip duplicate cleanup and notification.
      if (!this.ws) {
        this.reconnectScheduledByWatchdog = false;
        return;
      }

      this.ws = null;
      this.clearPingInterval();
      this.clearPongWatchdog();

      // Determine disconnect reason from the WebSocket close code.
      // WS_CLOSE_AUTH_FAILED is sent by the MCP server when authentication fails
      // during the WebSocket handshake (invalid or missing Sec-WebSocket-Protocol token).
      if (event.code === WS_CLOSE_AUTH_FAILED) {
        this.lastDisconnectReason = 'auth_failed';
      } else if (!this.lastDisconnectReason) {
        this.lastDisconnectReason = 'connection_refused';
      }

      this.host.notifyState({ connected: false, disconnectReason: this.lastDisconnectReason });

      // If the pong watchdog already scheduled a reconnect, skip to avoid double scheduling
      if (this.reconnectScheduledByWatchdog) {
        this.reconnectScheduledByWatchdog = false;
        return;
      }

      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror — reconnect handled there
    };
  };
}
