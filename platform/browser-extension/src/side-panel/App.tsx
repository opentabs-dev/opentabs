import {
  getConnectionState,
  fetchConfigState,
  handleServerResponse,
  rejectAllPending,
  sendConfirmationResponse,
} from './bridge.js';
import { ConfirmationDialog } from './components/ConfirmationDialog.js';
import { DisconnectedState, NoPluginsState, LoadingState } from './components/EmptyStates.js';
import { Footer } from './components/Footer.js';
import { PluginList } from './components/PluginList.js';
import { Input } from './components/retro/Input.js';
import { Tooltip } from './components/retro/Tooltip.js';
import { useServerNotifications } from './hooks/useServerNotifications.js';
import { Search, X } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { FailedPluginState, PluginState } from './bridge.js';
import type { DisconnectReason, InternalMessage } from '../extension-messages.js';
import type { ConfirmationData } from './components/ConfirmationDialog.js';
import type { TabState } from '@opentabs-dev/shared';

const App = () => {
  const [connected, setConnected] = useState(false);
  const [disconnectReason, setDisconnectReason] = useState<DisconnectReason | undefined>();
  const [plugins, setPlugins] = useState<PluginState[]>([]);
  const [failedPlugins, setFailedPlugins] = useState<FailedPluginState[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTools, setActiveTools] = useState<Set<string>>(new Set());
  const [toolFilter, setToolFilter] = useState('');
  const [pendingConfirmations, setPendingConfirmations] = useState<ConfirmationData[]>([]);

  const lastFetchRef = useRef(0);
  const pendingTabStates = useRef<Map<string, TabState>>(new Map());

  const connectedRef = useRef(connected);
  const loadingRef = useRef(loading);
  const pluginsRef = useRef(plugins);

  useEffect(() => {
    connectedRef.current = connected;
    loadingRef.current = loading;
    pluginsRef.current = plugins;
  }, [connected, loading, plugins]);

  const loadPlugins = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchRef.current < 200) return;
    lastFetchRef.current = now;
    fetchConfigState()
      .then(result => {
        let updatedPlugins = result.plugins;
        if (pendingTabStates.current.size > 0) {
          updatedPlugins = updatedPlugins.map(p => {
            const buffered = pendingTabStates.current.get(p.name);
            return buffered ? { ...p, tabState: buffered } : p;
          });
          pendingTabStates.current.clear();
        }
        setPlugins(updatedPlugins);
        setFailedPlugins(result.failedPlugins);
        setActiveTools(prev => {
          const next = new Set<string>();
          for (const key of prev) {
            if (updatedPlugins.some(p => key.startsWith(p.name + ':'))) {
              next.add(key);
            }
          }
          return next;
        });
      })
      .catch(() => {
        // Server may not be ready yet
      });
  }, [setActiveTools]);

  const { handleNotification, clearConfirmationTimeout } = useServerNotifications({
    setPlugins,
    setActiveTools,
    setPendingConfirmations,
    pendingTabStates,
  });

  useEffect(() => {
    void getConnectionState()
      .then(result => {
        setConnected(result.connected);
        setDisconnectReason(result.disconnectReason);
        if (result.connected) {
          loadPlugins();
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    const listener = (
      message: InternalMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ): boolean | undefined => {
      if (message.type === 'sp:getState') {
        const rootEl = document.getElementById('root');
        const html = rootEl ? rootEl.innerHTML.slice(0, 50000) : '';
        const currentPlugins = pluginsRef.current;
        sendResponse({
          state: {
            connected: connectedRef.current,
            loading: loadingRef.current,
            pluginCount: currentPlugins.length,
            plugins: currentPlugins.map(p => ({ name: p.name, tabState: p.tabState })),
          },
          html,
        });
        return true;
      }

      if (message.type === 'sp:connectionState') {
        const isConnected = message.data.connected;
        setConnected(isConnected);
        setDisconnectReason(isConnected ? undefined : message.data.disconnectReason);
        if (isConnected) {
          loadPlugins();
        } else {
          setPlugins([]);
          setFailedPlugins([]);
          setActiveTools(new Set());
          setPendingConfirmations([]);
          setToolFilter('');
          rejectAllPending();
        }
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === 'sp:serverMessage') {
        const data = message.data;

        if (handleServerResponse(data)) {
          sendResponse({ ok: true });
          return true;
        }

        if (data.method === 'plugins.changed') {
          loadPlugins();
          sendResponse({ ok: true });
          return true;
        }

        handleNotification(data);
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === 'ws:message') {
        const wsData = message.data as Record<string, unknown> | undefined;
        if (wsData?.method === 'sync.full') {
          loadPlugins();
        }
        return false;
      }

      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [loadPlugins, handleNotification]);

  const handleConfirmationRespond = useCallback(
    (
      id: string,
      decision: 'allow_once' | 'allow_always' | 'deny',
      scope?: 'tool_domain' | 'tool_all' | 'domain_all',
    ) => {
      clearConfirmationTimeout(id);
      sendConfirmationResponse(id, decision, scope);
      setPendingConfirmations(prev => prev.filter(c => c.id !== id));
    },
    [clearConfirmationTimeout],
  );

  const handleDenyAll = useCallback(() => {
    for (const c of pendingConfirmations) {
      clearConfirmationTimeout(c.id);
      sendConfirmationResponse(c.id, 'deny');
    }
    setPendingConfirmations([]);
  }, [pendingConfirmations, clearConfirmationTimeout]);

  const totalTools = plugins.reduce((sum, p) => sum + p.tools.length, 0);
  const hasContent = plugins.length > 0 || failedPlugins.length > 0;
  const showPlugins = !loading && connected && hasContent;
  const showSearchBar = connected && !loading && totalTools > 5;

  return (
    <Tooltip.Provider>
      <div className="text-foreground flex min-h-screen flex-col">
        {connected && pendingConfirmations.length > 0 && (
          <ConfirmationDialog
            confirmations={pendingConfirmations}
            onRespond={handleConfirmationRespond}
            onDenyAll={handleDenyAll}
          />
        )}
        {showSearchBar && (
          <div className="pt-4 pr-5 pb-2 pl-4">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2" />
              <Input
                value={toolFilter}
                onChange={e => setToolFilter(e.target.value)}
                placeholder="Filter tools..."
                className="pr-8 pl-9"
              />
              {toolFilter && (
                <button
                  type="button"
                  onClick={() => setToolFilter('')}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}
        <main
          className={`flex-1 pr-5 pb-2 pl-4 ${showSearchBar ? 'pt-2' : 'pt-4'} ${showPlugins ? '' : 'flex items-center justify-center'}`}>
          {loading ? (
            <LoadingState />
          ) : !connected ? (
            <DisconnectedState reason={disconnectReason} />
          ) : !hasContent ? (
            <NoPluginsState />
          ) : (
            <PluginList
              plugins={plugins}
              failedPlugins={failedPlugins}
              activeTools={activeTools}
              setPlugins={setPlugins}
              toolFilter={toolFilter}
            />
          )}
        </main>
        <Footer />
      </div>
    </Tooltip.Provider>
  );
};

export { App };
