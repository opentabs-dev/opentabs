import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { expect, within } from 'storybook/test';
import type { BrowserToolState, PluginSearchResult, PluginState } from '../bridge';
import { SearchResults } from './SearchResults';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const mockPlugin = (overrides?: Partial<PluginState>): PluginState => ({
  name: 'slack',
  displayName: 'Slack',
  version: '0.1.0',
  permission: 'auto',
  source: 'local',
  tabState: 'ready',
  urlPatterns: ['*://*.slack.com/*'],
  sdkVersion: '0.0.3',
  reviewed: true,
  hasPreScript: false,
  tools: [
    {
      name: 'send_message',
      displayName: 'Send Message',
      description: 'Send a message to a channel',
      icon: 'send',
      permission: 'auto',
    },
    {
      name: 'list_channels',
      displayName: 'List Channels',
      description: 'List all channels in the workspace',
      icon: 'list',
      permission: 'auto',
    },
  ],
  ...overrides,
});

const mockNpmResult = (overrides?: Partial<PluginSearchResult>): PluginSearchResult => ({
  name: '@opentabs-dev/opentabs-plugin-notion',
  displayName: 'Notion',
  description: 'OpenTabs plugin for Notion — read and write pages, databases, and blocks.',
  version: '1.0.0',
  author: 'opentabs-dev',
  iconSvg: '',
  iconDarkSvg: '',
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
      browserTools={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      setBrowserTools={() => undefined}
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
      browserTools={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      setBrowserTools={() => undefined}
      toolFilter="notion"
      npmResults={[
        mockNpmResult(),
        mockNpmResult({
          name: '@opentabs-dev/opentabs-plugin-linear',
          description: 'OpenTabs plugin for Linear — manage issues, cycles, and projects.',
          version: '0.8.0',
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
      browserTools={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      setBrowserTools={() => undefined}
      toolFilter="slack"
      npmResults={[
        mockNpmResult({
          name: 'opentabs-plugin-slack-legacy',
          description: 'Legacy Slack integration for OpenTabs.',
          version: '0.5.0',
          author: 'community',
        }),
      ]}
      npmSearching={false}
      installingPlugins={new Set()}
      onInstall={() => undefined}
      installErrors={new Map()}
    />
  );
};

const Both: Story = {
  render: () => <BothDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Installed')).toBeVisible();
    await expect(canvas.getByText('Available')).toBeVisible();
  },
};

const NoResultsDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  return (
    <SearchResults
      plugins={plugins}
      failedPlugins={[]}
      browserTools={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      setBrowserTools={() => undefined}
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
      browserTools={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      setBrowserTools={() => undefined}
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
      browserTools={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      setBrowserTools={() => undefined}
      toolFilter="notion"
      npmResults={[
        mockNpmResult(),
        mockNpmResult({
          name: '@opentabs-dev/opentabs-plugin-github',
          description: 'OpenTabs plugin for GitHub — create issues, review PRs, and browse repos.',
          version: '1.1.0',
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

const mockBrowserTools: BrowserToolState[] = [
  { name: 'browser_list_tabs', description: 'List all open browser tabs', permission: 'auto' },
  { name: 'browser_screenshot_tab', description: 'Capture a screenshot of a tab', permission: 'auto' },
];

const WithBrowserToolsDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  const [browserTools, setBrowserTools] = useState(mockBrowserTools);
  return (
    <SearchResults
      plugins={plugins}
      failedPlugins={[]}
      browserTools={browserTools}
      activeTools={new Set()}
      setPlugins={setPlugins}
      setBrowserTools={setBrowserTools}
      toolFilter="browser"
      npmResults={[]}
      npmSearching={false}
      installingPlugins={new Set()}
      onInstall={() => undefined}
      installErrors={new Map()}
      serverVersion="0.0.42"
    />
  );
};

const WithBrowserTools: Story = { render: () => <WithBrowserToolsDemo /> };

const NpmSearchErrorDemo = () => {
  const [plugins, setPlugins] = useState<PluginState[]>([]);
  return (
    <SearchResults
      plugins={plugins}
      failedPlugins={[]}
      browserTools={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      setBrowserTools={() => undefined}
      toolFilter="notion"
      npmResults={[]}
      npmSearching={false}
      npmSearchError={true}
      installingPlugins={new Set()}
      onInstall={() => undefined}
      installErrors={new Map()}
    />
  );
};

const NpmSearchError: Story = { render: () => <NpmSearchErrorDemo /> };

const AllStatesDemo = () => {
  const [plugins1, setPlugins1] = useState([mockPlugin()]);
  const [plugins2, setPlugins2] = useState<PluginState[]>([]);
  const [plugins3, setPlugins3] = useState([mockPlugin()]);
  const [plugins4, setPlugins4] = useState([mockPlugin()]);
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 font-mono text-muted-foreground text-xs">Installed only</p>
        <SearchResults
          plugins={plugins1}
          failedPlugins={[]}
          browserTools={[]}
          activeTools={new Set()}
          setPlugins={setPlugins1}
          setBrowserTools={() => undefined}
          toolFilter="send"
          npmResults={[]}
          npmSearching={false}
          installingPlugins={new Set()}
          onInstall={() => undefined}
          installErrors={new Map()}
        />
      </div>
      <div>
        <p className="mb-2 font-mono text-muted-foreground text-xs">NPM loading</p>
        <SearchResults
          plugins={plugins2}
          failedPlugins={[]}
          browserTools={[]}
          activeTools={new Set()}
          setPlugins={setPlugins2}
          setBrowserTools={() => undefined}
          toolFilter="notion"
          npmResults={[]}
          npmSearching={true}
          installingPlugins={new Set()}
          onInstall={() => undefined}
          installErrors={new Map()}
        />
      </div>
      <div>
        <p className="mb-2 font-mono text-muted-foreground text-xs">No results</p>
        <SearchResults
          plugins={plugins3}
          failedPlugins={[]}
          browserTools={[]}
          activeTools={new Set()}
          setPlugins={setPlugins3}
          setBrowserTools={() => undefined}
          toolFilter="xyznotexist"
          npmResults={[]}
          npmSearching={false}
          installingPlugins={new Set()}
          onInstall={() => undefined}
          installErrors={new Map()}
        />
      </div>
      <div>
        <p className="mb-2 font-mono text-muted-foreground text-xs">Both installed + available</p>
        <SearchResults
          plugins={plugins4}
          failedPlugins={[]}
          browserTools={[]}
          activeTools={new Set()}
          setPlugins={setPlugins4}
          setBrowserTools={() => undefined}
          toolFilter="slack"
          npmResults={[
            mockNpmResult({
              name: 'opentabs-plugin-slack-legacy',
              description: 'Legacy Slack integration.',
              version: '0.5.0',
              author: 'community',
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

const WithInstallErrorDemo = () => {
  const [plugins, setPlugins] = useState<PluginState[]>([]);
  return (
    <SearchResults
      plugins={plugins}
      failedPlugins={[]}
      browserTools={[]}
      activeTools={new Set()}
      setPlugins={setPlugins}
      setBrowserTools={() => undefined}
      toolFilter="notion"
      npmResults={[
        mockNpmResult(),
        mockNpmResult({
          name: '@opentabs-dev/opentabs-plugin-linear',
          description: 'OpenTabs plugin for Linear.',
          version: '0.8.0',
        }),
      ]}
      npmSearching={false}
      installingPlugins={new Set()}
      onInstall={() => undefined}
      installErrors={
        new Map([
          [
            '@opentabs-dev/opentabs-plugin-notion',
            'npm ERR! 404 Not Found - GET https://registry.npmjs.org/@opentabs-dev/opentabs-plugin-notion',
          ],
        ])
      }
    />
  );
};

const WithInstallError: Story = { render: () => <WithInstallErrorDemo /> };

export default meta;
export {
  AllStates,
  Both,
  InstalledOnly,
  InstallingPlugin,
  NoResults,
  NpmLoading,
  NpmOnly,
  NpmSearchError,
  WithBrowserTools,
  WithInstallError,
};
