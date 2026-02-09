// Shared types for service integrations (Slack, Datadog, etc.)

/**
 * JSON-RPC 2.0 request format for all service communications.
 * Used for API calls and script execution across all services (Slack, Datadog, SQLPad).
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
// Environment Types
// ============================================================================

/** Environment types for multi-environment services (Datadog, SQLPad) */
export type ServiceEnv = 'production' | 'staging';

// ============================================================================
// Service Identifiers - Flat design where each service-environment is distinct
// ============================================================================

/**
 * All service identifiers. Each service-environment combination is a separate service.
 */
export type ServiceId =
  | 'slack'
  | 'datadog_production'
  | 'datadog_staging'
  | 'sqlpad_production'
  | 'sqlpad_staging'
  | 'logrocket'
  | 'retool_production'
  | 'retool_staging'
  | 'snowflake';

/**
 * All service identifiers as an array (useful for iteration).
 */
export const SERVICE_IDS: ServiceId[] = [
  'slack',
  'datadog_production',
  'datadog_staging',
  'sqlpad_production',
  'sqlpad_staging',
  'logrocket',
  'retool_production',
  'retool_staging',
  'snowflake',
];

/** Service type (base service without environment suffix) */
export type ServiceType = 'slack' | 'datadog' | 'sqlpad' | 'logrocket' | 'retool' | 'snowflake';

/**
 * All service types as an array (useful for iteration and validation).
 */
export const SERVICE_TYPES: ServiceType[] = ['slack', 'datadog', 'sqlpad', 'logrocket', 'retool', 'snowflake'];

/**
 * Map from service ID to its base service type (for routing).
 */
export const getServiceType = (serviceId: ServiceId): ServiceType => {
  if (serviceId === 'slack') return 'slack';
  if (serviceId.startsWith('datadog_')) return 'datadog';
  if (serviceId.startsWith('sqlpad_')) return 'sqlpad';
  if (serviceId === 'logrocket') return 'logrocket';
  if (serviceId.startsWith('retool_')) return 'retool';
  if (serviceId === 'snowflake') return 'snowflake';
  return 'slack';
};

/**
 * Get service type from hostname by reverse lookup in SERVICE_DOMAINS.
 * Returns null if hostname doesn't match any known service.
 */
export const getServiceTypeFromHostname = (hostname: string): ServiceType | null => {
  for (const [serviceId, domain] of Object.entries(SERVICE_DOMAINS)) {
    if (hostname.endsWith(domain) || hostname === domain) {
      return getServiceType(serviceId as ServiceId);
    }
  }
  return null;
};

// ============================================================================
// Service URL Patterns - Single source of truth for tab detection
// ============================================================================

/**
 * URL patterns for chrome.tabs.query() by service ID.
 * These patterns mirror the manifest.json content_scripts matches.
 */
export const SERVICE_URL_PATTERNS: Record<ServiceId, string[]> = {
  slack: ['*://*.slack.com/*'],
  datadog_production: ['*://brex-production.datadoghq.com/*'],
  datadog_staging: ['*://brex-staging.datadoghq.com/*'],
  sqlpad_production: ['*://sqlpad.production.brexapps.io/*'],
  sqlpad_staging: ['*://sqlpad.staging.brexapps.io/*'],
  logrocket: ['*://app.logrocket.com/*'],
  retool_production: ['*://retool-v3.infra.brexapps.io/*'],
  retool_staging: ['*://retool-v3.staging.infra.brexapps.io/*'],
  snowflake: ['*://app.snowflake.com/*'],
};

/**
 * Domain identifiers for each service (used for URL matching).
 */
export const SERVICE_DOMAINS: Record<ServiceId, string> = {
  slack: '.slack.com',
  datadog_production: 'brex-production.datadoghq.com',
  datadog_staging: 'brex-staging.datadoghq.com',
  sqlpad_production: 'sqlpad.production.brexapps.io',
  sqlpad_staging: 'sqlpad.staging.brexapps.io',
  logrocket: 'app.logrocket.com',
  retool_production: 'retool-v3.infra.brexapps.io',
  retool_staging: 'retool-v3.staging.infra.brexapps.io',
  snowflake: 'app.snowflake.com',
};

/**
 * Connection status for a single service.
 * All services use this same structure for uniformity.
 */
export interface ServiceConnection {
  connected: boolean;
  tabId?: number;
  tabUrl?: string;
}

// ============================================================================
// Connection Status - Flat structure for all services
// ============================================================================

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
  services: Record<ServiceId, ServiceConnection>;
}
