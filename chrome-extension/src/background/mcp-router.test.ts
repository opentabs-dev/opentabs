import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { createJsonRpcError, createJsonRpcSuccess, JsonRpcErrorCode, SERVICE_DOMAINS } from '@extension/shared';
import type { JsonRpcRequest, JsonRpcResponse, ServiceId } from '@extension/shared';
import type { ServiceManager } from './service-managers';
import type { BrowserController } from './browser-controller';
import { getConnectedManager, routeJsonRpcRequest, type McpMessageRouterContext } from './mcp-router';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const createMockManager = (serviceId: ServiceId, connected: boolean): ServiceManager => ({
  serviceId,
  findTabs: mock(() => Promise.resolve()),
  handleDisconnect: mock(() => Promise.resolve()),
  handleTabReady: mock(),
  handleTabLoadComplete: mock(),
  focusTab: mock(() => Promise.resolve({ success: true })),
  getTabId: () => (connected ? 1 : null),
  isConnected: () => connected,
  checkSession: mock(() => Promise.resolve(connected)),
  getConnectionStatus: () => ({ connected }),
  handleRequest: mock((req: JsonRpcRequest) => Promise.resolve(createJsonRpcSuccess(req.id, { handled: true }))),
});

const createManagers = (
  overrides: Partial<Record<ServiceId, ServiceManager>> = {},
): Record<ServiceId, ServiceManager> => ({
  slack: createMockManager('slack', false),
  datadog_production: createMockManager('datadog_production', false),
  datadog_staging: createMockManager('datadog_staging', false),
  sqlpad_production: createMockManager('sqlpad_production', false),
  sqlpad_staging: createMockManager('sqlpad_staging', false),
  logrocket: createMockManager('logrocket', false),
  retool_production: createMockManager('retool_production', false),
  retool_staging: createMockManager('retool_staging', false),
  snowflake: createMockManager('snowflake', false),
  ...overrides,
});

const createRequest = (method: string, params?: Record<string, unknown>): JsonRpcRequest => ({
  jsonrpc: '2.0',
  id: 'test-1',
  method,
  params,
});

const createCtx = (managers: Record<ServiceId, ServiceManager>): McpMessageRouterContext => ({
  managers,
  browserController: {
    handleRequest: mock((req: JsonRpcRequest) => Promise.resolve(createJsonRpcSuccess(req.id, { handled: true }))),
  } as unknown as BrowserController,
  sendViaWebSocket: mock(() => Promise.resolve()),
  updateBadge: mock(() => Promise.resolve()),
  connectionStatus: {},
});

// ---------------------------------------------------------------------------
// getConnectedManager
// ---------------------------------------------------------------------------

describe('getConnectedManager', () => {
  describe('slack (single-env service)', () => {
    it('returns manager when slack is connected', () => {
      const slackManager = createMockManager('slack', true);
      const managers = createManagers({ slack: slackManager });
      const result = getConnectedManager('slack', managers);
      expect(result).toEqual({ manager: slackManager });
    });

    it('returns error when slack is not connected', () => {
      const managers = createManagers();
      const result = getConnectedManager('slack', managers);
      expect(result).toEqual({ error: 'No Slack tab connected. Please open a Slack tab in Chrome.' });
    });

    it('ignores env parameter for slack', () => {
      const slackManager = createMockManager('slack', true);
      const managers = createManagers({ slack: slackManager });
      const result = getConnectedManager('slack', managers, 'staging');
      expect(result).toEqual({ manager: slackManager });
    });
  });

  describe('logrocket (single-env service)', () => {
    it('returns manager when logrocket is connected', () => {
      const lrManager = createMockManager('logrocket', true);
      const managers = createManagers({ logrocket: lrManager });
      const result = getConnectedManager('logrocket', managers);
      expect(result).toEqual({ manager: lrManager });
    });

    it('returns error when logrocket is not connected', () => {
      const managers = createManagers();
      const result = getConnectedManager('logrocket', managers);
      expect(result).toEqual({ error: 'No Logrocket tab connected. Please open a Logrocket tab in Chrome.' });
    });
  });

  describe('snowflake (single-env service)', () => {
    it('returns manager when snowflake is connected', () => {
      const sfManager = createMockManager('snowflake', true);
      const managers = createManagers({ snowflake: sfManager });
      const result = getConnectedManager('snowflake', managers);
      expect(result).toEqual({ manager: sfManager });
    });

    it('returns error when snowflake is not connected', () => {
      const managers = createManagers();
      const result = getConnectedManager('snowflake', managers);
      expect(result).toEqual({ error: 'No Snowflake tab connected. Please open a Snowflake tab in Chrome.' });
    });
  });

  describe('retool (multi-env service)', () => {
    it('returns production manager when both are connected', () => {
      const prodManager = createMockManager('retool_production', true);
      const stagingManager = createMockManager('retool_staging', true);
      const managers = createManagers({
        retool_production: prodManager,
        retool_staging: stagingManager,
      });
      const result = getConnectedManager('retool', managers);
      expect(result).toEqual({ manager: prodManager });
    });

    it('falls back to staging when only staging is connected', () => {
      const stagingManager = createMockManager('retool_staging', true);
      const managers = createManagers({ retool_staging: stagingManager });
      const result = getConnectedManager('retool', managers);
      expect(result).toEqual({ manager: stagingManager });
    });

    it('returns error when neither env is connected', () => {
      const managers = createManagers();
      const result = getConnectedManager('retool', managers);
      expect(result).toEqual({
        error: 'No Retool tab connected. Please open a Retool tab in Chrome.',
      });
    });
  });

  describe('explicit env — no fallback', () => {
    it('returns production manager when env=production and production is connected', () => {
      const prodManager = createMockManager('datadog_production', true);
      const managers = createManagers({ datadog_production: prodManager });
      const result = getConnectedManager('datadog', managers, 'production');
      expect(result).toEqual({ manager: prodManager });
    });

    it('returns staging manager when env=staging and staging is connected', () => {
      const stagingManager = createMockManager('sqlpad_staging', true);
      const managers = createManagers({ sqlpad_staging: stagingManager });
      const result = getConnectedManager('sqlpad', managers, 'staging');
      expect(result).toEqual({ manager: stagingManager });
    });

    it('returns error when env=staging but only production is connected', () => {
      const prodManager = createMockManager('datadog_production', true);
      const managers = createManagers({ datadog_production: prodManager });
      const result = getConnectedManager('datadog', managers, 'staging');
      expect(result).toEqual({
        error: `No Datadog staging tab connected. Please open https://${SERVICE_DOMAINS.datadog_staging} in Chrome.`,
      });
    });

    it('returns error when env=production but only staging is connected', () => {
      const stagingManager = createMockManager('sqlpad_staging', true);
      const managers = createManagers({ sqlpad_staging: stagingManager });
      const result = getConnectedManager('sqlpad', managers, 'production');
      expect(result).toEqual({
        error: `No Sqlpad production tab connected. Please open https://${SERVICE_DOMAINS.sqlpad_production} in Chrome.`,
      });
    });

    it('returns error with correct URL for sqlpad staging', () => {
      const managers = createManagers();
      const result = getConnectedManager('sqlpad', managers, 'staging');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('sqlpad.staging.brexapps.io');
      }
    });

    it('returns error with correct URL for datadog production', () => {
      const managers = createManagers();
      const result = getConnectedManager('datadog', managers, 'production');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('brex-production.datadoghq.com');
      }
    });
  });

  describe('no env — fallback behavior', () => {
    it('returns production manager when both are connected', () => {
      const prodManager = createMockManager('datadog_production', true);
      const stagingManager = createMockManager('datadog_staging', true);
      const managers = createManagers({
        datadog_production: prodManager,
        datadog_staging: stagingManager,
      });
      const result = getConnectedManager('datadog', managers);
      expect(result).toEqual({ manager: prodManager });
    });

    it('falls back to staging when only staging is connected', () => {
      const stagingManager = createMockManager('sqlpad_staging', true);
      const managers = createManagers({ sqlpad_staging: stagingManager });
      const result = getConnectedManager('sqlpad', managers);
      expect(result).toEqual({ manager: stagingManager });
    });

    it('returns error when neither env is connected', () => {
      const managers = createManagers();
      const result = getConnectedManager('datadog', managers);
      expect(result).toEqual({
        error: 'No Datadog tab connected. Please open a Datadog tab in Chrome.',
      });
    });
  });
});

// ---------------------------------------------------------------------------
// routeJsonRpcRequest
// ---------------------------------------------------------------------------

describe('routeJsonRpcRequest', () => {
  describe('method parsing', () => {
    it('rejects methods without a dot separator', async () => {
      const managers = createManagers();
      const ctx = createCtx(managers);
      const response = await routeJsonRpcRequest(createRequest('invalidmethod'), ctx);
      expect(response).toEqual(
        createJsonRpcError(
          'test-1',
          JsonRpcErrorCode.METHOD_NOT_FOUND,
          expect.stringContaining('Invalid method format'),
        ),
      );
    });

    it('rejects unknown service types', async () => {
      const managers = createManagers();
      const ctx = createCtx(managers);
      const response = await routeJsonRpcRequest(createRequest('unknown.action'), ctx);
      expect(response).toEqual(
        createJsonRpcError('test-1', JsonRpcErrorCode.METHOD_NOT_FOUND, 'Unknown service: unknown'),
      );
    });
  });

  describe('service routing', () => {
    it('routes slack requests to the slack manager', async () => {
      const slackManager = createMockManager('slack', true);
      const managers = createManagers({ slack: slackManager });
      const ctx = createCtx(managers);
      const request = createRequest('slack.api', { method: 'chat.postMessage' });
      await routeJsonRpcRequest(request, ctx);
      expect(slackManager.handleRequest).toHaveBeenCalledWith(request);
    });

    it('routes datadog requests to production by default', async () => {
      const prodManager = createMockManager('datadog_production', true);
      const managers = createManagers({ datadog_production: prodManager });
      const ctx = createCtx(managers);
      const request = createRequest('datadog.searchLogs', { query: '*' });
      await routeJsonRpcRequest(request, ctx);
      expect(prodManager.handleRequest).toHaveBeenCalledWith(request);
    });

    it('routes sqlpad requests to staging when env=staging', async () => {
      const stagingManager = createMockManager('sqlpad_staging', true);
      const managers = createManagers({ sqlpad_staging: stagingManager });
      const ctx = createCtx(managers);
      const request = createRequest('sqlpad.executeScript', { env: 'staging', script: 'return 1' });
      await routeJsonRpcRequest(request, ctx);
      expect(stagingManager.handleRequest).toHaveBeenCalledWith(request);
    });
  });

  describe('env routing — no silent fallback', () => {
    it('errors when env=staging is requested but only production is connected', async () => {
      const prodManager = createMockManager('sqlpad_production', true);
      const managers = createManagers({ sqlpad_production: prodManager });
      const ctx = createCtx(managers);
      const request = createRequest('sqlpad.executeScript', { env: 'staging', script: 'return 1' });
      const response = await routeJsonRpcRequest(request, ctx);
      expect(response).toEqual(
        createJsonRpcError(
          'test-1',
          JsonRpcErrorCode.NOT_CONNECTED,
          expect.stringContaining('No Sqlpad staging tab connected'),
        ),
      );
      expect(prodManager.handleRequest).not.toHaveBeenCalled();
    });

    it('errors when env=production is requested but only staging is connected', async () => {
      const stagingManager = createMockManager('datadog_staging', true);
      const managers = createManagers({ datadog_staging: stagingManager });
      const ctx = createCtx(managers);
      const request = createRequest('datadog.searchLogs', { env: 'production', query: '*' });
      const response = await routeJsonRpcRequest(request, ctx);
      expect(response).toEqual(
        createJsonRpcError(
          'test-1',
          JsonRpcErrorCode.NOT_CONNECTED,
          expect.stringContaining('No Datadog production tab connected'),
        ),
      );
      expect(stagingManager.handleRequest).not.toHaveBeenCalled();
    });
  });

  describe('disconnected services', () => {
    it('returns NOT_CONNECTED error when no manager is available', async () => {
      const managers = createManagers();
      const ctx = createCtx(managers);
      const request = createRequest('slack.api', { method: 'chat.postMessage' });
      const response = await routeJsonRpcRequest(request, ctx);
      expect(response).toEqual(
        createJsonRpcError('test-1', JsonRpcErrorCode.NOT_CONNECTED, expect.stringContaining('No Slack tab connected')),
      );
    });
  });
});
