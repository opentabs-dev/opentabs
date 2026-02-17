import { getConnectionState, fetchConfigState, handleServerResponse, rejectAllPending } from './bridge.js';
import { DisconnectedState, EmptyState, LoadingState } from './components/EmptyStates.js';
import { Footer } from './components/Footer.js';
import { Header } from './components/Header.js';
import { PluginList } from './components/PluginList.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { PluginState } from './bridge.js';
import type { InternalMessage } from '../types.js';
import type { TabState } from '@opentabs-dev/shared';

const validTabStates: ReadonlySet<string> = new Set<TabState>(['closed', 'unavailable', 'ready']);

const App = () => {
  const [connected, setConnected] = useState(false);
  const [plugins, setPlugins] = useState<PluginState[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTools, setActiveTools] = useState<Set<string>>(new Set());

  const loadPlugins = useCallback(() => {
    fetchConfigState()
      .then(result => {
        setPlugins(result.plugins);
      })
      .catch(() => {
        // Server may not be ready yet
      });
  }, []);

  // Stable ref for the latest loadPlugins so the effect listener always calls
  // the current version without needing loadPlugins in the dependency array.
  const loadPluginsRef = useRef(loadPlugins);
  useEffect(() => {
    loadPluginsRef.current = loadPlugins;
  }, [loadPlugins]);

  useEffect(() => {
    void getConnectionState().then(isConnected => {
      setConnected(isConnected);
      if (isConnected) {
        loadPluginsRef.current();
      }
      setLoading(false);
    });

    const listener = (
      message: InternalMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ): boolean | undefined => {
      if (message.type === 'sp:connectionState') {
        const isConnected = message.data.connected;
        setConnected(isConnected);
        if (isConnected) {
          loadPluginsRef.current();
        } else {
          setPlugins([]);
          setActiveTools(new Set());
          rejectAllPending();
        }
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === 'sp:serverMessage') {
        const data = message.data;

        // Route responses to the bridge's pending-request map (matched by ID)
        if (handleServerResponse(data)) {
          sendResponse({ ok: true });
          return true;
        }

        // Handle notifications (messages with method, no id)

        // plugins.changed notification — refetch the full plugin list
        if (data.method === 'plugins.changed') {
          loadPluginsRef.current();
          sendResponse({ ok: true });
          return true;
        }

        // tab.stateChanged notification
        if (data.method === 'tab.stateChanged' && data.params) {
          const params = data.params as Record<string, unknown>;
          if (
            typeof params.plugin === 'string' &&
            typeof params.state === 'string' &&
            validTabStates.has(params.state)
          ) {
            const pluginName = params.plugin;
            const newState = params.state as TabState;
            setPlugins(prev => prev.map(p => (p.name === pluginName ? { ...p, tabState: newState } : p)));
          }
        }

        // tool.invocationStart notification
        if (data.method === 'tool.invocationStart' && data.params) {
          const params = data.params as Record<string, unknown>;
          if (typeof params.plugin === 'string' && typeof params.tool === 'string') {
            const toolKey = `${params.plugin}:${params.tool}`;
            setActiveTools(prev => new Set(prev).add(toolKey));
          }
        }

        // tool.invocationEnd notification
        if (data.method === 'tool.invocationEnd' && data.params) {
          const params = data.params as Record<string, unknown>;
          if (typeof params.plugin === 'string' && typeof params.tool === 'string') {
            const toolKey = `${params.plugin}:${params.tool}`;
            setActiveTools(prev => {
              const next = new Set(prev);
              next.delete(toolKey);
              return next;
            });
          }
        }

        sendResponse({ ok: true });
        return true;
      }

      // Fallback: ws:message with sync.full is broadcast by the offscreen
      // document to all extension contexts. When the side panel is opened as
      // a regular extension page (not via chrome.sidePanel.open), the
      // background's forwardToSidePanel may not reliably deliver
      // sp:serverMessage. Handling ws:message directly ensures the side panel
      // always refreshes after plugin changes.
      if (message.type === 'ws:message') {
        const wsData = message.data as Record<string, unknown> | undefined;
        if (wsData?.method === 'sync.full') {
          // Delay to let the background finish processing (storage writes, injection)
          setTimeout(() => loadPluginsRef.current(), 1_500);
        }
        return false;
      }

      // Not a side-panel message — don't call sendResponse, return false
      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  return (
    <div className="flex min-h-screen flex-col text-gray-200">
      <Header connected={connected} />
      <main className="flex-1 px-3 py-2">
        {loading ? (
          <LoadingState />
        ) : !connected ? (
          <DisconnectedState />
        ) : plugins.length === 0 ? (
          <EmptyState />
        ) : (
          <PluginList plugins={plugins} activeTools={activeTools} onRefresh={loadPlugins} />
        )}
      </main>
      <Footer />
    </div>
  );
};

export { App };
