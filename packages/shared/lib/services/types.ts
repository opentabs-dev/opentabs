// Shared types for service integrations

// Re-export all service identity types and constants from the centralized registry
export type { ServiceDefinition, ServiceType, ServiceId, ServiceEnv } from './registry.js';
export {
  SERVICE_REGISTRY,
  SERVICE_IDS,
  SERVICE_TYPES,
  SERVICE_URL_PATTERNS,
  SERVICE_DOMAINS,
  SERVICE_TIMEOUTS,
  SERVICE_DISPLAY_NAMES,
  SINGLE_ENV_SERVICES,
  getServiceType,
  getServiceTypeFromHostname,
  getServiceDefinition,
  getServiceEnv,
  getServiceUrl,
} from './registry.js';

// ============================================================================
// JSON-RPC Types
// ============================================================================

/**
 * JSON-RPC 2.0 request format for all service communications.
 * Used for API calls and script execution across all services.
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 success response format.
 */
export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: string;
  result: unknown;
}

/**
 * JSON-RPC 2.0 error object.
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * JSON-RPC 2.0 error response format.
 */
export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: string;
  error: JsonRpcError;
}

/**
 * JSON-RPC 2.0 response (success or error).
 */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/**
 * Standard JSON-RPC error codes.
 */
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom error codes (reserved: -32000 to -32099)
  NOT_CONNECTED: -32000,
  NOT_AUTHENTICATED: -32001,
  REQUEST_TIMEOUT: -32002,
  PERMISSION_DENIED: -32003,
} as const;

/**
 * Helper to create a JSON-RPC success response.
 */
export const createJsonRpcSuccess = (id: string, result: unknown): JsonRpcSuccessResponse => ({
  jsonrpc: '2.0',
  id,
  result,
});

/**
 * Helper to create a JSON-RPC error response.
 */
export const createJsonRpcError = (
  id: string,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, ...(data !== undefined && { data }) },
});

/**
 * Type guard to check if a response is an error response.
 */
export const isJsonRpcError = (response: JsonRpcResponse): response is JsonRpcErrorResponse => 'error' in response;

/**
 * Type guard to check if a message is a valid JSON-RPC request.
 */
export const isJsonRpcRequest = (msg: unknown): msg is JsonRpcRequest =>
  typeof msg === 'object' &&
  msg !== null &&
  'jsonrpc' in msg &&
  (msg as JsonRpcRequest).jsonrpc === '2.0' &&
  'id' in msg &&
  typeof (msg as JsonRpcRequest).id === 'string' &&
  'method' in msg &&
  typeof (msg as JsonRpcRequest).method === 'string';

/**
 * Type guard to check if a message is a valid JSON-RPC response.
 */
export const isJsonRpcResponse = (msg: unknown): msg is JsonRpcResponse =>
  typeof msg === 'object' &&
  msg !== null &&
  'jsonrpc' in msg &&
  (msg as JsonRpcResponse).jsonrpc === '2.0' &&
  'id' in msg &&
  typeof (msg as JsonRpcResponse).id === 'string' &&
  ('result' in msg || 'error' in msg);

/**
 * Tool permissions map - keys are tool IDs, values are enabled/disabled state
 */
export interface ToolPermissions {
  [toolId: string]: boolean;
}

// ============================================================================
// Connection Status
// ============================================================================

/**
 * Connection status for a single service.
 * All services use this same structure for uniformity.
 */
export interface ServiceConnection {
  connected: boolean;
  tabId?: number;
  tabUrl?: string;
}

/**
 * Overall connection status for all services in the extension.
 * Uses a Record<ServiceId, ServiceConnection> so adding a new service
 * requires zero changes to this interface.
 */
export interface ConnectionStatus {
  /** Whether the MCP WebSocket relay is connected */
  mcpConnected: boolean;
  /** MCP server port */
  port?: number;
  /** Path to MCP server executable */
  serverPath?: string;

  /** Connection status for each service (keyed by ServiceId) */
  services: Record<string, ServiceConnection>;
}
