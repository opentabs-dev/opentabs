import { SearchResults } from './SearchResults';
import { useState } from 'react';
import type { PluginSearchResult, PluginState } from '../bridge';
import type { Meta, StoryObj } from '@storybook/react';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const mockPlugin = (overrides?: Partial<PluginState>): PluginState => ({
  name: 'slack',
  displayName: 'Slack',
  version: '0.1.0',
  trustTier: 'local',
  source: 'local',
  tabState: 'ready',
  urlPatterns: ['*://*.slack.com/*'],
  sdkVersion: '0.0.3',
  tools: [
    {
      name: 'send_message',
      displayName: 'Send Message',
      description: 'Send a message to a channel',
      icon: 'send',
      enabled: true,
    },
    {
      name: 'list_channels',
      displayName: 'List Channels',
      description: 'List all channels in the workspace',
      icon: 'list',
      enabled: true,
    },
  ],
  ...overrides,
});

const mockNpmResult = (overrides?: Partial<PluginSearchResult>): PluginSearchResult => ({
  name: '@opentabs-dev/opentabs-plugin-notion',
  description: 'OpenTabs plugin for Notion — read and write pages, databases, and blocks.',
  version: '1.0.0',
  author: 'opentabs-dev',
  isOfficial: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta<typeof SearchResults> = {
  title: 'Components/SearchResults',
  component: SearchResults,
  decorators: [Story => <div className="w-80">{Story()}</div>],
};

type Story = StoryObj<typeof SearchResults>;

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

const InstalledOnlyDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  return (
    <SearchResults
      plugins={plugins}
      failedPlugins={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      toolFilter="send"
      npmResults={[]}
      npmSearching={false}
      installingPlugins={new Set()}
      onInstall={() => undefined}
      installErrors={new Map()}
    />
  );
};

const InstalledOnly: Story = { render: () => <InstalledOnlyDemo /> };

const NpmOnlyDemo = () => {
  const [plugins, setPlugins] = useState<PluginState[]>([]);
  return (
    <SearchResults
      plugins={plugins}
      failedPlugins={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      toolFilter="notion"
      npmResults={[
        mockNpmResult(),
        mockNpmResult({
          name: '@opentabs-dev/opentabs-plugin-linear',
          description: 'OpenTabs plugin for Linear — manage issues, cycles, and projects.',
          version: '0.8.0',
          isOfficial: false,
        }),
      ]}
      npmSearching={false}
      installingPlugins={new Set()}
      onInstall={() => undefined}
      installErrors={new Map()}
    />
  );
};

const NpmOnly: Story = { render: () => <NpmOnlyDemo /> };

const BothDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  return (
    <SearchResults
      plugins={plugins}
      failedPlugins={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      toolFilter="slack"
      npmResults={[
        mockNpmResult({
          name: 'opentabs-plugin-slack-legacy',
          description: 'Legacy Slack integration for OpenTabs.',
          version: '0.5.0',
          author: 'community',
          isOfficial: false,
        }),
      ]}
      npmSearching={false}
      installingPlugins={new Set()}
      onInstall={() => undefined}
      installErrors={new Map()}
    />
  );
};

const Both: Story = { render: () => <BothDemo /> };

const NoResultsDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  return (
    <SearchResults
      plugins={plugins}
      failedPlugins={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      toolFilter="xyznotexist"
      npmResults={[]}
      npmSearching={false}
      installingPlugins={new Set()}
      onInstall={() => undefined}
      installErrors={new Map()}
    />
  );
};

const NoResults: Story = { render: () => <NoResultsDemo /> };

const NpmLoadingDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  return (
    <SearchResults
      plugins={plugins}
      failedPlugins={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      toolFilter="notion"
      npmResults={[]}
      npmSearching={true}
      installingPlugins={new Set()}
      onInstall={() => undefined}
      installErrors={new Map()}
    />
  );
};

const NpmLoading: Story = { render: () => <NpmLoadingDemo /> };

const InstallingPluginDemo = () => {
  const [plugins, setPlugins] = useState<PluginState[]>([]);
  return (
    <SearchResults
      plugins={plugins}
      failedPlugins={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      toolFilter="notion"
      npmResults={[
        mockNpmResult(),
        mockNpmResult({
          name: '@opentabs-dev/opentabs-plugin-github',
          description: 'OpenTabs plugin for GitHub — create issues, review PRs, and browse repos.',
          version: '1.1.0',
          isOfficial: true,
        }),
      ]}
      npmSearching={false}
      installingPlugins={new Set(['@opentabs-dev/opentabs-plugin-notion'])}
      onInstall={() => undefined}
      installErrors={new Map()}
    />
  );
};

const InstallingPlugin: Story = { render: () => <InstallingPluginDemo /> };

const AllStatesDemo = () => {
  const [plugins1, setPlugins1] = useState([mockPlugin()]);
  const [plugins2, setPlugins2] = useState<PluginState[]>([]);
  const [plugins3, setPlugins3] = useState([mockPlugin()]);
  const [plugins4, setPlugins4] = useState([mockPlugin()]);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground mb-2 font-mono text-xs">Installed only</p>
        <SearchResults
          plugins={plugins1}
          failedPlugins={[]}
          activeTools={new Set()}
          setPlugins={setPlugins1}
          toolFilter="send"
          npmResults={[]}
          npmSearching={false}
          installingPlugins={new Set()}
          onInstall={() => undefined}
          installErrors={new Map()}
        />
      </div>
      <div>
        <p className="text-muted-foreground mb-2 font-mono text-xs">NPM loading</p>
        <SearchResults
          plugins={plugins2}
          failedPlugins={[]}
          activeTools={new Set()}
          setPlugins={setPlugins2}
          toolFilter="notion"
          npmResults={[]}
          npmSearching={true}
          installingPlugins={new Set()}
          onInstall={() => undefined}
          installErrors={new Map()}
        />
      </div>
      <div>
        <p className="text-muted-foreground mb-2 font-mono text-xs">No results</p>
        <SearchResults
          plugins={plugins3}
          failedPlugins={[]}
          activeTools={new Set()}
          setPlugins={setPlugins3}
          toolFilter="xyznotexist"
          npmResults={[]}
          npmSearching={false}
          installingPlugins={new Set()}
          onInstall={() => undefined}
          installErrors={new Map()}
        />
      </div>
      <div>
        <p className="text-muted-foreground mb-2 font-mono text-xs">Both installed + available</p>
        <SearchResults
          plugins={plugins4}
          failedPlugins={[]}
          activeTools={new Set()}
          setPlugins={setPlugins4}
          toolFilter="slack"
          npmResults={[
            mockNpmResult({
              name: 'opentabs-plugin-slack-legacy',
              description: 'Legacy Slack integration.',
              version: '0.5.0',
              author: 'community',
              isOfficial: false,
            }),
          ]}
          npmSearching={false}
          installingPlugins={new Set()}
          onInstall={() => undefined}
          installErrors={new Map()}
        />
      </div>
    </div>
  );
};

const AllStates: Story = { render: () => <AllStatesDemo /> };

export default meta;
export { InstalledOnly, NpmOnly, Both, NoResults, NpmLoading, InstallingPlugin, AllStates };
