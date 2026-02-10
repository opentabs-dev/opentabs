// =============================================================================
// Mock Request Provider — Test Double for Plugin Tool Testing
//
// Provides a configurable mock implementation of the RequestProvider interface
// that plugin authors can use to test their tools without a running MCP server,
// Chrome extension, or browser tabs.
//
// The mock provider intercepts sendServiceRequest() and sendBrowserRequest()
// calls and returns canned responses, records call history for assertions,
// or throws configurable errors for failure path testing.
//
// Usage:
//
//   import { createMockProvider } from '@opentabs/plugin-test-utils';
//
//   const mock = createMockProvider();
//
//   // Stub a service response
//   mock.onServiceRequest('slack', { method: 'auth.test' }).resolveWith({ ok: true, user: 'U123' });
//
//   // Wire into the SDK
//   mock.install();
//
//   // Call your tool handler...
//   // Assert on the result and mock.history
//
//   // Clean up
//   mock.reset();
//
// =============================================================================

import { __setRequestProvider, __resetRequestProvider } from '@opentabs/plugin-sdk/server';
import type { RequestProvider } from '@opentabs/plugin-sdk/server';

// =============================================================================
// Types
// =============================================================================

/** A recorded call to sendServiceRequest. */
interface ServiceRequestCall {
  readonly type: 'service';
  readonly service: string;
  readonly params: Record<string, unknown>;
  readonly action?: string;
  readonly timestamp: number;
}

/** A recorded call to sendBrowserRequest. */
interface BrowserRequestCall {
  readonly type: 'browser';
  readonly action: string;
  readonly params?: Record<string, unknown>;
  readonly timestamp: number;
}

/** A recorded call to reloadExtension. */
interface ReloadExtensionCall {
  readonly type: 'reload';
  readonly timestamp: number;
}

/** Union of all recorded call types. */
type RecordedCall = ServiceRequestCall | BrowserRequestCall | ReloadExtensionCall;

/** Matcher predicate for identifying which requests a stub should handle. */
type RequestMatcher = (service: string, params: Record<string, unknown>, action?: string) => boolean;

/** Matcher predicate for browser requests. */
type BrowserRequestMatcher = (action: string, params?: Record<string, unknown>) => boolean;

/** Resolver function for service stubs. */
type ServiceResolver = (service: string, params: Record<string, unknown>, action?: string) => Promise<unknown>;

/** Resolver function for browser stubs. */
type BrowserResolver = (action: string, params?: Record<string, unknown>) => Promise<unknown>;

/** Configuration for a stubbed service response. */
interface ServiceStub {
  readonly matcher: RequestMatcher;
  resolver: ServiceResolver | null;
}

/** Configuration for a stubbed browser response. */
interface BrowserStub {
  readonly matcher: BrowserRequestMatcher;
  resolver: BrowserResolver | null;
}

/** Fluent builder for configuring a service request stub's response. */
interface ServiceStubBuilder {
  /** Resolve the matching request with the given value. */
  resolveWith(value: unknown): void;

  /** Resolve the matching request using a dynamic handler. */
  resolveUsing(
    handler: (service: string, params: Record<string, unknown>, action?: string) => unknown | Promise<unknown>,
  ): void;

  /** Reject the matching request with an error. */
  rejectWith(error: Error | string): void;
}

/** Fluent builder for configuring a browser request stub's response. */
interface BrowserStubBuilder {
  /** Resolve the matching request with the given value. */
  resolveWith(value: unknown): void;

  /** Resolve the matching request using a dynamic handler. */
  resolveUsing(handler: (action: string, params?: Record<string, unknown>) => unknown | Promise<unknown>): void;

  /** Reject the matching request with an error. */
  rejectWith(error: Error | string): void;
}

/** The mock provider instance with configuration and assertion methods. */
interface MockProvider {
  /** Install this mock as the active request provider in the SDK. */
  install(): void;

  /** Uninstall the mock provider and reset the SDK to its uninitialized state. */
  uninstall(): void;

  /** Reset all stubs and call history without uninstalling. */
  reset(): void;

  /**
   * Stub a service request. Returns a builder for configuring the response.
   *
   * @param service - The service name to match (e.g. 'slack')
   * @param paramsMatch - Optional partial params to match
   * @param action - Optional action to match (e.g. 'edgeApi')
   */
  onServiceRequest(service: string, paramsMatch?: Record<string, unknown>, action?: string): ServiceStubBuilder;

  /**
   * Stub a browser request. Returns a builder for configuring the response.
   *
   * @param action - The browser action to match (e.g. 'listTabs', 'executeScript')
   * @param paramsMatch - Optional partial params to match
   */
  onBrowserRequest(action: string, paramsMatch?: Record<string, unknown>): BrowserStubBuilder;

  /** Set a default response for all unmatched service requests. */
  setDefaultServiceResponse(value: unknown): void;

  /** Set a default response for all unmatched browser requests. */
  setDefaultBrowserResponse(value: unknown): void;

  /** All recorded calls in chronological order. */
  readonly history: readonly RecordedCall[];

  /** Only service request calls from history. */
  readonly serviceRequests: readonly ServiceRequestCall[];

  /** Only browser request calls from history. */
  readonly browserRequests: readonly BrowserRequestCall[];

  /** Assert that a service request was made matching the given criteria. */
  assertServiceRequestMade(service: string, paramsMatch?: Record<string, unknown>): void;

  /** Assert that a browser request was made matching the given criteria. */
  assertBrowserRequestMade(action: string, paramsMatch?: Record<string, unknown>): void;

  /** Assert that no requests have been made. */
  assertNoRequestsMade(): void;

  /** The underlying RequestProvider object (for advanced use cases). */
  readonly provider: RequestProvider;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Check whether `actual` contains all key-value pairs from `expected` (shallow).
 */
const isPartialMatch = (actual: Record<string, unknown>, expected: Record<string, unknown>): boolean => {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'object' && value !== null && typeof actual[key] === 'object' && actual[key] !== null) {
      if (!isPartialMatch(actual[key] as Record<string, unknown>, value as Record<string, unknown>)) {
        return false;
      }
    } else if (actual[key] !== value) {
      return false;
    }
  }
  return true;
};

/**
 * Strip the `toolId` key from a params object. The SDK injects toolId
 * automatically; test assertions shouldn't need to account for it.
 */
const stripToolId = (params: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'toolId') result[key] = value;
  }
  return result;
};

/**
 * Create a new mock request provider for testing plugin tools.
 *
 * @returns A MockProvider instance with stub configuration and assertion methods
 *
 * @example
 * ```ts
 * import { createMockProvider } from '@opentabs/plugin-test-utils';
 *
 * const mock = createMockProvider();
 * mock.install();
 *
 * // Stub Slack auth.test response
 * mock.onServiceRequest('slack', { method: 'auth.test' }).resolveWith({
 *   ok: true,
 *   user_id: 'U123',
 *   team_id: 'T456',
 * });
 *
 * // Run your tool handler...
 * const result = await myToolHandler({ query: 'test' });
 *
 * // Assert the tool made the expected request
 * mock.assertServiceRequestMade('slack', { method: 'auth.test' });
 *
 * // Clean up
 * mock.uninstall();
 * ```
 */
const createMockProvider = (): MockProvider => {
  const history: RecordedCall[] = [];
  const serviceStubs: ServiceStub[] = [];
  const browserStubs: BrowserStub[] = [];
  let defaultServiceResponse: unknown | undefined;
  let defaultBrowserResponse: unknown | undefined;
  let hasDefaultServiceResponse = false;
  let hasDefaultBrowserResponse = false;

  const provider: RequestProvider = {
    sendServiceRequest: async (service: string, params: Record<string, unknown>, action?: string): Promise<unknown> => {
      const cleanParams = stripToolId(params);

      history.push({
        type: 'service',
        service,
        params: cleanParams,
        action,
        timestamp: Date.now(),
      });

      // Find the first matching stub (last registered takes priority — search in reverse)
      for (let i = serviceStubs.length - 1; i >= 0; i--) {
        const stub = serviceStubs[i]!;
        if (stub.matcher(service, cleanParams, action) && stub.resolver) {
          return stub.resolver(service, cleanParams, action);
        }
      }

      if (hasDefaultServiceResponse) {
        return defaultServiceResponse;
      }

      throw new Error(
        `No mock configured for service request: ${service}.${action ?? 'api'}(${JSON.stringify(cleanParams)}). ` +
          `Use mock.onServiceRequest('${service}', ...) to stub this request, or ` +
          `mock.setDefaultServiceResponse(...) to provide a fallback.`,
      );
    },

    sendBrowserRequest: async <T>(action: string, params?: Record<string, unknown>): Promise<T> => {
      const cleanParams = stripToolId(params ?? {});

      history.push({
        type: 'browser',
        action,
        params: Object.keys(cleanParams).length > 0 ? cleanParams : undefined,
        timestamp: Date.now(),
      });

      for (let i = browserStubs.length - 1; i >= 0; i--) {
        const stub = browserStubs[i]!;
        if (stub.matcher(action, cleanParams) && stub.resolver) {
          return (await stub.resolver(action, cleanParams)) as T;
        }
      }

      if (hasDefaultBrowserResponse) {
        return defaultBrowserResponse as T;
      }

      throw new Error(
        `No mock configured for browser request: ${action}(${JSON.stringify(cleanParams)}). ` +
          `Use mock.onBrowserRequest('${action}', ...) to stub this request, or ` +
          `mock.setDefaultBrowserResponse(...) to provide a fallback.`,
      );
    },

    reloadExtension: async (): Promise<{ reloading: boolean }> => {
      history.push({ type: 'reload', timestamp: Date.now() });
      return { reloading: true };
    },
  };

  const mock: MockProvider = {
    install(): void {
      __setRequestProvider(provider);
    },

    uninstall(): void {
      __resetRequestProvider();
      history.length = 0;
      serviceStubs.length = 0;
      browserStubs.length = 0;
      hasDefaultServiceResponse = false;
      hasDefaultBrowserResponse = false;
      defaultServiceResponse = undefined;
      defaultBrowserResponse = undefined;
    },

    reset(): void {
      history.length = 0;
      serviceStubs.length = 0;
      browserStubs.length = 0;
      hasDefaultServiceResponse = false;
      hasDefaultBrowserResponse = false;
      defaultServiceResponse = undefined;
      defaultBrowserResponse = undefined;
    },

    onServiceRequest(service: string, paramsMatch?: Record<string, unknown>, action?: string): ServiceStubBuilder {
      const matcher: RequestMatcher = (s, p, a) => {
        if (s !== service) return false;
        if (action !== undefined && a !== action) return false;
        if (paramsMatch && !isPartialMatch(p, paramsMatch)) return false;
        return true;
      };

      const stub: ServiceStub = { matcher, resolver: null };
      serviceStubs.push(stub);

      return {
        resolveWith(value: unknown): void {
          stub.resolver = async () => value;
        },
        resolveUsing(handler): void {
          stub.resolver = async (s, p, a) => handler(s, p, a);
        },
        rejectWith(error: Error | string): void {
          stub.resolver = async () => {
            throw typeof error === 'string' ? new Error(error) : error;
          };
        },
      };
    },

    onBrowserRequest(action: string, paramsMatch?: Record<string, unknown>): BrowserStubBuilder {
      const matcher: BrowserRequestMatcher = (a, p) => {
        if (a !== action) return false;
        if (paramsMatch && p && !isPartialMatch(p, paramsMatch)) return false;
        return true;
      };

      const stub: BrowserStub = { matcher, resolver: null };
      browserStubs.push(stub);

      return {
        resolveWith(value: unknown): void {
          stub.resolver = async () => value;
        },
        resolveUsing(handler): void {
          stub.resolver = async (a, p) => handler(a, p);
        },
        rejectWith(error: Error | string): void {
          stub.resolver = async () => {
            throw typeof error === 'string' ? new Error(error) : error;
          };
        },
      };
    },

    setDefaultServiceResponse(value: unknown): void {
      defaultServiceResponse = value;
      hasDefaultServiceResponse = true;
    },

    setDefaultBrowserResponse(value: unknown): void {
      defaultBrowserResponse = value;
      hasDefaultBrowserResponse = true;
    },

    get history(): readonly RecordedCall[] {
      return history;
    },

    get serviceRequests(): readonly ServiceRequestCall[] {
      return history.filter((c): c is ServiceRequestCall => c.type === 'service');
    },

    get browserRequests(): readonly BrowserRequestCall[] {
      return history.filter((c): c is BrowserRequestCall => c.type === 'browser');
    },

    assertServiceRequestMade(service: string, paramsMatch?: Record<string, unknown>): void {
      const found = history.some(
        call =>
          call.type === 'service' &&
          call.service === service &&
          (!paramsMatch || isPartialMatch(call.params, paramsMatch)),
      );

      if (!found) {
        const recorded = history
          .filter((c): c is ServiceRequestCall => c.type === 'service')
          .map(c => `  ${c.service}.${c.action ?? 'api'}(${JSON.stringify(c.params)})`)
          .join('\n');

        throw new Error(
          `Expected a service request to "${service}"${paramsMatch ? ` matching ${JSON.stringify(paramsMatch)}` : ''} ` +
            `but none was found.\n` +
            `Recorded service requests:\n${recorded || '  (none)'}`,
        );
      }
    },

    assertBrowserRequestMade(action: string, paramsMatch?: Record<string, unknown>): void {
      const found = history.some(
        call =>
          call.type === 'browser' &&
          call.action === action &&
          (!paramsMatch || (call.params && isPartialMatch(call.params, paramsMatch))),
      );

      if (!found) {
        const recorded = history
          .filter((c): c is BrowserRequestCall => c.type === 'browser')
          .map(c => `  ${c.action}(${JSON.stringify(c.params ?? {})})`)
          .join('\n');

        throw new Error(
          `Expected a browser request to "${action}"${paramsMatch ? ` matching ${JSON.stringify(paramsMatch)}` : ''} ` +
            `but none was found.\n` +
            `Recorded browser requests:\n${recorded || '  (none)'}`,
        );
      }
    },

    assertNoRequestsMade(): void {
      if (history.length > 0) {
        const summary = history
          .map(c => {
            switch (c.type) {
              case 'service':
                return `  service: ${c.service}.${c.action ?? 'api'}(${JSON.stringify(c.params)})`;
              case 'browser':
                return `  browser: ${c.action}(${JSON.stringify(c.params ?? {})})`;
              case 'reload':
                return '  reload_extension';
            }
          })
          .join('\n');

        throw new Error(`Expected no requests but ${history.length} were made:\n${summary}`);
      }
    },

    get provider(): RequestProvider {
      return provider;
    },
  };

  return mock;
};

export type {
  MockProvider,
  ServiceStubBuilder,
  BrowserStubBuilder,
  ServiceRequestCall,
  BrowserRequestCall,
  ReloadExtensionCall,
  RecordedCall,
};

export { createMockProvider };
