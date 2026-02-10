type JsonRpcId = string | number;

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface JsonRpcSuccessResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result: unknown;
}

interface JsonRpcErrorDetail {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

interface JsonRpcErrorResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly error: JsonRpcErrorDetail;
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/** Standard JSON-RPC error codes */
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

type JsonRpcErrorCode = (typeof JSON_RPC_ERRORS)[keyof typeof JSON_RPC_ERRORS];

export {
  JSON_RPC_ERRORS,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcSuccessResponse,
  type JsonRpcErrorDetail,
  type JsonRpcErrorResponse,
  type JsonRpcResponse,
  type JsonRpcErrorCode,
};
