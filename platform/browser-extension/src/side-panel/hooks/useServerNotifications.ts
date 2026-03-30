import type { TabState } from '@opentabs-dev/shared';
import { useEffect, useRef } from 'react';
import { VALID_PLUGIN_NAME } from '../../constants.js';
import type { PluginState } from '../bridge.js';
import type { ConfirmationData } from '../components/ConfirmationDialog.js';
import { TOOL_INVOCATION_TIMEOUT_MS } from '../constants.js';

const validTabStates: ReadonlySet<string> = new Set<TabState>(['closed', 'unavailable', 'ready']);

interface UseServerNotificationsParams {
  setPlugins: React.Dispatch<React.SetStateAction<PluginState[]>>;
  setActiveTools: React.Dispatch<React.SetStateAction<Set<string>>>;
  setPendingConfirmations: React.Dispatch<React.SetStateAction<ConfirmationData[]>>;
}

interface UseServerNotificationsResult {
  handleNotification: (data: Record<string, unknown>) => void;
  clearSeenId: (id: string) => void;
  clearAllSeenIds: () => void;
}

/**
 * Returns a stable callback that processes server notification messages
 * (confirmation.request, tab.stateChanged, tool.invocationStart, tool.invocationEnd).
 */
const useServerNotifications = ({
  setPlugins,
  setActiveTools,
  setPendingConfirmations,
}: UseServerNotificationsParams): UseServerNotificationsResult => {
  const seenConfirmationIds = useRef<Set<string>>(new Set());
  const invocationTimeoutIds = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const invocationMap = invocationTimeoutIds.current;
    return () => {
      for (const id of invocationMap.values()) {
        clearTimeout(id);
      }
      invocationMap.clear();
    };
  }, []);

  const handleNotification = (data: Record<string, unknown>): void => {
    if (data.method === 'confirmation.request' && data.params) {
      const params = data.params as Record<string, unknown>;
      if (typeof params.id === 'string' && typeof params.tool === 'string') {
        // Skip duplicate confirmations (e.g., real-time sp:serverMessage
        // followed by bg:getFullState hydration for the same id).
        if (seenConfirmationIds.current.has(params.id)) return;
        seenConfirmationIds.current.add(params.id);

        const confirmation: ConfirmationData = {
          id: params.id,
          tool: params.tool,
          plugin: typeof params.plugin === 'string' ? params.plugin : 'unknown',
          params:
            typeof params.params === 'object' && params.params !== null
              ? (params.params as Record<string, unknown>)
              : {},
        };

        setPendingConfirmations(prev => (prev.some(c => c.id === confirmation.id) ? prev : [...prev, confirmation]));
      }
    }

    if (data.method === 'tab.stateChanged' && data.params) {
      const params = data.params as Record<string, unknown>;
      if (
        typeof params.plugin === 'string' &&
        typeof params.state === 'string' &&
        validTabStates.has(params.state) &&
        VALID_PLUGIN_NAME.test(params.plugin)
      ) {
        const pluginName = params.plugin;
        const newState = params.state as TabState;
        setPlugins(prev => prev.map(p => (p.name === pluginName ? { ...p, tabState: newState } : p)));
      }
    }

    if (data.method === 'tool.invocationStart' && data.params) {
      const params = data.params as Record<string, unknown>;
      if (
        typeof params.plugin === 'string' &&
        typeof params.tool === 'string' &&
        VALID_PLUGIN_NAME.test(params.plugin)
      ) {
        const toolKey = `${params.plugin}:${params.tool}`;
        setActiveTools(prev => new Set(prev).add(toolKey));
        const existingTid = invocationTimeoutIds.current.get(toolKey);
        if (existingTid !== undefined) clearTimeout(existingTid);
        const tid = setTimeout(() => {
          invocationTimeoutIds.current.delete(toolKey);
          setActiveTools(prev => {
            const next = new Set(prev);
            next.delete(toolKey);
            return next;
          });
        }, TOOL_INVOCATION_TIMEOUT_MS);
        invocationTimeoutIds.current.set(toolKey, tid);
      }
    }

    if (data.method === 'tool.invocationEnd' && data.params) {
      const params = data.params as Record<string, unknown>;
      if (
        typeof params.plugin === 'string' &&
        typeof params.tool === 'string' &&
        VALID_PLUGIN_NAME.test(params.plugin)
      ) {
        const toolKey = `${params.plugin}:${params.tool}`;
        const tid = invocationTimeoutIds.current.get(toolKey);
        if (tid !== undefined) {
          clearTimeout(tid);
          invocationTimeoutIds.current.delete(toolKey);
        }
        setActiveTools(prev => {
          const next = new Set(prev);
          next.delete(toolKey);
          return next;
        });
      }
    }
  };

  const clearSeenId = (id: string): void => {
    seenConfirmationIds.current.delete(id);
  };

  const clearAllSeenIds = (): void => {
    seenConfirmationIds.current.clear();
  };

  return { handleNotification, clearSeenId, clearAllSeenIds };
};

export { useServerNotifications };
