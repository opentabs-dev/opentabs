import { sendToServer } from './messaging.js';

/**
 * JSON-RPC request/response correlator for background → MCP server communication.
 *
 * The background script uses sendServerRequest() to send JSON-RPC requests to
 * the MCP server and receive responses as promises. Each request gets a unique
 * integer ID; consumeServerResponse() matches incoming responses to pending
 * requests by ID.
 *
 * This replaces the side panel's bridge.ts sendRequest relay — mutations now
 * flow through the background script directly, keeping the side panel decoupled
 * from the WebSocket.
 */

const REQUEST_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timerId: ReturnType<typeof setTimeout>;
}

/** Map of request ID → pending request. Responses are matched by ID. */
const pendingRequests = new Map<number, PendingRequest>();

/** Monotonically increasing request ID counter */
let nextId = 1;

/**
 * Send a JSON-RPC request to the MCP server via the offscreen WebSocket
 * and return a promise that resolves with the response result or rejects
 * with the response error. Times out after 30 seconds.
 */
const sendServerRequest = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
  const id = nextId++;
  const data = { jsonrpc: '2.0', method, params, id };

  return new Promise<unknown>((resolve, reject) => {
    const timerId = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timerId });
    sendToServer(data);
  });
};

/**
 * Check if an incoming message is a response to a pending request.
 * If it matches (by id), resolves or rejects the promise and returns true.
 * Returns false if the message is not a response or doesn't match any pending request.
 */
const consumeServerResponse = (data: Record<string, unknown>): boolean => {
  // Responses have an id but no method
  if (data.method !== undefined) return false;

  const rawId = data.id;
  if (rawId === undefined || rawId === null) return false;

  const id = typeof rawId === 'number' ? rawId : undefined;
  if (id === undefined) return false;

  const pending = pendingRequests.get(id);
  if (!pending) return false;

  pendingRequests.delete(id);
  clearTimeout(pending.timerId);

  if (data.error !== undefined && data.error !== null) {
    const err = data.error as { message?: string };
    pending.reject(new Error(err.message ?? 'Unknown server error'));
  } else {
    pending.resolve(data.result);
  }

  return true;
};

/**
 * Reject all pending requests immediately. Called on WebSocket disconnect
 * so handlers get fast errors instead of waiting for individual 30s timeouts.
 */
const rejectAllPendingServerRequests = (): void => {
  for (const [id, pending] of pendingRequests) {
    pendingRequests.delete(id);
    clearTimeout(pending.timerId);
    pending.reject(new Error('Server disconnected'));
  }
};

export { consumeServerResponse, rejectAllPendingServerRequests, sendServerRequest };
