import { useState, useEffect, useCallback } from "react";
import { Unplug, Zap, ChevronDown, ChevronRight } from "lucide-react";
import {
  getConnectionState,
  fetchConfigState,
  setToolEnabled,
  setAllToolsEnabled,
  type PluginState,
} from "./bridge.js";

/** Extract a human-readable domain from a plugin's URL patterns */
const extractDomain = (urlPatterns: string[]): string | null => {
  for (const pattern of urlPatterns) {
    const m = pattern.match(/^(?:\*|https?|ftp):\/\/(\*\.)?(.+?)\//);
    if (m && m[2] && m[2] !== "*") {
      return m[2];
    }
  }
  return null;
};

export const App = () => {
  const [connected, setConnected] = useState(false);
  const [plugins, setPlugins] = useState<PluginState[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTools, setActiveTools] = useState<Set<string>>(new Set());

  const refreshState = useCallback(() => {
    getConnectionState().then((isConnected) => {
      setConnected(isConnected);
      if (isConnected) {
        fetchConfigState();
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refreshState();

    const listener = (
      message: { type: string; data?: Record<string, unknown> },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ): boolean => {
      if (message.type === "sp:connectionState") {
        const isConnected = (message.data as { connected: boolean } | undefined)?.connected === true;
        setConnected(isConnected);
        if (isConnected) {
          fetchConfigState();
        } else {
          setPlugins([]);
        }
      }

      if (message.type === "sp:serverMessage" && message.data) {
        const data = message.data;

        // Handle config.getState response (has result.plugins, no method)
        if (!data.method && data.result) {
          const result = data.result as { plugins?: PluginState[] };
          if (result.plugins) {
            setPlugins(result.plugins);
          }
        }

        // Handle config.setToolEnabled / config.setAllToolsEnabled response
        if (!data.method && data.result && (data.result as { ok?: boolean }).ok) {
          // Re-fetch state to get updated tool enabled states
          fetchConfigState();
        }

        // Handle tab.stateChanged notification
        if (data.method === "tab.stateChanged" && data.params) {
          const params = data.params as Record<string, unknown>;
          const pluginName = params.plugin as string;
          const newState = params.state as "closed" | "unavailable" | "ready";
          setPlugins((prev) =>
            prev.map((p) =>
              p.name === pluginName ? { ...p, tabState: newState } : p
            )
          );
        }

        // Handle tool.invocationStart notification
        if (data.method === "tool.invocationStart" && data.params) {
          const params = data.params as Record<string, unknown>;
          const key = `${params.plugin as string}:${params.tool as string}`;
          setActiveTools((prev) => new Set(prev).add(key));
        }

        // Handle tool.invocationEnd notification
        if (data.method === "tool.invocationEnd" && data.params) {
          const params = data.params as Record<string, unknown>;
          const key = `${params.plugin as string}:${params.tool as string}`;
          setActiveTools((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }
      }

      sendResponse({ ok: true });
      return true;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshState]);

  return (
    <div className="flex flex-col min-h-screen bg-[#0a0a0f] text-gray-200">
      <Header connected={connected} />
      <main className="flex-1 px-3 py-2">
        {loading ? (
          <LoadingState />
        ) : !connected ? (
          <DisconnectedState />
        ) : plugins.length === 0 ? (
          <EmptyState />
        ) : (
          <PluginList plugins={plugins} activeTools={activeTools} />
        )}
      </main>
      <Footer />
    </div>
  );
};

const Header = ({ connected }: { connected: boolean }) => (
  <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
    <div className="flex items-center gap-2">
      <Zap className="w-5 h-5 text-amber-400" />
      <h1 className="text-base font-semibold tracking-tight text-white">OpenTabs</h1>
    </div>
    <div className="flex items-center gap-2">
      <div
        className={`w-2.5 h-2.5 rounded-full ${
          connected
            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
            : "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]"
        } animate-pulse-dot`}
      />
      <span className="text-xs text-gray-400">
        {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  </header>
);

const DisconnectedState = () => (
  <div className="flex flex-col items-center justify-center py-16 px-4 text-center opacity-60">
    <Unplug className="w-12 h-12 text-gray-500 mb-4" />
    <h2 className="text-lg font-medium text-gray-300 mb-2">MCP server not connected</h2>
    <p className="text-sm text-gray-500 max-w-[240px]">
      Start the MCP server to manage your plugins and tools.
    </p>
    <code className="mt-4 px-3 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-400">
      bun --hot platform/mcp-server/dist/index.js
    </code>
  </div>
);

const LoadingState = () => (
  <div className="flex items-center justify-center py-16">
    <div className="w-6 h-6 border-2 border-gray-600 border-t-amber-400 rounded-full animate-spin" />
  </div>
);

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
    <Zap className="w-10 h-10 text-gray-600 mb-3" />
    <h2 className="text-base font-medium text-gray-400 mb-1">No plugins installed</h2>
    <p className="text-sm text-gray-500 max-w-[240px]">
      Add a plugin path to ~/.opentabs/config.json or install one from npm.
    </p>
  </div>
);

const PluginList = ({ plugins, activeTools }: { plugins: PluginState[]; activeTools: Set<string> }) => (
  <div className="space-y-2">
    {plugins.map((plugin) => (
      <PluginCard key={plugin.name} plugin={plugin} activeTools={activeTools} />
    ))}
  </div>
);

const TabStateHint = ({ plugin }: { plugin: PluginState }) => {
  if (plugin.tabState === "ready") return null;

  const domain = extractDomain(plugin.urlPatterns);

  if (plugin.tabState === "closed") {
    return (
      <div className="px-3 pb-2 pl-[38px] text-[11px] text-red-400/80">
        {domain ? `Open ${domain} in your browser` : "Open a matching tab in your browser"}
      </div>
    );
  }

  // unavailable
  return (
    <div className="px-3 pb-2 pl-[38px] text-[11px] text-amber-400/80">
      Log in to {plugin.displayName}
    </div>
  );
};

const PluginCard = ({ plugin, activeTools }: { plugin: PluginState; activeTools: Set<string> }) => {
  const [expanded, setExpanded] = useState(false);

  const stateColor = {
    ready: "bg-emerald-400",
    unavailable: "bg-amber-400",
    closed: "bg-red-400",
  }[plugin.tabState];

  const allEnabled = plugin.tools.length > 0 && plugin.tools.every((t) => t.enabled);
  const someEnabled = plugin.tools.some((t) => t.enabled);

  const handleToggleAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newEnabled = !allEnabled;
    setAllToolsEnabled(plugin.name, newEnabled);
  };

  const handleToggleTool = (toolName: string, currentEnabled: boolean) => {
    setToolEnabled(plugin.name, toolName, !currentEnabled);
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-800/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          )}
          <div className={`w-2 h-2 rounded-full shrink-0 ${stateColor}`} />
          <span className="text-sm font-medium text-gray-200 truncate">
            {plugin.displayName}
          </span>
          <span className="text-xs text-gray-500 shrink-0">v{plugin.version}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TrustBadge tier={plugin.trustTier} />
          <ToggleSwitch
            enabled={allEnabled}
            indeterminate={someEnabled && !allEnabled}
            onClick={handleToggleAll}
          />
        </div>
      </button>

      <TabStateHint plugin={plugin} />

      {expanded && (
        <div className="border-t border-gray-800/50">
          {plugin.tools.map((tool) => (
            <ToolRow
              key={tool.name}
              name={tool.name}
              description={tool.description}
              enabled={tool.enabled}
              active={activeTools.has(`${plugin.name}:${tool.name}`)}
              onToggle={() => handleToggleTool(tool.name, tool.enabled)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ToolRow = ({
  name,
  description,
  enabled,
  active,
  onToggle,
}: {
  name: string;
  description: string;
  enabled: boolean;
  active: boolean;
  onToggle: () => void;
}) => (
  <div className={`flex items-center justify-between px-3 py-2 pl-10 hover:bg-gray-800/20 transition-colors ${active ? "animate-tool-pulse bg-amber-500/5" : ""}`}>
    <div className="flex items-center gap-2 min-w-0 pr-3">
      {active && (
        <div className="w-3 h-3 shrink-0">
          <div className="w-3 h-3 border-[1.5px] border-gray-600 border-t-amber-400 rounded-full animate-spin" />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-300 truncate">{name}</div>
        <div className="text-[11px] text-gray-500 truncate">{description}</div>
      </div>
    </div>
    <ToggleSwitch enabled={enabled} onClick={(e) => { e.stopPropagation(); onToggle(); }} />
  </div>
);

const ToggleSwitch = ({
  enabled,
  indeterminate,
  onClick,
}: {
  enabled: boolean;
  indeterminate?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) => (
  <button
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
      enabled
        ? "bg-amber-500"
        : indeterminate
          ? "bg-amber-500/40"
          : "bg-gray-700"
    }`}
    onClick={onClick}
  >
    <span
      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
        enabled || indeterminate ? "translate-x-[18px]" : "translate-x-[3px]"
      }`}
    />
  </button>
);

const TrustBadge = ({ tier }: { tier: string }) => {
  const styles = {
    official: "bg-blue-900/50 text-blue-300 border-blue-700/50",
    community: "bg-purple-900/50 text-purple-300 border-purple-700/50",
    local: "bg-gray-800/50 text-gray-400 border-gray-700/50",
  }[tier] ?? "bg-gray-800/50 text-gray-400 border-gray-700/50";

  const label = tier.charAt(0).toUpperCase() + tier.slice(1);

  return (
    <span className={`px-1.5 py-0.5 text-[10px] rounded border ${styles}`}>
      {label}
    </span>
  );
};

const Footer = () => (
  <footer className="px-4 py-2 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
    <span>OpenTabs</span>
    <a
      href="https://github.com/nichochar/open-tabs"
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-gray-300 transition-colors"
    >
      Feedback
    </a>
  </footer>
);
