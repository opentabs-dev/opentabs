// MCP message router - handles routing of MCP messages to appropriate service handlers

import {
  MessageTypes,
  isJsonRpcRequest,
  createJsonRpcError,
  createJsonRpcSuccess,
  JsonRpcErrorCode,
  SERVICE_DOMAINS,
  SERVICE_TYPES,
  SINGLE_ENV_SERVICES,
} from '@extension/shared';
import type { BrowserController } from './browser-controller';
import type { ServiceManager, ServiceId } from './service-managers';
import type { JsonRpcRequest, JsonRpcResponse, ServiceType } from '@extension/shared';

interface McpMessageRouterContext {
  managers: Record<ServiceId, ServiceManager>;
  browserController: BrowserController;
  sendViaWebSocket: (data: unknown) => Promise<void>;
  updateBadge: () => Promise<void>;
  connectionStatus: { serverPath?: string };
}

type ManagerResult = { manager: ServiceManager } | { error: string };

/**
 * Get the connected manager for a service type.
 *
 * When `env` is specified, only that environment is tried — no fallback.
 * When `env` is omitted, tries production first, then staging.
 */
const getConnectedManager = (
  serviceType: ServiceType,
  managers: Record<ServiceId, ServiceManager>,
  env?: string,
): ManagerResult => {
  // Single-environment services — direct lookup by service type as service ID
  if (SINGLE_ENV_SERVICES.includes(serviceType)) {
    const manager = managers[serviceType as ServiceId];
    if (manager?.isConnected()) return { manager };
    const serviceName = serviceType.charAt(0).toUpperCase() + serviceType.slice(1);
    return { error: `No ${serviceName} tab connected. Please open a ${serviceName} tab in Chrome.` };
  }

  // Explicit env requested — only try that env, no fallback
  if (env) {
    const serviceId = `${serviceType}_${env}` as ServiceId;
    const manager = managers[serviceId];
    if (manager?.isConnected()) return { manager };

    const domain = SERVICE_DOMAINS[serviceId];
    const serviceName = serviceType.charAt(0).toUpperCase() + serviceType.slice(1);
    return {
      error: `No ${serviceName} ${env} tab connected. Please open https://${domain} in Chrome.`,
    };
  }

  // No env specified — try production first, then staging
  for (const fallbackEnv of ['production', 'staging'] as const) {
    const serviceId = `${serviceType}_${fallbackEnv}` as ServiceId;
    const manager = managers[serviceId];
    if (manager?.isConnected()) return { manager };
  }

  const serviceName = serviceType.charAt(0).toUpperCase() + serviceType.slice(1);
  return { error: `No ${serviceName} tab connected. Please open a ${serviceName} tab in Chrome.` };
};

/**
 * Route a JSON-RPC request to the appropriate service handler.
 */
const routeJsonRpcRequest = async (request: JsonRpcRequest, ctx: McpMessageRouterContext): Promise<JsonRpcResponse> => {
  const { managers, browserController } = ctx;
  const { method, id } = request;

  // Parse the method to determine service and action
  // Format: service.action (e.g., slack.api, datadog.executeScript, system.reload)
  const [service, action] = method.split('.');

  if (!service || !action) {
    return createJsonRpcError(
      id,
      JsonRpcErrorCode.METHOD_NOT_FOUND,
      `Invalid method format: ${method}. Expected format: service.action`,
    );
  }

  // Handle system-level commands
  if (service === 'system') {
    if (action === 'reload') {
      // Respond with success first, then reload after a short delay
      setTimeout(() => chrome.runtime.reload(), 100);
      return createJsonRpcSuccess(id, { reloading: true });
    }
    return createJsonRpcError(id, JsonRpcErrorCode.METHOD_NOT_FOUND, `Unknown system action: ${action}`);
  }

  // Handle browser commands (chrome.tabs/windows APIs, no webapp tab needed)
  if (service === 'browser') {
    return browserController.handleRequest(request);
  }

  // Validate service type against the shared constant
  const serviceType = service as ServiceType;
  if (!SERVICE_TYPES.includes(serviceType)) {
    return createJsonRpcError(id, JsonRpcErrorCode.METHOD_NOT_FOUND, `Unknown service: ${service}`);
  }

  // Get the preferred environment from params (for datadog/sqlpad)
  const env = request.params?.env as string | undefined;

  // Find a connected manager for this service
  const result = getConnectedManager(serviceType, managers, env);

  if ('error' in result) {
    return createJsonRpcError(id, JsonRpcErrorCode.NOT_CONNECTED, result.error);
  }

  return result.manager.handleRequest(request);
};

/**
 * Routes MCP messages to the appropriate service handler.
 * JSON-RPC methods are namespaced by service: slack.*, datadog.*, sqlpad.*
 */
const handleMcpMessage = async (
  message: { type?: string; method?: string; id?: string; [key: string]: unknown },
  ctx: McpMessageRouterContext,
): Promise<void> => {
  const { sendViaWebSocket, updateBadge, connectionStatus } = ctx;

  // Handle JSON-RPC requests
  if (isJsonRpcRequest(message)) {
    const request = message as JsonRpcRequest;
    const response = await routeJsonRpcRequest(request, ctx);
    await sendViaWebSocket(response);
    return;
  }

  // Handle legacy non-JSON-RPC messages (server info, etc.)
  if (message.type === MessageTypes.SERVER_INFO) {
    connectionStatus.serverPath = message.serverPath as string | undefined;
    await updateBadge();
  }
};

export type { McpMessageRouterContext };
export { handleMcpMessage, getConnectedManager, routeJsonRpcRequest };
