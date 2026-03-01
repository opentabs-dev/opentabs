import {
  getConnectionState,
  fetchConfigState,
  handleServerResponse,
  rejectAllPending,
  sendConfirmationResponse,
  searchPlugins,
  installPlugin,
  removePlugin,
  updatePlugin,
} from './bridge.js';
import { BrowserToolsCard } from './components/BrowserToolsCard.js';
import { ConfirmationDialog } from './components/ConfirmationDialog.js';
import { DisconnectedState, NoPluginsState, LoadingState } from './components/EmptyStates.js';
import { Footer } from './components/Footer.js';
import { PluginList } from './components/PluginList.js';
import { Accordion } from './components/retro/Accordion.js';
import { Input } from './components/retro/Input.js';
import { Tooltip } from './components/retro/Tooltip.js';
import { SearchResults } from './components/SearchResults.js';
import { ERROR_DISPLAY_DURATION_MS } from './constants.js';
import { useServerNotifications } from './hooks/useServerNotifications.js';
import { Search, X } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import type { BrowserToolState, FailedPluginState, PluginSearchResult, PluginState } from './bridge.js';
import type { DisconnectReason, InternalMessage } from '../extension-messages.js';
import type { ConfirmationData } from './components/ConfirmationDialog.js';
import type { TabState } from '@opentabs-dev/shared';

const App = () => {
  const [connected, setConnected] = useState(false);
  const [disconnectReason, setDisconnectReason] = useState<DisconnectReason | undefined>();
  const [plugins, setPlugins] = useState<PluginState[]>([]);
  const [failedPlugins, setFailedPlugins] = useState<FailedPluginState[]>([]);
  const [browserTools, setBrowserTools] = useState<BrowserToolState[]>([]);
  const [serverVersion, setServerVersion] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [activeTools, setActiveTools] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingConfirmations, setPendingConfirmations] = useState<ConfirmationData[]>([]);
  const [npmResults, setNpmResults] = useState<PluginSearchResult[]>([]);
  const [npmSearching, setNpmSearching] = useState(false);
  const [installingPlugins, setInstallingPlugins] = useState<Set<string>>(new Set());
  const [removingPlugins, setRemovingPlugins] = useState<Set<string>>(new Set());
  const [installErrors, setInstallErrors] = useState<Map<string, string>>(new Map());
  const [pluginErrors, setPluginErrors] = useState<Map<string, string>>(new Map());

  const lastFetchRef = useRef(0);
  const pluginErrorTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingTabStates = useRef<Map<string, TabState>>(new Map());
  const npmSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const npmSearchCounter = useRef(0);

  const connectedRef = useRef(connected);
  const loadingRef = useRef(loading);
  const pluginsRef = useRef(plugins);
  const [pluginsLoaded, setPluginsLoaded] = useState(false);

  useEffect(() => {
    connectedRef.current = connected;
    loadingRef.current = loading;
    pluginsRef.current = plugins;
  }, [connected, loading, plugins]);

  const { handleNotification, clearConfirmationTimeout } = useServerNotifications({
    setPlugins,
    setActiveTools,
    setPendingConfirmations,
    pendingTabStates,
  });

  useEffect(
    () => () => {
      for (const timer of pluginErrorTimers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const showPluginError = (pluginName: string, message: string) => {
    const existing = pluginErrorTimers.current.get(pluginName);
    if (existing) clearTimeout(existing);
    setPluginErrors(prev => new Map(prev).set(pluginName, message));
    pluginErrorTimers.current.set(
      pluginName,
      setTimeout(() => {
        setPluginErrors(prev => {
          const next = new Map(prev);
          next.delete(pluginName);
          return next;
        });
        pluginErrorTimers.current.delete(pluginName);
      }, ERROR_DISPLAY_DURATION_MS),
    );
  };

  const clearPluginError = (pluginName: string) => {
    const existing = pluginErrorTimers.current.get(pluginName);
    if (existing) {
      clearTimeout(existing);
      pluginErrorTimers.current.delete(pluginName);
    }
    setPluginErrors(prev => {
      const next = new Map(prev);
      next.delete(pluginName);
      return next;
    });
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    clearTimeout(npmSearchTimer.current);
    if (!query.trim()) {
      setNpmResults([]);
      setNpmSearching(false);
      return;
    }
    setNpmSearching(true);
    const searchId = ++npmSearchCounter.current;
    npmSearchTimer.current = setTimeout(() => {
      searchPlugins(query)
        .then(result => {
          if (npmSearchCounter.current === searchId) {
            setNpmResults(result.results);
          }
        })
        .catch(() => {
          if (npmSearchCounter.current === searchId) {
            setNpmResults([]);
          }
        })
        .finally(() => {
          if (npmSearchCounter.current === searchId) {
            setNpmSearching(false);
          }
        });
    }, 400);
  };

  const handleInstall = (name: string) => {
    setInstallingPlugins(prev => new Set(prev).add(name));
    setInstallErrors(prev => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
    installPlugin(name)
      .then(() => {
        setInstallingPlugins(prev => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
        handleSearchChange('');
      })
      .catch((err: unknown) => {
        setInstallingPlugins(prev => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
        setInstallErrors(prev => new Map(prev).set(name, err instanceof Error ? err.message : String(err)));
      });
  };

  const handleRemove = (pluginName: string) => {
    clearPluginError(pluginName);
    setRemovingPlugins(prev => new Set(prev).add(pluginName));
    removePlugin(pluginName)
      .then(() => {
        setRemovingPlugins(prev => {
          const next = new Set(prev);
          next.delete(pluginName);
          return next;
        });
      })
      .catch((err: unknown) => {
        setRemovingPlugins(prev => {
          const next = new Set(prev);
          next.delete(pluginName);
          return next;
        });
        showPluginError(pluginName, err instanceof Error ? err.message : String(err));
      });
  };

  const handleUpdate = (pluginName: string) => {
    clearPluginError(pluginName);
    updatePlugin(pluginName).catch((err: unknown) => {
      showPluginError(pluginName, err instanceof Error ? err.message : String(err));
    });
  };

  useEffect(() => {
    const loadPlugins = (): Promise<void> => {
      const now = Date.now();
      if (now - lastFetchRef.current < 200) return Promise.resolve();
      lastFetchRef.current = now;
      return fetchConfigState()
        .then(result => {
          let updatedPlugins = result.plugins ?? [];
          if (pendingTabStates.current.size > 0) {
            updatedPlugins = updatedPlugins.map(p => {
              const buffered = pendingTabStates.current.get(p.name);
              return buffered ? { ...p, tabState: buffered } : p;
            });
            pendingTabStates.current.clear();
          }
          setPluginsLoaded(true);
          setPlugins(updatedPlugins);
          setFailedPlugins(result.failedPlugins ?? []);
          setBrowserTools(result.browserTools ?? []);
          setServerVersion(result.serverVersion);
          setActiveTools(prev => {
            const next = new Set<string>();
            for (const key of prev) {
              if (key.startsWith('browser:') || updatedPlugins.some(p => key.startsWith(p.name + ':'))) {
                next.add(key);
              }
            }
            return next;
          });
        })
        .catch(() => {
          // Server may not be ready yet
        });
    };

    void getConnectionState()
      .then(async result => {
        setConnected(result.connected);
        setDisconnectReason(result.disconnectReason);
        if (result.connected) {
          await loadPlugins();
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
          // Keep stale plugin list visible while fresh data loads (prevents flash of empty state)
          void loadPlugins();
        } else {
          setPluginsLoaded(false);
          setPlugins([]);
          setFailedPlugins([]);
          setBrowserTools([]);
          setServerVersion(undefined);
          setActiveTools(new Set());
          setPendingConfirmations([]);
          setSearchQuery('');
          clearTimeout(npmSearchTimer.current);
          setNpmResults([]);
          setNpmSearching(false);
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
          void loadPlugins();
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
          void loadPlugins();
        }
        return false;
      }

      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      clearTimeout(npmSearchTimer.current);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [handleNotification]);

  const handleConfirmationRespond = (
    id: string,
    decision: 'allow_once' | 'allow_always' | 'deny',
    scope?: 'tool_domain' | 'tool_all' | 'domain_all',
  ) => {
    clearConfirmationTimeout(id);
    sendConfirmationResponse(id, decision, scope);
    setPendingConfirmations(prev => prev.filter(c => c.id !== id));
  };

  const handleDenyAll = () => {
    for (const c of pendingConfirmations) {
      clearConfirmationTimeout(c.id);
      sendConfirmationResponse(c.id, 'deny');
    }
    setPendingConfirmations([]);
  };

  const hasContent = plugins.length > 0 || failedPlugins.length > 0 || browserTools.length > 0;
  const showPlugins = !loading && connected && (hasContent || !!searchQuery);
  const showSearchBar = connected && !loading;
  const showNoPlugins = pluginsLoaded && !hasContent && !searchQuery;

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
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search plugins and tools..."
                className="pr-8 pl-9"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => handleSearchChange('')}
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
          ) : showNoPlugins ? (
            <NoPluginsState />
          ) : searchQuery ? (
            <SearchResults
              plugins={plugins}
              failedPlugins={failedPlugins}
              browserTools={browserTools}
              activeTools={activeTools}
              setPlugins={setPlugins}
              setBrowserTools={setBrowserTools}
              toolFilter={searchQuery}
              npmResults={npmResults}
              npmSearching={npmSearching}
              installingPlugins={installingPlugins}
              onInstall={handleInstall}
              installErrors={installErrors}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
              removingPlugins={removingPlugins}
              pluginErrors={pluginErrors}
              serverVersion={serverVersion}
            />
          ) : hasContent ? (
            <>
              {browserTools.length > 0 && (
                <Accordion type="multiple" className="mb-2 space-y-2">
                  <BrowserToolsCard
                    tools={browserTools}
                    activeTools={activeTools}
                    onToolsChange={setBrowserTools}
                    serverVersion={serverVersion}
                  />
                </Accordion>
              )}
              <PluginList
                plugins={plugins}
                failedPlugins={failedPlugins}
                activeTools={activeTools}
                setPlugins={setPlugins}
                toolFilter=""
                onUpdate={handleUpdate}
                onRemove={handleRemove}
                removingPlugins={removingPlugins}
                pluginErrors={pluginErrors}
              />
            </>
          ) : null}
        </main>
        <Footer />
      </div>
    </Tooltip.Provider>
  );
};

export { App };
