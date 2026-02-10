import { __setRequestProvider, __registerPluginPermissions } from '@opentabs/plugin-sdk/server';
import type { NativeApiPermission } from '@opentabs/core';
import type { RequestProvider } from '@opentabs/plugin-sdk/server';

// ---------------------------------------------------------------------------
// Service Request Handler — configurable mock for sendServiceRequest
// ---------------------------------------------------------------------------

interface ServiceRequestMatcher {
  /** Resolve all matching requests with this data */
  readonly resolveWith: (data: unknown) => void;
  /** Reject all matching requests with this error */
  readonly rejectWith: (error: string | Error) => void;
}

interface ServiceRequestCall {
  readonly service: string;
  readonly params: Record<string, unknown>;
  readonly action: string | undefined;
}

// ---------------------------------------------------------------------------
// MockProvider — createMockProvider()
// ---------------------------------------------------------------------------

interface MockProvider {
  /**
   * Install the mock provider, replacing the real RequestProvider.
   * Optionally register a plugin's permissions for native API testing.
   */
  readonly install: (options?: {
    readonly pluginName?: string;
    readonly permissions?: readonly NativeApiPermission[];
    readonly toolIds?: readonly string[];
  }) => void;
  /**
   * Uninstall the mock provider and restore the original (undefined) provider.
   */
  readonly uninstall: () => void;
  /**
   * Register a handler for service requests matching the given service name.
   * Returns a matcher to configure the response.
   */
  readonly onServiceRequest: (service?: string) => ServiceRequestMatcher;
  /** All service requests that were received */
  readonly calls: readonly ServiceRequestCall[];
  /** Clear all recorded calls and handlers */
  readonly reset: () => void;
}

/**
 * Create a mock provider that intercepts sendServiceRequest/sendBrowserRequest
 * calls during tests. Install it before calling tool handlers, uninstall after.
 */
const createMockProvider = (): MockProvider => {
  const calls: ServiceRequestCall[] = [];
  const handlers = new Map<string, { resolve?: unknown; reject?: string | Error }>();
  let defaultHandler: { resolve?: unknown; reject?: string | Error } | undefined;

  const mockProvider: RequestProvider = {
    sendServiceRequest: (service: string, params: Record<string, unknown>, action?: string): Promise<unknown> => {
      calls.push({ service, params, action });

      const handler = handlers.get(service) ?? defaultHandler;
      if (handler === undefined) {
        return Promise.reject(
          new Error(
            `No mock handler registered for service "${service}". Use mockProvider.onServiceRequest("${service}").resolveWith(data) to set one.`,
          ),
        );
      }
      if (handler.reject !== undefined) {
        const err = handler.reject instanceof Error ? handler.reject : new Error(handler.reject);
        return Promise.reject(err);
      }
      return Promise.resolve(handler.resolve);
    },
    sendBrowserRequest: (action: string, params?: Record<string, unknown>): Promise<unknown> => {
      calls.push({ service: '__browser__', params: { action, ...params } as Record<string, unknown>, action });
      const handler = handlers.get('__browser__') ?? defaultHandler;
      if (handler === undefined) {
        return Promise.resolve({ ok: true });
      }
      if (handler.reject !== undefined) {
        const err = handler.reject instanceof Error ? handler.reject : new Error(handler.reject);
        return Promise.reject(err);
      }
      return Promise.resolve(handler.resolve);
    },
    reloadExtension: (): Promise<void> => Promise.resolve(),
  };

  const install: MockProvider['install'] = options => {
    __setRequestProvider(mockProvider);
    if (options?.pluginName !== undefined) {
      __registerPluginPermissions(options.pluginName, options.permissions ?? [], options.toolIds ?? []);
    }
  };

  const uninstall: MockProvider['uninstall'] = () => {
    __setRequestProvider(undefined as unknown as RequestProvider);
  };

  const onServiceRequest = (service?: string): ServiceRequestMatcher => ({
    resolveWith: (data: unknown) => {
      if (service === undefined) {
        defaultHandler = { resolve: data };
      } else {
        handlers.set(service, { resolve: data });
      }
    },
    rejectWith: (error: string | Error) => {
      if (service === undefined) {
        defaultHandler = { reject: error };
      } else {
        handlers.set(service, { reject: error });
      }
    },
  });

  const reset = (): void => {
    calls.length = 0;
    handlers.clear();
    defaultHandler = undefined;
  };

  return {
    install,
    uninstall,
    onServiceRequest,
    get calls() {
      return calls;
    },
    reset,
  };
};

export { createMockProvider, type MockProvider, type ServiceRequestMatcher, type ServiceRequestCall };
