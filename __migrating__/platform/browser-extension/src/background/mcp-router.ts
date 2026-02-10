/**
 * MCP message router — handles routing of MCP messages to appropriate service
 * handlers.
 *
 * Ported from chrome-extension/src/background/mcp-router.ts.
 * Key changes:
 * - Imports from @opentabs/core instead of @extension/shared
 * - Uses dynamic registry getters (getServiceTypes, getServiceDomains,
 *   getSingleEnvServices) instead of static constants
 * - ServiceId / ServiceType are plain strings (no branded types)
 */

import {
  MessageTypes,
  isJsonRpcRequest,
  createJsonRpcError,
  createJsonRpcSuccess,
  JsonRpcErrorCode,
  getServiceTypes,
  getServiceDomains,
  getSingleEnvServices,
} from '@opentabs/core';
import type { BrowserController } from './browser-controller.js';
import type { ServiceManager } from './service-managers/index.js';
import type { JsonRpcRequest, JsonRpcResponse } from '@opentabs/core';

interface McpMessageRouterContext {
  managers: Record<string, ServiceManager>;
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
  serviceType: string,
  managers: Record<string, ServiceManager>,
  env?: string,
): ManagerResult => {
  const singleEnvServices = getSingleEnvServices();
  const serviceDomains = getServiceDomains();

  // Single-environment services — direct lookup by service type as service ID
  if (singleEnvServices.includes(serviceType)) {
    const manager = managers[serviceType];
    if (manager?.isConnected()) return { manager };
    const serviceName = serviceType.charAt(0).toUpperCase() + serviceType.slice(1);
    return { error: `No ${serviceName} tab connected. Please open a ${serviceName} tab in Chrome.` };
  }

  // Explicit env requested — only try that env, no fallback
  if (env) {
    const serviceId = `${serviceType}_${env}`;
    const manager = managers[serviceId];
    if (manager?.isConnected()) return { manager };

    const domain = serviceDomains[serviceId];
    const serviceName = serviceType.charAt(0).toUpperCase() + serviceType.slice(1);
    return {
      error: `No ${serviceName} ${env} tab connected. Please open https://${domain} in Chrome.`,
    };
  }

  // No env specified — try production first, then staging
  for (const fallbackEnv of ['production', 'staging'] as const) {
    const serviceId = `${serviceType}_${fallbackEnv}`;
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

  // Validate service type against the dynamic registry
  const serviceTypes = getServiceTypes();
  if (!serviceTypes.includes(service)) {
    return createJsonRpcError(id, JsonRpcErrorCode.METHOD_NOT_FOUND, `Unknown service: ${service}`);
  }

  // Get the preferred environment from params (for multi-env services)
  const env = request.params?.env as string | undefined;

  // Find a connected manager for this service
  const result = getConnectedManager(service, managers, env);

  if ('error' in result) {
    return createJsonRpcError(id, JsonRpcErrorCode.NOT_CONNECTED, result.error);
  }

  return result.manager.handleRequest(request);
};

/**
 * Routes MCP messages to the appropriate service handler.
 * JSON-RPC methods are namespaced by service: slack.*, datadog.*, etc.
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
