import { testApi } from './test-api.js';
import { createItem } from './tools/create-item.js';
import { echo } from './tools/echo.js';
import { errorAuth } from './tools/error-auth.js';
import { errorInternal } from './tools/error-internal.js';
import { errorNotFound } from './tools/error-not-found.js';
import { errorRateLimited } from './tools/error-rate-limited.js';
import { errorTimeout } from './tools/error-timeout.js';
import { errorValidation } from './tools/error-validation.js';
import { failingTool } from './tools/failing-tool.js';
import { getStatus } from './tools/get-status.js';
import { greet } from './tools/greet.js';
import { listItems } from './tools/list-items.js';
import { logBulk } from './tools/log-bulk.js';
import { logLevels } from './tools/log-levels.js';
import { sdkFetchJson } from './tools/sdk-fetch-json.js';
import { sdkGetConfig } from './tools/sdk-get-config.js';
import { sdkGetLocalStorage } from './tools/sdk-get-local-storage.js';
import { sdkGetPageGlobal } from './tools/sdk-get-page-global.js';
import { sdkRetry } from './tools/sdk-retry.js';
import { slowWithProgress } from './tools/slow-with-progress.js';
import { sdkWaitForSelector } from './tools/sdk-wait-for-selector.js';
import { sdkFetchErrorCategories } from './tools/sdk-fetch-error-categories.js';
import { indeterminateProgress } from './tools/indeterminate-progress.js';
import { noDisplayName } from './tools/no-display-name.js';
import { errorCustomCode } from './tools/error-custom-code.js';
import { sdkRemoveStorage } from './tools/sdk-remove-storage.js';
import { sdkSetSessionStorage } from './tools/sdk-set-session-storage.js';
import { sdkHttpMethods } from './tools/sdk-http-methods.js';
import { sdkNotifyReadinessChanged } from './tools/sdk-notify-readiness-changed.js';
import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';

class E2eTestPlugin extends OpenTabsPlugin {
  readonly name = 'e2e-test';
  readonly description = 'Plugin for E2E testing — relays to a local test web server';
  override readonly displayName = 'E2E Test';
  readonly urlPatterns = ['http://localhost/*'];
  override readonly homepage = 'http://localhost:9876';
  override readonly configSchema = {
    instanceUrl: {
      type: 'url' as const,
      label: 'Instance URL',
      description: 'URL of the test server instance',
      required: false,
      placeholder: 'http://localhost:9876',
    },
    testString: {
      type: 'string' as const,
      label: 'Test String',
      description: 'A test string for config verification',
      required: false,
    },
  };
  readonly tools: ToolDefinition[] = [
    echo,
    greet,
    listItems,
    getStatus,
    createItem,
    failingTool,
    errorAuth,
    errorRateLimited,
    errorNotFound,
    errorValidation,
    errorTimeout,
    errorInternal,
    logBulk,
    logLevels,
    sdkWaitForSelector,
    sdkFetchJson,
    sdkGetConfig,
    sdkGetLocalStorage,
    sdkGetPageGlobal,
    sdkRetry,
    slowWithProgress,
    sdkFetchErrorCategories,
    indeterminateProgress,
    noDisplayName,
    errorCustomCode,
    sdkRemoveStorage,
    sdkSetSessionStorage,
    sdkHttpMethods,
    sdkNotifyReadinessChanged,
  ];

  constructor() {
    super();
    // Clear the teardown marker on load so E2E tests can distinguish
    // "teardown called then re-injected" from "just re-injected".
    delete (globalThis as Record<string, unknown>).__opentabs_teardown_called;
  }

  /**
   * Cleanup hook — called by the platform before re-injection or uninstall.
   * Sets markers on the global so E2E tests can verify teardown was called:
   *   - __opentabs_teardown_called: transient (cleared by constructor on re-injection)
   *   - __opentabs_teardown_evidence: persistent (survives re-injection)
   */
  override teardown(): void {
    const g = globalThis as Record<string, unknown>;
    g.__opentabs_teardown_called = true;
    g.__opentabs_teardown_evidence = true;
  }

  override onActivate(): void {
    (globalThis as Record<string, unknown>).__opentabs_onActivate_called = true;
  }

  override onDeactivate(): void {
    (globalThis as Record<string, unknown>).__opentabs_onDeactivate_called = true;
  }

  override onNavigate(url: string): void {
    const g = globalThis as Record<string, unknown>;
    if (!Array.isArray(g.__opentabs_onNavigate_urls)) g.__opentabs_onNavigate_urls = [];
    (g.__opentabs_onNavigate_urls as string[]).push(url);
  }

  override onToolInvocationStart(toolName: string): void {
    const g = globalThis as Record<string, unknown>;
    if (!Array.isArray(g.__opentabs_tool_invocation_start)) g.__opentabs_tool_invocation_start = [];
    (g.__opentabs_tool_invocation_start as string[]).push(toolName);
  }

  override onToolInvocationEnd(toolName: string, success: boolean, durationMs: number): void {
    const g = globalThis as Record<string, unknown>;
    if (!Array.isArray(g.__opentabs_tool_invocation_end)) g.__opentabs_tool_invocation_end = [];
    (g.__opentabs_tool_invocation_end as unknown[]).push({ toolName, success, durationMs });
  }

  /**
   * Readiness probe — calls the test server's auth endpoint via same-origin
   * fetch, exactly like a real plugin (e.g., Slack calls /api/auth.test).
   *
   * The test server's /api/auth.check returns { ok: true } when "logged in"
   * and { ok: false } when the test harness has toggled auth off.
   */
  async isReady(): Promise<boolean> {
    try {
      await testApi('/api/auth.check');
      return true;
    } catch {
      return false;
    }
  }
}

export default new E2eTestPlugin();
