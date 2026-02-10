// Message types for WebSocket communication between MCP server and Chrome extension
//
// Ported from packages/mcp-server/src/types.ts — adapted to use @opentabs/core
// for JSON-RPC types instead of @extension/shared.

import type { JsonRpcRequest, JsonRpcResponse } from '@opentabs/core';

// Re-export JSON-RPC types from @opentabs/core
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcSuccessResponse, JsonRpcErrorResponse } from '@opentabs/core';
export {
  JsonRpcErrorCode,
  createJsonRpcError,
  isJsonRpcError,
  isJsonRpcRequest,
  isJsonRpcResponse,
} from '@opentabs/core';

// Special command message types (non-JSON-RPC)

export interface OpenServerFolder {
  type: 'open_server_folder';
}

// WebSocket message union type
export type WebSocketMessage = JsonRpcRequest | JsonRpcResponse | OpenServerFolder;
