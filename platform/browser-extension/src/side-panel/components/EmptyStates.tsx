import { Empty } from './retro/Empty.js';
import { Loader } from './retro/Loader.js';
import { DEFAULT_SERVER_PORT, SERVER_PORT_KEY } from '../../constants.js';
import { useState, useEffect } from 'react';
import type { DisconnectReason } from '../../extension-messages.js';

const ConnectionRefusedState = () => {
  const [port, setPort] = useState(DEFAULT_SERVER_PORT);

  useEffect(() => {
    chrome.storage.local.get(SERVER_PORT_KEY).then(
      result => {
        const stored = result[SERVER_PORT_KEY] as number | undefined;
        if (typeof stored === 'number' && stored >= 1 && stored <= 65535) {
          setPort(stored);
        }
      },
      () => {
        // Storage unavailable — keep default
      },
    );

    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local' || !(SERVER_PORT_KEY in changes)) return;
      const newValue = changes[SERVER_PORT_KEY].newValue as number | undefined;
      if (typeof newValue === 'number' && newValue >= 1 && newValue <= 65535) {
        setPort(newValue);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const command = port === DEFAULT_SERVER_PORT ? 'opentabs start' : `opentabs start --port ${port}`;

  return (
    <Empty className="border-destructive/60">
      <Empty.Content>
        <Empty.Title>Cannot Reach MCP Server</Empty.Title>
        <Empty.Separator className="bg-destructive" />
        <Empty.Description>Start the MCP server:</Empty.Description>
        <code className="border-destructive/40 bg-destructive/10 rounded border-2 px-3 py-2 font-mono text-sm">
          {command}
        </code>
      </Empty.Content>
    </Empty>
  );
};

const AuthFailedState = () => (
  <Empty className="border-destructive/60">
    <Empty.Content>
      <Empty.Title>Authentication Failed</Empty.Title>
      <Empty.Separator className="bg-destructive" />
      <Empty.Description>
        The extension&rsquo;s secret does not match the server. Reload the extension to pick up the latest secret:
      </Empty.Description>
      <code className="border-destructive/40 bg-destructive/10 rounded border-2 px-3 py-2 font-mono text-sm">
        chrome://extensions/ → reload
      </code>
    </Empty.Content>
  </Empty>
);

const DisconnectedState = ({ reason }: { reason?: DisconnectReason }) => {
  if (reason === 'auth_failed') return <AuthFailedState />;
  return <ConnectionRefusedState />;
};

const NoPluginsState = () => (
  <Empty>
    <Empty.Content>
      <Empty.Title>No Plugins Installed</Empty.Title>
      <Empty.Separator />
      <Empty.Description>Search for plugins above or install via CLI:</Empty.Description>
      <code className="rounded border-2 px-3 py-2 font-mono text-sm">opentabs plugin</code>
    </Empty.Content>
  </Empty>
);

const LoadingState = () => <Loader size="md" />;

export { DisconnectedState, NoPluginsState, LoadingState };
