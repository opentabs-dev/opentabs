import '@src/SidePanel.css';
import {
  MessageTypes,
  PROJECT_URL_OBJECT,
  SERVICE_IDS,
  SERVICE_REGISTRY,
  getServiceUrl,
  useCopyFeedback,
} from '@extension/shared';
import {
  cn,
  RetroBadge,
  RetroButton,
  RetroCard,
  RetroCardContent,
  RetroTooltip,
  RetroTooltipContent,
  RetroTooltipProvider,
  RetroTooltipTrigger,
} from '@extension/ui';
import { MessageCircle, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ConnectionStatus, ServiceConnection } from '@extension/shared';

// =============================================================================
// Constants
// =============================================================================

const TAGLINES = [
  'Zero tokens, full access',
  'Your cookies, doing actual work',
  'Finally, a use for browser tabs',
  'Bot-free bot access',
  'All the APIs, none of the setup',
  'Turning tabs into tools',
  'Your browser is the API now',
  'Your clipboard deserves a break',
  'Copy-paste is so last year',
  'One fewer API token to manage',
] as const;

// Select random tagline outside of component render to satisfy react-hooks/purity rule
const randomTagline = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];

const DEFAULT_CONNECTION: ServiceConnection = { connected: false };

const DEFAULT_CONNECTION_STATUS: ConnectionStatus = {
  mcpConnected: false,
  services: Object.fromEntries(SERVICE_IDS.map(id => [id, { ...DEFAULT_CONNECTION }])) as Record<
    string,
    ServiceConnection
  >,
};

// Fixed width for action buttons to ensure consistent alignment
const ACTION_BUTTON_CLASS = 'w-[120px]';

// =============================================================================
// Data-driven service items derived from the registry
// =============================================================================

interface ServiceItem {
  serviceId: string;
  displayName: string;
  iconName: string;
  url: string;
  isStaging: boolean;
}

/** Production service items (single-env + production of multi-env) */
const PRODUCTION_ITEMS: ServiceItem[] = SERVICE_REGISTRY.map(def => {
  const serviceId = def.environments.length === 1 ? def.type : `${def.type}_production`;
  return {
    serviceId,
    displayName: def.displayName,
    iconName: def.iconName,
    url: getServiceUrl(serviceId),
    isStaging: false,
  };
});

/** Staging service items (only multi-env services) */
const STAGING_ITEMS: ServiceItem[] = SERVICE_REGISTRY.filter(def => def.environments.includes('staging')).map(def => ({
  serviceId: `${def.type}_staging`,
  displayName: def.displayName,
  iconName: def.iconName,
  url: getServiceUrl(`${def.type}_staging`),
  isStaging: true,
}));

// =============================================================================
// Types
// =============================================================================

interface ConnectionItemProps {
  icon: React.ReactNode;
  disconnectedIcon: React.ReactNode;
  label: React.ReactNode;
  connected: boolean;
  action: {
    label: string;
    onClick: () => void;
  };
}

// =============================================================================
// Components
// =============================================================================

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="px-1 pt-4 pb-1 first:pt-0">
    <span className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">{children}</span>
  </div>
);

const ConnectionItem = ({ icon, disconnectedIcon, label, connected, action }: ConnectionItemProps) => (
  <div className="py-2.5">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center">{connected ? icon : disconnectedIcon}</span>
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <RetroButton
        variant="outline"
        size="sm"
        className={cn(
          ACTION_BUTTON_CLASS,
          'text-white',
          connected ? 'border-connected-border bg-connected' : 'border-disconnected-border bg-disconnected',
        )}
        onClick={action.onClick}>
        {action.label}
      </RetroButton>
    </div>
  </div>
);

/** Inline badge indicating staging environment, placed next to the service label */
const StagingLabel = ({ name }: { name: string }) => (
  <span className="flex items-center gap-1.5">
    {name}
    <RetroBadge variant="outline" size="sm" className="px-1 py-0 text-[9px] leading-tight">
      STG
    </RetroBadge>
  </span>
);

/** Render a single service item from the registry data */
const ServiceConnectionItem = ({
  item,
  connection,
  onFocusTab,
  onOpenUrl,
}: {
  item: ServiceItem;
  connection: ServiceConnection;
  onFocusTab: (serviceId: string) => void;
  onOpenUrl: (url: string) => void;
}) => (
  <ConnectionItem
    icon={<img src={chrome.runtime.getURL(`icons/${item.iconName}.svg`)} alt={item.displayName} className="h-6 w-6" />}
    disconnectedIcon={
      <img src={chrome.runtime.getURL(`icons/${item.iconName}-gray.svg`)} alt={item.displayName} className="h-6 w-6" />
    }
    label={item.isStaging ? <StagingLabel name={item.displayName} /> : item.displayName}
    connected={connection.connected}
    action={
      connection.connected
        ? { label: 'Go to Tab', onClick: () => onFocusTab(item.serviceId) }
        : { label: 'Open', onClick: () => onOpenUrl(item.url) }
    }
  />
);

// =============================================================================
// Helpers
// =============================================================================

const openOptionsPage = () => {
  chrome.runtime.openOptionsPage();
};

const openUrl = (url: string) => {
  chrome.tabs.create({ url });
};

// =============================================================================
// Main Component
// =============================================================================

const SidePanel = () => {
  const [status, setStatus] = useState<ConnectionStatus>(DEFAULT_CONNECTION_STATUS);
  const [loading, setLoading] = useState(true);
  const { copied: mcpCmdCopied, copy: copyMcpCmd } = useCopyFeedback();

  const mcpServerPath = `${__PROJECT_ROOT__}/packages/mcp-server/dist/index.js`;
  const mcpServerCmd = `node ${mcpServerPath}`;

  useEffect(() => {
    // Notify background that side panel is open
    chrome.windows.getCurrent().then(window => {
      if (window.id) {
        chrome.runtime.sendMessage({ type: MessageTypes.SIDE_PANEL_OPENED, windowId: window.id });
      }
    });

    // Listen for close command from background
    const closeListener = (message: { type: string }) => {
      if (message.type === MessageTypes.CLOSE_SIDE_PANEL) {
        window.close();
      }
    };
    chrome.runtime.onMessage.addListener(closeListener);

    // Notify background when side panel is closed
    const handleUnload = () => {
      chrome.windows.getCurrent().then(win => {
        if (win.id) {
          chrome.runtime.sendMessage({ type: MessageTypes.SIDE_PANEL_CLOSED, windowId: win.id }).catch(() => {
            // Ignore errors during unload
          });
        }
      });
    };
    window.addEventListener('beforeunload', handleUnload);

    chrome.runtime.sendMessage({ type: MessageTypes.GET_STATUS }, response => {
      if (chrome.runtime.lastError) {
        console.error('[SidePanel] Failed to get status:', chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      setLoading(false);
      if (response) {
        setStatus(response);
      }
    });

    const listener = (message: { type: string } & ConnectionStatus) => {
      if (message.type === MessageTypes.STATUS_UPDATE) {
        setStatus({
          mcpConnected: message.mcpConnected,
          port: message.port,
          serverPath: message.serverPath,
          services: message.services ?? DEFAULT_CONNECTION_STATUS.services,
        });
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.runtime.onMessage.removeListener(closeListener);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  const handleOpenServerFolder = () => {
    chrome.runtime.sendMessage({ type: MessageTypes.OPEN_SERVER_FOLDER });
  };

  const handleFocusTab = (serviceId: string) => {
    chrome.runtime.sendMessage({ type: MessageTypes.FOCUS_TAB, serviceId });
  };

  const relayIcon = <img src={chrome.runtime.getURL('icons/icon.svg')} alt="Connection" className="h-6 w-6" />;
  const relayGrayIcon = <img src={chrome.runtime.getURL('icons/icon-gray.svg')} alt="Connection" className="h-6 w-6" />;

  const getConnection = (serviceId: string): ServiceConnection => status.services[serviceId] ?? DEFAULT_CONNECTION;

  return (
    <RetroTooltipProvider>
      <div className="bg-background flex h-screen w-full flex-col">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 p-5 pb-4">
          <RetroButton
            variant="outline"
            size="icon"
            className="h-12 w-12 p-1"
            onClick={() => chrome.tabs.create({ url: PROJECT_URL_OBJECT.url })}
            title="View on GitHub">
            <img src={chrome.runtime.getURL('icons/icon.svg')} alt="OpenTabs" className="h-full w-full" />
          </RetroButton>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold tracking-tight">OpenTabs</h1>
            <p className="text-muted-foreground text-xs">{randomTagline}</p>
          </div>
        </div>

        {/* Connection Status - Scrollable Area */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <div className={cn('flex flex-col gap-3 transition-opacity', loading ? 'opacity-0' : 'opacity-100')}>
            {/* Core: MCP Connection */}
            <div>
              <SectionLabel>Core</SectionLabel>
              <RetroCard>
                <RetroCardContent className="py-0">
                  <ConnectionItem
                    icon={relayIcon}
                    disconnectedIcon={relayGrayIcon}
                    label="Relay"
                    connected={status.mcpConnected}
                    action={
                      status.mcpConnected
                        ? {
                            label: 'Open Folder',
                            onClick: handleOpenServerFolder,
                          }
                        : {
                            label: mcpCmdCopied ? 'Copied!' : 'Copy Cmd',
                            onClick: () => copyMcpCmd(mcpServerCmd),
                          }
                    }
                  />
                </RetroCardContent>
              </RetroCard>
            </div>

            {/* Production Services (data-driven) */}
            <div>
              <SectionLabel>Services</SectionLabel>
              <RetroCard>
                <RetroCardContent className="py-0">
                  <div className="divide-border divide-y">
                    {PRODUCTION_ITEMS.map(item => (
                      <ServiceConnectionItem
                        key={item.serviceId}
                        item={item}
                        connection={getConnection(item.serviceId)}
                        onFocusTab={handleFocusTab}
                        onOpenUrl={openUrl}
                      />
                    ))}
                  </div>
                </RetroCardContent>
              </RetroCard>
            </div>

            {/* Staging Services (data-driven) */}
            {STAGING_ITEMS.length > 0 && (
              <div className="pb-2">
                <SectionLabel>Staging</SectionLabel>
                <RetroCard>
                  <RetroCardContent className="py-0">
                    <div className="divide-border divide-y">
                      {STAGING_ITEMS.map(item => (
                        <ServiceConnectionItem
                          key={item.serviceId}
                          item={item}
                          connection={getConnection(item.serviceId)}
                          onFocusTab={handleFocusTab}
                          onOpenUrl={openUrl}
                        />
                      ))}
                    </div>
                  </RetroCardContent>
                </RetroCard>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center gap-2 p-4">
          <RetroTooltip>
            <RetroTooltipTrigger asChild>
              <RetroButton onClick={openOptionsPage} variant="outline" size="icon">
                <Settings className="h-4 w-4" />
              </RetroButton>
            </RetroTooltipTrigger>
            <RetroTooltipContent side="top">
              <p>Settings</p>
            </RetroTooltipContent>
          </RetroTooltip>
          <RetroTooltip>
            <RetroTooltipTrigger asChild>
              <RetroButton
                onClick={() => openUrl('https://brex.enterprise.slack.com/archives/C0ADH9SGFL3')}
                variant="outline"
                size="icon">
                <MessageCircle className="h-4 w-4" />
              </RetroButton>
            </RetroTooltipTrigger>
            <RetroTooltipContent side="top">
              <p>Send Feedback</p>
            </RetroTooltipContent>
          </RetroTooltip>
        </div>
      </div>
    </RetroTooltipProvider>
  );
};

export default SidePanel;
