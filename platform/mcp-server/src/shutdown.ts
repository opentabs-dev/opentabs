/**
 * Graceful shutdown handler for the MCP server.
 *
 * Installs SIGTERM and SIGINT handlers that perform orderly cleanup:
 *   1. Reject all pending dispatches immediately (fast error for MCP clients)
 *   2. Reject all pending confirmations (mirrors WebSocket disconnect behavior)
 *   3. Stop periodic session sweep timer
 *   4. Stop file watchers (release OS handles)
 *   5. Close extension WebSocket cleanly (so offscreen document reconnects)
 *   6. Exit the process
 *
 * The handler is installed once on first load. Signal handlers are not
 * re-registered on hot reload (they survive across module re-evaluations
 * because they reference state via the getter closure, not a stale capture).
 *
 * A globalThis flag prevents double-registration if index.ts is re-evaluated.
 */

import { rejectAllPendingConfirmations } from './extension-handlers.js';
import { stopFileWatching } from './file-watcher.js';
import { log } from './logger.js';
import type { ServerState } from './state.js';

const SHUTDOWN_INSTALLED_KEY = '__opentabs_shutdown_installed__' as const;

/**
 * Install graceful shutdown handlers for SIGTERM and SIGINT.
 * Safe to call on every module evaluation — only installs once per process.
 *
 * @param getState - Getter that returns the current ServerState. Using a getter
 *   instead of a direct reference ensures the handler always operates on the
 *   latest state after hot reloads.
 */
const installShutdownHandlers = (getState: () => ServerState): void => {
  if ((globalThis as Record<string, unknown>)[SHUTDOWN_INSTALLED_KEY]) return;
  (globalThis as Record<string, unknown>)[SHUTDOWN_INSTALLED_KEY] = true;

  const shutdown = (signal: string): void => {
    log.info(`Received ${signal} — shutting down gracefully`);
    const state = getState();

    // 1. Reject all pending dispatches so MCP clients get fast errors
    if (state.pendingDispatches.size > 0) {
      log.info(`Rejecting ${state.pendingDispatches.size} pending dispatch(es)`);
      for (const [id, pending] of state.pendingDispatches) {
        state.pendingDispatches.delete(id);
        clearTimeout(pending.timerId);
        pending.reject(new Error('Server shutting down'));
      }
    }

    // 2. Reject all pending confirmations (mirrors WebSocket disconnect behavior)
    rejectAllPendingConfirmations(state);

    // 3. Stop periodic session sweep timer
    if (state.sweepTimerId !== null) {
      clearInterval(state.sweepTimerId);
      state.sweepTimerId = null;
    }

    // 3b. Stop periodic version check timer
    if (state.versionCheckTimerId !== null) {
      clearInterval(state.versionCheckTimerId);
      state.versionCheckTimerId = null;
    }

    // 4. Stop file watchers (release OS handles)
    stopFileWatching(state);

    // 5. Close all extension WebSocket connections cleanly
    for (const [id, conn] of state.extensionConnections) {
      try {
        conn.ws.close(1001, 'Server shutting down');
      } catch {
        // Already closed
      }
      state.extensionConnections.delete(id);
    }

    log.info('Shutdown complete');
    setTimeout(() => process.exit(0), 150);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

export { installShutdownHandlers };
