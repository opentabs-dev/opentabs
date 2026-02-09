// Message types for WebSocket communication between MCP server and Chrome extension

// Import JSON-RPC types from shared
import type { JsonRpcRequest, JsonRpcResponse } from '@extension/shared';

// Re-export JSON-RPC types
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcSuccessResponse, JsonRpcErrorResponse } from '@extension/shared';
export {
  JsonRpcErrorCode,
  createJsonRpcError,
  isJsonRpcError,
  isJsonRpcRequest,
  isJsonRpcResponse,
} from '@extension/shared';

// Special command message types (non-JSON-RPC)

export interface OpenServerFolder {
  type: 'open_server_folder';
}

// WebSocket message union type
export type WebSocketMessage = JsonRpcRequest | JsonRpcResponse | OpenServerFolder;
