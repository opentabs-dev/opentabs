import '@src/SidePanel.css';
import { MessageTypes, PROJECT_URL_OBJECT, SERVICE_IDS, useCopyFeedback } from '@extension/shared';
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
import type { ConnectionStatus, ServiceConnection, ServiceId } from '@extension/shared';

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
    ServiceId,
    ServiceConnection
  >,
};

// Service URLs for disconnected state
const SERVICE_URLS = {
  slack: 'https://brex.slack.com',
  datadog_production: 'https://brex-production.datadoghq.com',
  datadog_staging: 'https://brex-staging.datadoghq.com',
  sqlpad_production: 'https://sqlpad.production.brexapps.io',
  sqlpad_staging: 'https://sqlpad.staging.brexapps.io',
  logrocket: 'https://app.logrocket.com',
  retool_production: 'https://retool-v3.infra.brexapps.io',
  retool_staging: 'https://retool-v3.staging.infra.brexapps.io',
  snowflake: 'https://app.snowflake.com',
};

// Fixed width for action buttons to ensure consistent alignment
const ACTION_BUTTON_CLASS = 'w-[120px]';

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

  const handleFocusTab = (serviceId: ServiceId) => {
    chrome.runtime.sendMessage({ type: MessageTypes.FOCUS_TAB, serviceId });
  };

  const relayIcon = <img src={chrome.runtime.getURL('icons/icon.svg')} alt="Connection" className="h-6 w-6" />;
  const relayGrayIcon = <img src={chrome.runtime.getURL('icons/icon-gray.svg')} alt="Connection" className="h-6 w-6" />;

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

            {/* Production Services */}
            <div>
              <SectionLabel>Services</SectionLabel>
              <RetroCard>
                <RetroCardContent className="py-0">
                  <div className="divide-border divide-y">
                    <ConnectionItem
                      icon={<img src={chrome.runtime.getURL('icons/slack.svg')} alt="Slack" className="h-6 w-6" />}
                      disconnectedIcon={
                        <img src={chrome.runtime.getURL('icons/slack-gray.svg')} alt="Slack" className="h-6 w-6" />
                      }
                      label="Slack"
                      connected={status.services.slack.connected}
                      action={
                        status.services.slack.connected
                          ? { label: 'Go to Tab', onClick: () => handleFocusTab('slack') }
                          : { label: 'Open', onClick: () => openUrl(SERVICE_URLS.slack) }
                      }
                    />
                    <ConnectionItem
                      icon={<img src={chrome.runtime.getURL('icons/datadog.svg')} alt="Datadog" className="h-6 w-6" />}
                      disconnectedIcon={
                        <img src={chrome.runtime.getURL('icons/datadog-gray.svg')} alt="Datadog" className="h-6 w-6" />
                      }
                      label="Datadog"
                      connected={status.services.datadog_production.connected}
                      action={
                        status.services.datadog_production.connected
                          ? { label: 'Go to Tab', onClick: () => handleFocusTab('datadog_production') }
                          : { label: 'Open', onClick: () => openUrl(SERVICE_URLS.datadog_production) }
                      }
                    />
                    <ConnectionItem
                      icon={<img src={chrome.runtime.getURL('icons/sqlpad.svg')} alt="SQLPad" className="h-6 w-6" />}
                      disconnectedIcon={
                        <img src={chrome.runtime.getURL('icons/sqlpad-gray.svg')} alt="SQLPad" className="h-6 w-6" />
                      }
                      label="SQLPad"
                      connected={status.services.sqlpad_production.connected}
                      action={
                        status.services.sqlpad_production.connected
                          ? { label: 'Go to Tab', onClick: () => handleFocusTab('sqlpad_production') }
                          : { label: 'Open', onClick: () => openUrl(SERVICE_URLS.sqlpad_production) }
                      }
                    />
                    <ConnectionItem
                      icon={
                        <img src={chrome.runtime.getURL('icons/logrocket.svg')} alt="LogRocket" className="h-6 w-6" />
                      }
                      disconnectedIcon={
                        <img
                          src={chrome.runtime.getURL('icons/logrocket-gray.svg')}
                          alt="LogRocket"
                          className="h-6 w-6"
                        />
                      }
                      label="LogRocket"
                      connected={status.services.logrocket.connected}
                      action={
                        status.services.logrocket.connected
                          ? { label: 'Go to Tab', onClick: () => handleFocusTab('logrocket') }
                          : { label: 'Open', onClick: () => openUrl(SERVICE_URLS.logrocket) }
                      }
                    />
                    <ConnectionItem
                      icon={<img src={chrome.runtime.getURL('icons/retool.svg')} alt="Retool" className="h-6 w-6" />}
                      disconnectedIcon={
                        <img src={chrome.runtime.getURL('icons/retool-gray.svg')} alt="Retool" className="h-6 w-6" />
                      }
                      label="Retool"
                      connected={status.services.retool_production.connected}
                      action={
                        status.services.retool_production.connected
                          ? { label: 'Go to Tab', onClick: () => handleFocusTab('retool_production') }
                          : { label: 'Open', onClick: () => openUrl(SERVICE_URLS.retool_production) }
                      }
                    />
                    <ConnectionItem
                      icon={
                        <img src={chrome.runtime.getURL('icons/snowflake.svg')} alt="Snowflake" className="h-6 w-6" />
                      }
                      disconnectedIcon={
                        <img
                          src={chrome.runtime.getURL('icons/snowflake-gray.svg')}
                          alt="Snowflake"
                          className="h-6 w-6"
                        />
                      }
                      label="Snowflake"
                      connected={status.services.snowflake.connected}
                      action={
                        status.services.snowflake.connected
                          ? { label: 'Go to Tab', onClick: () => handleFocusTab('snowflake') }
                          : { label: 'Open', onClick: () => openUrl(SERVICE_URLS.snowflake) }
                      }
                    />
                  </div>
                </RetroCardContent>
              </RetroCard>
            </div>

            {/* Staging Services */}
            <div className="pb-2">
              <SectionLabel>Staging</SectionLabel>
              <RetroCard>
                <RetroCardContent className="py-0">
                  <div className="divide-border divide-y">
                    <ConnectionItem
                      icon={<img src={chrome.runtime.getURL('icons/datadog.svg')} alt="Datadog" className="h-6 w-6" />}
                      disconnectedIcon={
                        <img src={chrome.runtime.getURL('icons/datadog-gray.svg')} alt="Datadog" className="h-6 w-6" />
                      }
                      label={<StagingLabel name="Datadog" />}
                      connected={status.services.datadog_staging.connected}
                      action={
                        status.services.datadog_staging.connected
                          ? { label: 'Go to Tab', onClick: () => handleFocusTab('datadog_staging') }
                          : { label: 'Open', onClick: () => openUrl(SERVICE_URLS.datadog_staging) }
                      }
                    />
                    <ConnectionItem
                      icon={<img src={chrome.runtime.getURL('icons/sqlpad.svg')} alt="SQLPad" className="h-6 w-6" />}
                      disconnectedIcon={
                        <img src={chrome.runtime.getURL('icons/sqlpad-gray.svg')} alt="SQLPad" className="h-6 w-6" />
                      }
                      label={<StagingLabel name="SQLPad" />}
                      connected={status.services.sqlpad_staging.connected}
                      action={
                        status.services.sqlpad_staging.connected
                          ? { label: 'Go to Tab', onClick: () => handleFocusTab('sqlpad_staging') }
                          : { label: 'Open', onClick: () => openUrl(SERVICE_URLS.sqlpad_staging) }
                      }
                    />
                    <ConnectionItem
                      icon={<img src={chrome.runtime.getURL('icons/retool.svg')} alt="Retool" className="h-6 w-6" />}
                      disconnectedIcon={
                        <img src={chrome.runtime.getURL('icons/retool-gray.svg')} alt="Retool" className="h-6 w-6" />
                      }
                      label={<StagingLabel name="Retool" />}
                      connected={status.services.retool_staging.connected}
                      action={
                        status.services.retool_staging.connected
                          ? { label: 'Go to Tab', onClick: () => handleFocusTab('retool_staging') }
                          : { label: 'Open', onClick: () => openUrl(SERVICE_URLS.retool_staging) }
                      }
                    />
                  </div>
                </RetroCardContent>
              </RetroCard>
            </div>
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
