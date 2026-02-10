// =============================================================================
// JSON-RPC 2.0 Types and Utilities
//
// The wire protocol for all communication between the MCP server, Chrome
// extension background script, and MAIN world adapters. Every message flowing
// through the system is a JSON-RPC 2.0 request or response.
// =============================================================================

// -----------------------------------------------------------------------------
// Request
// -----------------------------------------------------------------------------

/** JSON-RPC 2.0 request. All service communications use this format. */
export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Response
// -----------------------------------------------------------------------------

/** JSON-RPC 2.0 success response. */
export interface JsonRpcSuccessResponse {
  readonly jsonrpc: '2.0';
  readonly id: string;
  readonly result: unknown;
}

/** Structured error payload inside a JSON-RPC error response. */
export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** JSON-RPC 2.0 error response. */
export interface JsonRpcErrorResponse {
  readonly jsonrpc: '2.0';
  readonly id: string;
  readonly error: JsonRpcError;
}

/** JSON-RPC 2.0 response — either success or error. */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// -----------------------------------------------------------------------------
// Standard + Custom Error Codes
// -----------------------------------------------------------------------------

/**
 * JSON-RPC 2.0 standard error codes plus OpenTabs-specific codes in the
 * reserved range -32000 to -32099.
 */
export const JsonRpcErrorCode = {
  // Standard JSON-RPC 2.0 codes
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // OpenTabs custom codes (-32000 to -32099)
  NOT_CONNECTED: -32000,
  NOT_AUTHENTICATED: -32001,
  REQUEST_TIMEOUT: -32002,
  PERMISSION_DENIED: -32003,
} as const;

export type JsonRpcErrorCodeValue = (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

// -----------------------------------------------------------------------------
// Factory Functions
// -----------------------------------------------------------------------------

/** Create a JSON-RPC 2.0 success response. */
export const createJsonRpcSuccess = (id: string, result: unknown): JsonRpcSuccessResponse => ({
  jsonrpc: '2.0',
  id,
  result,
});

/** Create a JSON-RPC 2.0 error response. */
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

// -----------------------------------------------------------------------------
// Type Guards
// -----------------------------------------------------------------------------

/** Check whether a response is an error response. */
export const isJsonRpcError = (response: JsonRpcResponse): response is JsonRpcErrorResponse => 'error' in response;

/** Check whether an unknown value is a valid JSON-RPC 2.0 request. */
export const isJsonRpcRequest = (msg: unknown): msg is JsonRpcRequest =>
  typeof msg === 'object' &&
  msg !== null &&
  'jsonrpc' in msg &&
  (msg as JsonRpcRequest).jsonrpc === '2.0' &&
  'id' in msg &&
  typeof (msg as JsonRpcRequest).id === 'string' &&
  'method' in msg &&
  typeof (msg as JsonRpcRequest).method === 'string';

/** Check whether an unknown value is a valid JSON-RPC 2.0 response. */
export const isJsonRpcResponse = (msg: unknown): msg is JsonRpcResponse =>
  typeof msg === 'object' &&
  msg !== null &&
  'jsonrpc' in msg &&
  (msg as JsonRpcResponse).jsonrpc === '2.0' &&
  'id' in msg &&
  typeof (msg as JsonRpcResponse).id === 'string' &&
  ('result' in msg || 'error' in msg);
