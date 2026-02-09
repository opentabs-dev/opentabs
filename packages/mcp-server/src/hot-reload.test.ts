import { describe, it, expect, beforeEach } from 'bun:test';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

// Direct import — no module mocking needed since hot-reload.ts operates on
// plain objects/maps passed as arguments. We test via the exported API.
import {
  getHotState,
  hotPatchAllSessions,
  isHotReload,
  registerSession,
  removeSession,
  getSession,
  closeAllSessions,
} from './hot-reload.js';
import type { SessionEntry, TransportHandle } from './hot-reload.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock RegisteredTool that records mutations. */
const createMockTool = (
  name: string,
  overrides: Partial<{ update: (u: Record<string, unknown>) => void; remove: () => void }> = {},
): RegisteredTool & {
  _updateCalls: Array<Record<string, unknown>>;
  _removed: boolean;
} => {
  const tool = {
    title: undefined as string | undefined,
    description: `desc-${name}`,
    inputSchema: undefined,
    outputSchema: undefined,
    annotations: undefined,
    _meta: undefined,
    handler: (() => ({ content: [{ type: 'text' as const, text: name }] })) as unknown as RegisteredTool['handler'],
    enabled: true,
    _updateCalls: [] as Array<Record<string, unknown>>,
    _removed: false,
    enable() {
      tool.enabled = true;
    },
    disable() {
      tool.enabled = false;
    },
    update(updates: Record<string, unknown>) {
      tool._updateCalls.push(updates);
      if (updates.description !== undefined) tool.description = updates.description as string;
      if (updates.callback !== undefined) tool.handler = updates.callback as RegisteredTool['handler'];
      if (updates.title !== undefined) tool.title = updates.title as string;
    },
    remove() {
      tool._removed = true;
    },
  };
  if (overrides.update) tool.update = overrides.update as typeof tool.update;
  if (overrides.remove) tool.remove = overrides.remove;
  return tool as unknown as RegisteredTool & { _updateCalls: Array<Record<string, unknown>>; _removed: boolean };
};

/** Create a mock transport */
const createMockTransport = (): TransportHandle & { _closed: boolean } => ({
  _closed: false,
  close: async () => {
    // no-op
  },
});

/** Create a minimal mock McpServer and a SessionEntry. */
const createMockSession = (
  connected: boolean = true,
  toolNames: string[] = [],
  type: 'sse' | 'stream' = 'stream',
): { entry: SessionEntry; tools: Map<string, ReturnType<typeof createMockTool>> } => {
  const tools = new Map<string, ReturnType<typeof createMockTool>>();
  for (const name of toolNames) {
    tools.set(name, createMockTool(name));
  }
  const server = {
    registerTool(name: string, _config?: unknown, _cb?: unknown) {
      const tool = createMockTool(name);
      tools.set(name, tool);
      return tool;
    },
    isConnected: () => connected,
  } as unknown as McpServer;

  const entry: SessionEntry = {
    server,
    transport: createMockTransport(),
    type,
    tools: tools as Map<string, RegisteredTool>,
  };
  return { entry, tools };
};

/**
 * Build a registerAllTools function that registers a fixed set of tool names.
 */
const makeRegisterAllTools = (toolNames: string[]) => {
  const fn = (server: McpServer): Map<string, RegisteredTool> => {
    const map = new Map<string, RegisteredTool>();
    for (const name of toolNames) {
      map.set(
        name,
        server.registerTool(name, { description: `fresh-${name}` }, () => ({ content: [] })),
      );
    }
    return map;
  };
  return { fn };
};

// McpServer class stub for collectFreshTools
class MockMcpServerClass {
  registerTool = (name: string, _config?: unknown, _cb?: unknown): RegisteredTool => createMockTool(name);
  isConnected = () => false;
}

/** Reset hot state between tests */
const resetHotState = (): void => {
  const state = getHotState();
  state.initialized = false;
  state.config = null;
  state.relay = null;
  state.httpServer = null;
  state.createServerFn = null;
  state.sessions.clear();
  state.reloadCount = 0;
  state.lastReload = null;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hot-reload', () => {
  beforeEach(() => {
    resetHotState();
  });

  describe('getHotState', () => {
    it('returns the same state object on repeated calls', () => {
      const s1 = getHotState();
      const s2 = getHotState();
      expect(s1).toBe(s2);
    });

    it('initializes with empty sessions map', () => {
      const state = getHotState();
      expect(state.sessions.size).toBe(0);
    });

    it('initializes with default values', () => {
      const state = getHotState();
      expect(state.initialized).toBe(false);
      expect(state.config).toBeNull();
      expect(state.relay).toBeNull();
      expect(state.httpServer).toBeNull();
      expect(state.createServerFn).toBeNull();
      expect(state.reloadCount).toBe(0);
      expect(state.lastReload).toBeNull();
    });
  });

  describe('isHotReload', () => {
    it('returns false before initialization', () => {
      expect(isHotReload()).toBe(false);
    });

    it('returns true after initialization', () => {
      getHotState().initialized = true;
      expect(isHotReload()).toBe(true);
    });
  });

  describe('registerSession / removeSession / getSession', () => {
    it('registers and retrieves a session', () => {
      const { entry } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);
      expect(getSession('s1')).toBe(entry);
      expect(getHotState().sessions.size).toBe(1);
    });

    it('removes a session', () => {
      const { entry } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);
      removeSession('s1');
      expect(getSession('s1')).toBeUndefined();
      expect(getHotState().sessions.size).toBe(0);
    });

    it('overwrites previous session for the same ID', () => {
      const { entry: entry1 } = createMockSession(true, ['tool_a']);
      const { entry: entry2 } = createMockSession(true, ['tool_b']);
      registerSession('s1', entry1);
      registerSession('s1', entry2);
      expect(getSession('s1')).toBe(entry2);
      expect(getHotState().sessions.size).toBe(1);
    });

    it('returns undefined for unknown session', () => {
      expect(getSession('nonexistent')).toBeUndefined();
    });
  });

  describe('closeAllSessions', () => {
    it('clears all sessions', async () => {
      const { entry: entry1 } = createMockSession(true, ['tool_a']);
      const { entry: entry2 } = createMockSession(true, ['tool_b']);
      registerSession('s1', entry1);
      registerSession('s2', entry2);

      await closeAllSessions();

      expect(getHotState().sessions.size).toBe(0);
    });

    it('calls transport.close() on each session', async () => {
      const closedTransports: string[] = [];
      const makeTrackedSession = (id: string): SessionEntry => {
        const { entry } = createMockSession(true, ['tool_a']);
        entry.transport = {
          close: async () => {
            closedTransports.push(id);
          },
        };
        return entry;
      };

      registerSession('s1', makeTrackedSession('s1'));
      registerSession('s2', makeTrackedSession('s2'));
      registerSession('s3', makeTrackedSession('s3'));

      await closeAllSessions();

      expect(closedTransports).toHaveLength(3);
      expect(closedTransports).toContain('s1');
      expect(closedTransports).toContain('s2');
      expect(closedTransports).toContain('s3');
    });

    it('closes the HTTP server if present', async () => {
      let httpServerClosed = false;
      getHotState().httpServer = {
        close: (cb: (err?: Error) => void) => {
          httpServerClosed = true;
          cb();
        },
        closeAllConnections: () => {},
      } as unknown as ReturnType<typeof getHotState>['httpServer'];

      await closeAllSessions();

      expect(httpServerClosed).toBe(true);
      expect(getHotState().httpServer).toBeNull();
    });

    it('calls closeAllConnections() on the HTTP server', async () => {
      let connectionsForced = false;
      getHotState().httpServer = {
        close: (cb: (err?: Error) => void) => cb(),
        closeAllConnections: () => {
          connectionsForced = true;
        },
      } as unknown as ReturnType<typeof getHotState>['httpServer'];

      await closeAllSessions();

      expect(connectionsForced).toBe(true);
    });

    it('works with no sessions and no HTTP server', async () => {
      // Should not throw
      await closeAllSessions();
      expect(getHotState().sessions.size).toBe(0);
    });

    it('is safe to call multiple times', async () => {
      const { entry } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);
      getHotState().httpServer = {
        close: (cb: (err?: Error) => void) => cb(),
        closeAllConnections: () => {},
      } as unknown as ReturnType<typeof getHotState>['httpServer'];

      await closeAllSessions();
      // Second call should not throw (httpServer is null, sessions are empty)
      await closeAllSessions();

      expect(getHotState().sessions.size).toBe(0);
      expect(getHotState().httpServer).toBeNull();
    });
  });

  describe('hotPatchAllSessions', () => {
    it('patches tools on connected stream sessions', () => {
      const { entry, tools } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);

      const { fn } = makeRegisterAllTools(['tool_a']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(tools.get('tool_a')!._updateCalls.length).toBeGreaterThan(0);
    });

    it('patches tools on connected SSE sessions', () => {
      const { entry, tools } = createMockSession(true, ['tool_a'], 'sse');
      registerSession('s1', entry);

      const { fn } = makeRegisterAllTools(['tool_a']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(tools.get('tool_a')!._updateCalls.length).toBeGreaterThan(0);
    });

    it('prunes disconnected sessions', () => {
      const { entry } = createMockSession(false, ['tool_a']); // disconnected
      registerSession('s-dead', entry);

      const { fn } = makeRegisterAllTools(['tool_a']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(getHotState().sessions.has('s-dead')).toBe(false);
    });

    it('removes tools that no longer exist in fresh set', () => {
      const { entry, tools } = createMockSession(true, ['old_tool', 'kept_tool']);
      registerSession('s1', entry);

      // Save reference before hotPatchAllSessions deletes it from the shared map
      const oldTool = tools.get('old_tool')!;

      const { fn } = makeRegisterAllTools(['kept_tool']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(oldTool._removed).toBe(true);
      expect(entry.tools.has('old_tool')).toBe(false);
      expect(entry.tools.has('kept_tool')).toBe(true);
    });

    it('adds new tools that did not exist before', () => {
      const { entry } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);

      const { fn } = makeRegisterAllTools(['tool_a', 'tool_b']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(entry.tools.has('tool_b')).toBe(true);
    });

    it('updates description and callback on existing tools', () => {
      const { entry, tools } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);

      const { fn } = makeRegisterAllTools(['tool_a']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(tools.get('tool_a')!._updateCalls.length).toBe(1);
      const updateArg = tools.get('tool_a')!._updateCalls[0];
      expect(updateArg).toHaveProperty('description');
      expect(updateArg).toHaveProperty('callback');
    });

    it('patches multiple sessions independently', () => {
      const { entry: entry1, tools: tools1 } = createMockSession(true, ['tool_a']);
      const { entry: entry2, tools: tools2 } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry1);
      registerSession('s2', entry2);

      const { fn } = makeRegisterAllTools(['tool_a']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(tools1.get('tool_a')!._updateCalls.length).toBeGreaterThan(0);
      expect(tools2.get('tool_a')!._updateCalls.length).toBeGreaterThan(0);
    });

    it('skips sessions with no tool registrations gracefully', () => {
      // Create a session entry with empty tools map
      const server = { registerTool: () => createMockTool('x'), isConnected: () => true } as unknown as McpServer;
      const entry: SessionEntry = { server, transport: createMockTransport(), type: 'stream', tools: new Map() };
      registerSession('s-empty', entry);

      const { fn } = makeRegisterAllTools(['tool_a']);

      // Should not throw — empty existing tools just means all fresh tools are "new"
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');
    });

    it('handles empty fresh tools (remove all)', () => {
      const { entry, tools } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);

      // Save reference before hotPatchAllSessions deletes it from the shared map
      const toolA = tools.get('tool_a')!;

      const { fn } = makeRegisterAllTools([]);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(toolA._removed).toBe(true);
      expect(entry.tools.size).toBe(0);
    });

    it('handles errors in tool.remove() gracefully', () => {
      const brokenTool = createMockTool('broken_tool', {
        remove: () => {
          throw new Error('remove failed');
        },
      });
      const goodTool = createMockTool('good_tool');

      const server = { registerTool: () => createMockTool('x'), isConnected: () => true } as unknown as McpServer;
      const entry: SessionEntry = {
        server,
        transport: createMockTransport(),
        type: 'stream',
        tools: new Map<string, RegisteredTool>([
          ['broken_tool', brokenTool],
          ['good_tool', goodTool],
        ]),
      };
      registerSession('s1', entry);

      const { fn } = makeRegisterAllTools(['good_tool']);

      // Should not throw
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(goodTool._updateCalls.length).toBeGreaterThan(0);
    });

    it('handles errors in tool.update() gracefully', () => {
      const brokenTool = createMockTool('broken_tool', {
        update: () => {
          throw new Error('update failed');
        },
      });

      const server = { registerTool: () => createMockTool('x'), isConnected: () => true } as unknown as McpServer;
      const entry: SessionEntry = {
        server,
        transport: createMockTransport(),
        type: 'stream',
        tools: new Map<string, RegisteredTool>([['broken_tool', brokenTool]]),
      };
      registerSession('s1', entry);

      const { fn } = makeRegisterAllTools(['broken_tool']);

      // Should not throw
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');
    });

    it('handles mix of stream and SSE sessions', () => {
      const { entry: streamEntry, tools: streamTools } = createMockSession(true, ['tool_a'], 'stream');
      const { entry: sseEntry, tools: sseTools } = createMockSession(true, ['tool_a'], 'sse');
      registerSession('stream-1', streamEntry);
      registerSession('sse-1', sseEntry);

      const { fn } = makeRegisterAllTools(['tool_a']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(streamTools.get('tool_a')!._updateCalls.length).toBeGreaterThan(0);
      expect(sseTools.get('tool_a')!._updateCalls.length).toBeGreaterThan(0);
    });

    it('handles concurrent add and remove in the same reload', () => {
      const { entry, tools } = createMockSession(true, ['old_tool', 'kept_tool']);
      registerSession('s1', entry);

      // Save reference before removal deletes it from the map
      const oldTool = tools.get('old_tool')!;
      const keptTool = tools.get('kept_tool')!;

      // Fresh set: remove old_tool, keep kept_tool, add new_tool
      const { fn } = makeRegisterAllTools(['kept_tool', 'new_tool']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(oldTool._removed).toBe(true);
      expect(entry.tools.has('old_tool')).toBe(false);
      expect(entry.tools.has('kept_tool')).toBe(true);
      expect(entry.tools.has('new_tool')).toBe(true);
      expect(keptTool._updateCalls.length).toBeGreaterThan(0);
    });

    it('handles zero sessions gracefully', () => {
      const { fn } = makeRegisterAllTools(['tool_a']);

      // No sessions in state — should not throw
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');
    });

    it('records lastReload on success', () => {
      const { entry } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);

      const { fn } = makeRegisterAllTools(['tool_a']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      const state = getHotState();
      expect(state.lastReload).not.toBeNull();
      expect(state.lastReload!.success).toBe(true);
      expect(state.lastReload!.patchedSessions).toBe(1);
      expect(state.lastReload!.toolCount).toBe(1);
      expect(state.lastReload!.timestamp).toBeGreaterThan(0);
      expect(state.lastReload!.error).toBeUndefined();
    });

    it('records lastReload with correct tool count for multiple tools', () => {
      const { fn } = makeRegisterAllTools(['a', 'b', 'c']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      const state = getHotState();
      expect(state.lastReload!.toolCount).toBe(3);
      expect(state.lastReload!.patchedSessions).toBe(0);
    });

    it('records lastReload with zero patched sessions when all disconnected', () => {
      const { entry } = createMockSession(false, ['tool_a']); // disconnected
      registerSession('s-dead', entry);

      const { fn } = makeRegisterAllTools(['tool_a']);
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      const state = getHotState();
      expect(state.lastReload!.patchedSessions).toBe(0);
    });

    it('assigns inputSchema directly to avoid double-wrapping', () => {
      const { entry, tools } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);

      // The fresh tool gets a mock inputSchema value
      const freshSchema = { type: 'object', properties: { foo: { type: 'string' } } };
      const customFreshTools = (server: McpServer): Map<string, RegisteredTool> => {
        const tool = server.registerTool('tool_a', { description: 'fresh' }, () => ({ content: [] }));
        // Simulate a pre-processed inputSchema (as the SDK sets it)
        (tool as unknown as Record<string, unknown>).inputSchema = freshSchema;
        return new Map([['tool_a', tool]]);
      };

      hotPatchAllSessions(customFreshTools, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      // The existing tool should have inputSchema assigned directly
      const updatedTool = tools.get('tool_a')!;
      expect((updatedTool as unknown as Record<string, unknown>).inputSchema).toBe(freshSchema);
    });

    it('restores registerTool even if registerAllTools throws during new tool registration', () => {
      const { entry } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);

      // Track which server instance the function is called on.
      // collectFreshTools calls it on a temp MockMcpServerClass,
      // then hotPatchSession calls it on the real session server.
      let callCount = 0;
      const throwingRegister = (server: McpServer): Map<string, RegisteredTool> => {
        const map = new Map<string, RegisteredTool>();
        map.set(
          'tool_a',
          server.registerTool('tool_a', { description: 'fresh' }, () => ({ content: [] })),
        );
        map.set(
          'tool_b',
          server.registerTool('tool_b', { description: 'new' }, () => ({ content: [] })),
        );
        callCount++;
        // Throw only on the second call (per-session patching), not the first (collectFreshTools)
        if (callCount > 1) {
          throw new Error('registerAllTools exploded');
        }
        return map;
      };

      // Should not throw (error is caught inside hotPatchSession's finally block)
      hotPatchAllSessions(throwingRegister, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      // Verify registerTool was restored (not left as the patched wrapper).
      // hotPatchSession saves the original via .bind(), so it's a different reference,
      // but calling it should behave like the original: registering a tool on the session.
      const toolsBefore = entry.tools.size;
      entry.server.registerTool('verify_restore', { description: 'test' }, () => ({ content: [] }));
      // The original mock registerTool adds to the tools map
      expect(entry.tools.size).toBe(toolsBefore + 1);
      expect(entry.tools.has('verify_restore')).toBe(true);
    });

    it('successive calls update lastReload with latest data', () => {
      const { entry } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);

      // First reload
      const { fn: fn1 } = makeRegisterAllTools(['tool_a']);
      hotPatchAllSessions(fn1, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      const state = getHotState();
      const firstTimestamp = state.lastReload!.timestamp;
      expect(state.lastReload!.toolCount).toBe(1);

      // Second reload with more tools
      const { fn: fn2 } = makeRegisterAllTools(['tool_a', 'tool_b', 'tool_c']);
      hotPatchAllSessions(fn2, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      expect(state.lastReload!.toolCount).toBe(3);
      expect(state.lastReload!.timestamp).toBeGreaterThanOrEqual(firstTimestamp);
    });

    it('removeSession is idempotent', () => {
      const { entry } = createMockSession(true, ['tool_a']);
      registerSession('s1', entry);

      removeSession('s1');
      expect(getSession('s1')).toBeUndefined();

      // Second removal should not throw
      removeSession('s1');
      expect(getHotState().sessions.size).toBe(0);

      // Removing a session that was never registered
      removeSession('never-existed');
      expect(getHotState().sessions.size).toBe(0);
    });

    it('selective removal leaves other sessions intact', () => {
      const { entry: entry1 } = createMockSession(true, ['tool_a']);
      const { entry: entry2 } = createMockSession(true, ['tool_b']);
      const { entry: entry3 } = createMockSession(true, ['tool_c']);
      registerSession('s1', entry1);
      registerSession('s2', entry2);
      registerSession('s3', entry3);

      removeSession('s2');

      expect(getHotState().sessions.size).toBe(2);
      expect(getSession('s1')).toBe(entry1);
      expect(getSession('s2')).toBeUndefined();
      expect(getSession('s3')).toBe(entry3);
    });

    it('handles new tool registration failure gracefully (returns stub)', () => {
      // Set up a session with no tools
      let registerCallCount = 0;
      const server = {
        registerTool(name: string, _config?: unknown, _cb?: unknown) {
          registerCallCount++;
          if (name === 'failing_tool') {
            throw new Error('registration failed');
          }
          return createMockTool(name);
        },
        isConnected: () => true,
      } as unknown as McpServer;

      const entry: SessionEntry = {
        server,
        transport: createMockTransport(),
        type: 'stream',
        tools: new Map(),
      };
      registerSession('s1', entry);

      // Fresh set includes a tool whose registration will fail
      const { fn } = makeRegisterAllTools(['good_tool', 'failing_tool']);

      // Should not throw
      hotPatchAllSessions(fn, MockMcpServerClass as unknown as typeof McpServer, 'test', '1.0');

      // good_tool should be registered; failing_tool should NOT be in tools
      // (so next reload retries instead of calling update on a stub)
      expect(entry.tools.has('good_tool')).toBe(true);
      expect(entry.tools.has('failing_tool')).toBe(false);
    });
  });
});
