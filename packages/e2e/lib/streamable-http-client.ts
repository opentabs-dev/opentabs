/**
 * Streamable HTTP MCP Test Client
 *
 * A test client that connects via the Streamable HTTP transport (POST /mcp),
 * supports listening for server-initiated notifications via GET /mcp SSE stream,
 * and provides helpers for initializing sessions, listing tools, and calling tools.
 *
 * This is the recommended MCP transport and simulates what Claude Code does.
 */

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface StreamableHttpClient {
  /** Initialize the MCP session with the server */
  initialize: () => Promise<string>;
  /** List all available tools */
  listTools: () => Promise<McpToolInfo[]>;
  /** Call a tool by name with arguments */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Open the SSE notification stream to receive server-push notifications */
  openNotificationStream: () => Promise<void>;
  /** Wait for a specific notification method (e.g., 'notifications/tools/list_changed') */
  waitForNotification: (method: string, timeoutMs?: number) => Promise<McpNotification>;
  /** Get all received notifications so far */
  getNotifications: () => McpNotification[];
  /** Close the notification stream and clean up */
  close: () => void;
  /** Get the session ID (available after initialize) */
  getSessionId: () => string | null;
}

/**
 * Parse SSE data from a response body chunk.
 * Returns an array of parsed JSON messages from "data:" lines.
 */
const parseSseData = (text: string): unknown[] => {
  const results: unknown[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        results.push(JSON.parse(line.slice(6)));
      } catch {
        // Ignore parse errors
      }
    }
  }
  return results;
};

const createStreamableHttpClient = (httpPort: number): StreamableHttpClient => {
  const baseUrl = `http://127.0.0.1:${httpPort}`;
  let sessionId: string | null = null;
  let requestId = 0;
  let abortController: AbortController | null = null;
  const notifications: McpNotification[] = [];
  const notificationWaiters: Array<{ method: string; resolve: (n: McpNotification) => void }> = [];

  const sendRequest = async (method: string, params?: unknown): Promise<{ result?: unknown; error?: unknown }> => {
    const id = ++requestId;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
    }

    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined && { params }),
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
    }

    // Capture session ID from response headers
    const newSessionId = response.headers.get('mcp-session-id');
    if (newSessionId) {
      sessionId = newSessionId;
    }

    const body = await response.text();
    const contentType = response.headers.get('content-type') || '';

    // SSE response: parse "data:" lines
    if (contentType.includes('text/event-stream')) {
      const messages = parseSseData(body);
      const responseMsg = messages.find((m: unknown) => (m as { id?: number }).id === id) as
        | { result?: unknown; error?: unknown }
        | undefined;
      return responseMsg ?? {};
    }

    // JSON response
    return JSON.parse(body) as { result?: unknown; error?: unknown };
  };

  const initialize = async (): Promise<string> => {
    await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: true } },
      clientInfo: { name: 'e2e-test-client', version: '1.0' },
    });

    if (!sessionId) {
      throw new Error('No session ID received from server');
    }

    // Send initialized notification
    await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    return sessionId;
  };

  const listTools = async (): Promise<McpToolInfo[]> => {
    const response = await sendRequest('tools/list');
    const result = response.result as { tools: McpToolInfo[] } | undefined;
    return result?.tools ?? [];
  };

  const callTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const response = await sendRequest('tools/call', { name, arguments: args });
    if (response.error) {
      throw new Error(`Tool call error: ${JSON.stringify(response.error)}`);
    }
    return response.result;
  };

  const handleNotification = (notification: McpNotification): void => {
    notifications.push(notification);
    // Resolve any waiters for this notification method
    const idx = notificationWaiters.findIndex(w => w.method === notification.method);
    if (idx >= 0) {
      const waiter = notificationWaiters.splice(idx, 1)[0];
      waiter.resolve(notification);
    }
  };

  const openNotificationStream = async (): Promise<void> => {
    if (!sessionId) {
      throw new Error('Must initialize before opening notification stream');
    }

    abortController = new AbortController();

    // Start reading the SSE stream in the background
    const streamPromise = (async (): Promise<void> => {
      try {
        const response = await fetch(`${baseUrl}/mcp`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'mcp-session-id': sessionId!,
          },
          signal: abortController!.signal,
        });

        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE events
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const messages = parseSseData(part);
            for (const msg of messages) {
              const notification = msg as McpNotification;
              if (notification.method && !('id' in notification)) {
                handleNotification(notification);
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          // Unexpected error
          console.error('[StreamableHttpClient] SSE stream error:', err);
        }
      }
    })();

    // Don't await the stream — it runs in the background
    void streamPromise;

    // Give the stream a moment to connect
    await new Promise(resolve => setTimeout(resolve, 200));
  };

  const waitForNotification = (method: string, timeoutMs = 10000): Promise<McpNotification> => {
    // Check if we already have a matching notification
    const existing = notifications.find(n => n.method === method);
    if (existing) {
      notifications.splice(notifications.indexOf(existing), 1);
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = notificationWaiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) notificationWaiters.splice(idx, 1);
        reject(new Error(`Timeout waiting for notification "${method}" after ${timeoutMs}ms`));
      }, timeoutMs);

      notificationWaiters.push({
        method,
        resolve: (n: McpNotification) => {
          clearTimeout(timeout);
          resolve(n);
        },
      });
    });
  };

  return {
    initialize,
    listTools,
    callTool,
    openNotificationStream,
    waitForNotification,
    getNotifications: () => [...notifications],
    close: () => {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
    },
    getSessionId: () => sessionId,
  };
};

export { createStreamableHttpClient };
export type { StreamableHttpClient, McpToolInfo, McpNotification };
