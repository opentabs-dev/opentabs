import type { Meta, StoryObj } from '@storybook/react';
import { Search, ShieldOff, X } from 'lucide-react';
import { useState } from 'react';
import type { BrowserToolState, FailedPluginState, PluginSearchResult, PluginState } from '../bridge';
import { BrowserToolsCard } from './BrowserToolsCard';
import { DisconnectedState, LoadingState } from './EmptyStates';
import { Footer } from './Footer';
import { PluginCard } from './PluginCard';
import { PluginList } from './PluginList';
import { Accordion } from './retro/Accordion';
import { Input } from './retro/Input';
import { SearchResults } from './SearchResults';

// ---------------------------------------------------------------------------
// Mock data
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
      description: 'List all channels',
      icon: 'list',
      permission: 'auto',
    },
    {
      name: 'search',
      displayName: 'Search',
      description: 'Search messages and files',
      icon: 'search',
      permission: 'auto',
    },
  ],
  ...overrides,
});

const githubPlugin = (): PluginState =>
  mockPlugin({
    name: 'github',
    displayName: 'GitHub',
    urlPatterns: ['*://github.com/*'],
    tabState: 'closed',
    tools: [
      {
        name: 'create_issue',
        displayName: 'Create Issue',
        description: 'Create a new issue',
        icon: 'plus',
        permission: 'auto',
      },
      {
        name: 'list_prs',
        displayName: 'List PRs',
        description: 'List pull requests',
        icon: 'git-pull-request',
        permission: 'auto',
      },
    ],
  });

const datadogPlugin = (): PluginState =>
  mockPlugin({
    name: 'datadog',
    displayName: 'Datadog',
    urlPatterns: ['*://*.datadoghq.com/*'],
    tabState: 'unavailable',
    source: 'npm',
    permission: 'auto',
    tools: [
      {
        name: 'query_metrics',
        displayName: 'Query Metrics',
        description: 'Query time-series metrics',
        icon: 'bar-chart',
        permission: 'auto',
      },
      {
        name: 'list_monitors',
        displayName: 'List Monitors',
        description: 'List active monitors',
        icon: 'activity',
        permission: 'auto',
      },
    ],
  });

const linearPlugin = (): PluginState =>
  mockPlugin({
    name: 'linear',
    displayName: 'Linear',
    urlPatterns: ['*://linear.app/*'],
    tabState: 'ready',
    tools: [
      {
        name: 'create_issue',
        displayName: 'Create Issue',
        description: 'Create a new issue',
        icon: 'plus',
        permission: 'auto',
      },
      {
        name: 'list_issues',
        displayName: 'List Issues',
        description: 'List issues in a project',
        icon: 'list',
        permission: 'auto',
      },
      {
        name: 'update_issue',
        displayName: 'Update Issue',
        description: 'Update an existing issue',
        icon: 'pencil',
        permission: 'auto',
      },
      {
        name: 'search_issues',
        displayName: 'Search Issues',
        description: 'Search across all issues',
        icon: 'search',
        permission: 'auto',
      },
    ],
  });

const jiraPlugin = (): PluginState =>
  mockPlugin({
    name: 'jira',
    displayName: 'Jira',
    urlPatterns: ['*://*.atlassian.net/*'],
    tabState: 'ready',
    source: 'npm',
    permission: 'auto',
    tools: [
      {
        name: 'create_ticket',
        displayName: 'Create Ticket',
        description: 'Create a new Jira ticket',
        icon: 'plus',
        permission: 'auto',
      },
      {
        name: 'search',
        displayName: 'Search',
        description: 'Search issues with JQL',
        icon: 'search',
        permission: 'auto',
      },
      {
        name: 'get_sprint',
        displayName: 'Get Sprint',
        description: 'Get current sprint details',
        icon: 'zap',
        permission: 'auto',
      },
      {
        name: 'update_ticket',
        displayName: 'Update Ticket',
        description: 'Update a ticket',
        icon: 'pencil',
        permission: 'auto',
      },
      {
        name: 'list_boards',
        displayName: 'List Boards',
        description: 'List all boards',
        icon: 'layout-grid',
        permission: 'auto',
      },
      {
        name: 'get_board',
        displayName: 'Get Board',
        description: 'Get board details',
        icon: 'trello',
        permission: 'auto',
      },
    ],
  });

const mockFailedPlugins: FailedPluginState[] = [
  { specifier: '/Users/dev/plugins/broken', error: 'Missing dist/tools.json' },
  { specifier: 'opentabs-plugin-notion', error: 'SDK version 0.1.0 is newer than server 0.0.3 — rebuild the plugin' },
];

const mockBrowserTools: BrowserToolState[] = [
  { name: 'browser_list_tabs', description: 'List all open browser tabs', permission: 'auto' },
  { name: 'browser_open_tab', description: 'Open a new browser tab with a URL', permission: 'auto' },
  { name: 'browser_screenshot_tab', description: 'Capture a screenshot of a tab', permission: 'auto' },
  { name: 'browser_click_element', description: 'Click an element matching a CSS selector', permission: 'auto' },
  { name: 'browser_execute_script', description: 'Execute JavaScript in a tab', permission: 'off' },
  { name: 'extension_get_state', description: 'Get extension internal state', permission: 'auto' },
];

// ---------------------------------------------------------------------------
// Shell — replicates App.tsx layout with the real Footer component
// ---------------------------------------------------------------------------

const SidePanelShell = ({
  children,
  searchBar,
  centered = false,
}: {
  children: React.ReactNode;
  searchBar?: React.ReactNode;
  centered?: boolean;
}) => (
  <div className="flex min-h-screen flex-col text-foreground">
    {searchBar}
    <main className={`flex-1 px-3 py-2 ${centered ? 'flex items-center justify-center' : ''}`}>{children}</main>
    <Footer />
  </div>
);

// ---------------------------------------------------------------------------
// Search bar — matches App.tsx exactly
// ---------------------------------------------------------------------------

const SearchBar = ({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) => (
  <div className="px-3 py-2">
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search plugins and tools..."
        className="pr-8 pl-9"
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: 'SidePanel/Assembled',
  decorators: [Story => <div className="w-80">{Story()}</div>],
};

type Story = StoryObj;

// ---------------------------------------------------------------------------
// 1–4: Static empty states
// ---------------------------------------------------------------------------

const Loading: Story = {
  render: () => (
    <SidePanelShell centered>
      <LoadingState />
    </SidePanelShell>
  ),
};

const Disconnected: Story = {
  render: () => (
    <SidePanelShell centered>
      <DisconnectedState />
    </SidePanelShell>
  ),
};

// ---------------------------------------------------------------------------
// 5–7: Single plugin states
// ---------------------------------------------------------------------------

const SinglePluginReadyDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  return (
    <SidePanelShell>
      <PluginList plugins={plugins} failedPlugins={[]} activeTools={new Set()} setPlugins={setPlugins} toolFilter="" />
    </SidePanelShell>
  );
};

const SinglePluginReady: Story = { render: () => <SinglePluginReadyDemo /> };

const SinglePluginClosedDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin({ tabState: 'closed' })]);
  return (
    <SidePanelShell>
      <PluginList plugins={plugins} failedPlugins={[]} activeTools={new Set()} setPlugins={setPlugins} toolFilter="" />
    </SidePanelShell>
  );
};

const SinglePluginClosed: Story = { render: () => <SinglePluginClosedDemo /> };

const SinglePluginUnavailableDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin({ tabState: 'unavailable' })]);
  return (
    <SidePanelShell>
      <PluginList plugins={plugins} failedPlugins={[]} activeTools={new Set()} setPlugins={setPlugins} toolFilter="" />
    </SidePanelShell>
  );
};

const SinglePluginUnavailable: Story = { render: () => <SinglePluginUnavailableDemo /> };

// ---------------------------------------------------------------------------
// 8: Multiple plugins with mixed tab states
// ---------------------------------------------------------------------------

const MultiplePluginsMixedDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin(), githubPlugin(), datadogPlugin()]);
  return (
    <SidePanelShell>
      <PluginList plugins={plugins} failedPlugins={[]} activeTools={new Set()} setPlugins={setPlugins} toolFilter="" />
    </SidePanelShell>
  );
};

const MultiplePluginsMixed: Story = { render: () => <MultiplePluginsMixedDemo /> };

// ---------------------------------------------------------------------------
// 9: Working plugins + failed plugins
// ---------------------------------------------------------------------------

const WithFailedPluginsDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin(), githubPlugin()]);
  return (
    <SidePanelShell>
      <PluginList
        plugins={plugins}
        failedPlugins={mockFailedPlugins}
        activeTools={new Set()}
        setPlugins={setPlugins}
        toolFilter=""
      />
    </SidePanelShell>
  );
};

const WithFailedPlugins: Story = { render: () => <WithFailedPluginsDemo /> };

// ---------------------------------------------------------------------------
// 10: Many tools (>5 total) with search bar
// ---------------------------------------------------------------------------

const ManyToolsWithSearchDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin(), linearPlugin(), jiraPlugin()]);
  const [toolFilter, setToolFilter] = useState('');
  return (
    <SidePanelShell
      searchBar={<SearchBar value={toolFilter} onChange={setToolFilter} onClear={() => setToolFilter('')} />}>
      <PluginList
        plugins={plugins}
        failedPlugins={[]}
        activeTools={new Set()}
        setPlugins={setPlugins}
        toolFilter={toolFilter}
      />
    </SidePanelShell>
  );
};

const ManyToolsWithSearch: Story = { render: () => <ManyToolsWithSearchDemo /> };

// ---------------------------------------------------------------------------
// 11: Active tool execution (loader animations)
// ---------------------------------------------------------------------------

const ActiveToolExecutionDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  return (
    <SidePanelShell>
      <PluginList
        plugins={plugins}
        failedPlugins={[]}
        activeTools={new Set(['slack:send_message', 'slack:search'])}
        setPlugins={setPlugins}
        toolFilter=""
      />
    </SidePanelShell>
  );
};

const ActiveToolExecution: Story = { render: () => <ActiveToolExecutionDemo /> };

// ---------------------------------------------------------------------------
// 12: All tools disabled
// ---------------------------------------------------------------------------

const AllToolsDisabledDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({
      tools: [
        {
          name: 'send_message',
          displayName: 'Send Message',
          description: 'Send a message to a channel',
          icon: 'send',
          permission: 'off',
        },
        {
          name: 'list_channels',
          displayName: 'List Channels',
          description: 'List all channels',
          icon: 'list',
          permission: 'off',
        },
        {
          name: 'search',
          displayName: 'Search',
          description: 'Search messages and files',
          icon: 'search',
          permission: 'off',
        },
      ],
    }),
  ]);
  return (
    <SidePanelShell>
      <PluginList plugins={plugins} failedPlugins={[]} activeTools={new Set()} setPlugins={setPlugins} toolFilter="" />
    </SidePanelShell>
  );
};

const AllToolsDisabled: Story = { render: () => <AllToolsDisabledDemo /> };

// ---------------------------------------------------------------------------
// 13: Tool filter active (pre-filled search)
// ---------------------------------------------------------------------------

const ToolFilterActiveDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin(), linearPlugin(), jiraPlugin()]);
  const [toolFilter, setToolFilter] = useState('search');
  return (
    <SidePanelShell
      searchBar={<SearchBar value={toolFilter} onChange={setToolFilter} onClear={() => setToolFilter('')} />}>
      <PluginList
        plugins={plugins}
        failedPlugins={[]}
        activeTools={new Set()}
        setPlugins={setPlugins}
        toolFilter={toolFilter}
      />
    </SidePanelShell>
  );
};

const ToolFilterActive: Story = { render: () => <ToolFilterActiveDemo /> };

// ---------------------------------------------------------------------------
// 14: Mock npm search results
// ---------------------------------------------------------------------------

const mockNpmResults: PluginSearchResult[] = [
  {
    name: '@opentabs-dev/opentabs-plugin-notion',
    displayName: 'Notion',
    description: 'OpenTabs plugin for Notion — manage pages, databases, and content blocks',
    version: '1.0.0',
    author: 'opentabs-dev',
    iconSvg: '',
    iconDarkSvg: '',
  },
  {
    name: '@opentabs-dev/opentabs-plugin-confluence',
    displayName: 'Confluence',
    description: 'OpenTabs plugin for Confluence — search and edit wiki pages',
    version: '0.3.2',
    author: 'opentabs-dev',
    iconSvg: '',
    iconDarkSvg: '',
  },
  {
    name: 'opentabs-plugin-asana',
    displayName: 'Asana',
    description: 'Community plugin for Asana task management with full CRUD operations',
    version: '0.1.4',
    author: 'community-dev',
    iconSvg: '',
    iconDarkSvg: '',
  },
];

// ---------------------------------------------------------------------------
// 15–18: Omnisearch stories
// ---------------------------------------------------------------------------

const OmnisearchEmptyDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin(), githubPlugin()]);
  const [searchQuery, setSearchQuery] = useState('');
  return (
    <SidePanelShell
      searchBar={<SearchBar value={searchQuery} onChange={setSearchQuery} onClear={() => setSearchQuery('')} />}>
      <PluginList plugins={plugins} failedPlugins={[]} activeTools={new Set()} setPlugins={setPlugins} toolFilter="" />
    </SidePanelShell>
  );
};

const OmnisearchEmpty: Story = { render: () => <OmnisearchEmptyDemo /> };

const OmnisearchWithResultsDemo = () => {
  const plugins = [mockPlugin(), githubPlugin()];
  return (
    <SidePanelShell searchBar={<SearchBar value="notion" onChange={() => undefined} onClear={() => undefined} />}>
      <SearchResults
        plugins={plugins}
        failedPlugins={[]}
        browserTools={[]}
        activeTools={new Set()}
        setPlugins={() => undefined}
        setBrowserTools={() => undefined}
        toolFilter="notion"
        npmResults={mockNpmResults.slice(0, 1)}
        npmSearching={false}
        installingPlugins={new Set()}
        onInstall={() => undefined}
        installErrors={new Map()}
      />
    </SidePanelShell>
  );
};

const OmnisearchWithResults: Story = { render: () => <OmnisearchWithResultsDemo /> };

const OmnisearchNpmLoadingDemo = () => {
  const plugins = [mockPlugin(), githubPlugin()];
  return (
    <SidePanelShell searchBar={<SearchBar value="notion" onChange={() => undefined} onClear={() => undefined} />}>
      <SearchResults
        plugins={plugins}
        failedPlugins={[]}
        browserTools={[]}
        activeTools={new Set()}
        setPlugins={() => undefined}
        setBrowserTools={() => undefined}
        toolFilter="notion"
        npmResults={[]}
        npmSearching={true}
        installingPlugins={new Set()}
        onInstall={() => undefined}
        installErrors={new Map()}
      />
    </SidePanelShell>
  );
};

const OmnisearchNpmLoading: Story = { render: () => <OmnisearchNpmLoadingDemo /> };

const OmnisearchInstallingDemo = () => {
  const plugins = [mockPlugin(), githubPlugin()];
  return (
    <SidePanelShell searchBar={<SearchBar value="notion" onChange={() => undefined} onClear={() => undefined} />}>
      <SearchResults
        plugins={plugins}
        failedPlugins={[]}
        browserTools={[]}
        activeTools={new Set()}
        setPlugins={() => undefined}
        setBrowserTools={() => undefined}
        toolFilter="notion"
        npmResults={mockNpmResults}
        npmSearching={false}
        installingPlugins={new Set(['@opentabs-dev/opentabs-plugin-notion'])}
        onInstall={() => undefined}
        installErrors={new Map()}
      />
    </SidePanelShell>
  );
};

const OmnisearchInstalling: Story = { render: () => <OmnisearchInstallingDemo /> };

// ---------------------------------------------------------------------------
// Plugin with update available (for PluginUpdating story)
// ---------------------------------------------------------------------------

const pluginWithUpdate = (): PluginState =>
  mockPlugin({
    name: 'datadog',
    displayName: 'Datadog',
    source: 'npm',
    permission: 'auto',
    tabState: 'unavailable',
    urlPatterns: ['*://*.datadoghq.com/*'],
    update: { latestVersion: '0.2.0', updateCommand: 'npm install @opentabs-dev/opentabs-plugin-datadog@0.2.0' },
    tools: [
      {
        name: 'query_metrics',
        displayName: 'Query Metrics',
        description: 'Query time-series metrics',
        icon: 'bar-chart',
        permission: 'auto',
      },
      {
        name: 'list_monitors',
        displayName: 'List Monitors',
        description: 'List active monitors',
        icon: 'activity',
        permission: 'auto',
      },
    ],
  });

// ---------------------------------------------------------------------------
// 19: Omnisearch — only installed results
// ---------------------------------------------------------------------------

const OmnisearchInstalledResultsDemo = () => {
  const plugins = [mockPlugin(), githubPlugin()];
  return (
    <SidePanelShell searchBar={<SearchBar value="slack" onChange={() => undefined} onClear={() => undefined} />}>
      <SearchResults
        plugins={plugins}
        failedPlugins={[]}
        browserTools={[]}
        activeTools={new Set()}
        setPlugins={() => undefined}
        setBrowserTools={() => undefined}
        toolFilter="slack"
        npmResults={[]}
        npmSearching={false}
        installingPlugins={new Set()}
        onInstall={() => undefined}
        installErrors={new Map()}
      />
    </SidePanelShell>
  );
};

const OmnisearchInstalledResults: Story = { render: () => <OmnisearchInstalledResultsDemo /> };

// ---------------------------------------------------------------------------
// 20: Omnisearch — only npm results
// ---------------------------------------------------------------------------

const OmnisearchNpmResultsDemo = () => {
  const plugins: PluginState[] = [];
  return (
    <SidePanelShell searchBar={<SearchBar value="notion" onChange={() => undefined} onClear={() => undefined} />}>
      <SearchResults
        plugins={plugins}
        failedPlugins={[]}
        browserTools={[]}
        activeTools={new Set()}
        setPlugins={() => undefined}
        setBrowserTools={() => undefined}
        toolFilter="notion"
        npmResults={mockNpmResults}
        npmSearching={false}
        installingPlugins={new Set()}
        onInstall={() => undefined}
        installErrors={new Map()}
      />
    </SidePanelShell>
  );
};

const OmnisearchNpmResults: Story = { render: () => <OmnisearchNpmResultsDemo /> };

// ---------------------------------------------------------------------------
// 21: Omnisearch — mixed (installed + npm results simultaneously)
// ---------------------------------------------------------------------------

const OmnisearchMixedDemo = () => {
  const plugins = [mockPlugin(), githubPlugin()];
  return (
    <SidePanelShell searchBar={<SearchBar value="github" onChange={() => undefined} onClear={() => undefined} />}>
      <SearchResults
        plugins={plugins}
        failedPlugins={[]}
        browserTools={[]}
        activeTools={new Set()}
        setPlugins={() => undefined}
        setBrowserTools={() => undefined}
        toolFilter="github"
        npmResults={mockNpmResults}
        npmSearching={false}
        installingPlugins={new Set()}
        onInstall={() => undefined}
        installErrors={new Map()}
      />
    </SidePanelShell>
  );
};

const OmnisearchMixed: Story = { render: () => <OmnisearchMixedDemo /> };

// ---------------------------------------------------------------------------
// 22: Omnisearch — no results
// ---------------------------------------------------------------------------

const OmnisearchNoResultsDemo = () => {
  const plugins = [mockPlugin(), githubPlugin()];
  return (
    <SidePanelShell searchBar={<SearchBar value="xyzzy" onChange={() => undefined} onClear={() => undefined} />}>
      <SearchResults
        plugins={plugins}
        failedPlugins={[]}
        browserTools={[]}
        activeTools={new Set()}
        setPlugins={() => undefined}
        setBrowserTools={() => undefined}
        toolFilter="xyzzy"
        npmResults={[]}
        npmSearching={false}
        installingPlugins={new Set()}
        onInstall={() => undefined}
        installErrors={new Map()}
      />
    </SidePanelShell>
  );
};

const OmnisearchNoResults: Story = { render: () => <OmnisearchNoResultsDemo /> };

// ---------------------------------------------------------------------------
// 23: Plugin with context menu visible (npm plugin, three-dot icon always shown)
// ---------------------------------------------------------------------------

const PluginWithContextMenuDemo = () => {
  const [plugins, setPlugins] = useState([datadogPlugin()]);
  return (
    <SidePanelShell>
      <PluginList
        plugins={plugins}
        failedPlugins={[]}
        activeTools={new Set()}
        setPlugins={setPlugins}
        toolFilter=""
        onUpdate={() => undefined}
        onRemove={() => undefined}
      />
    </SidePanelShell>
  );
};

const PluginWithContextMenu: Story = { render: () => <PluginWithContextMenuDemo /> };

// ---------------------------------------------------------------------------
// 24: Plugin removing — card shows opacity-60 while uninstall is in progress
// ---------------------------------------------------------------------------

const PluginRemovingDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin(), datadogPlugin()]);
  return (
    <SidePanelShell>
      <PluginList
        plugins={plugins}
        failedPlugins={[]}
        activeTools={new Set()}
        setPlugins={setPlugins}
        toolFilter=""
        onUpdate={() => undefined}
        onRemove={() => undefined}
        removingPlugins={new Set(['datadog'])}
      />
    </SidePanelShell>
  );
};

const PluginRemoving: Story = { render: () => <PluginRemovingDemo /> };

// ---------------------------------------------------------------------------
// 25: Plugin updating — card shows loader in context menu while update runs
// ---------------------------------------------------------------------------

const PluginUpdatingDemo = () => {
  const plugin = pluginWithUpdate();
  return (
    <SidePanelShell>
      <Accordion type="multiple" className="space-y-2">
        <PluginCard
          plugin={plugin}
          activeTools={new Set()}
          setPlugins={() => undefined}
          toolFilter=""
          onUpdate={() => undefined}
          onRemove={() => undefined}
          updatingPlugin={true}
        />
      </Accordion>
    </SidePanelShell>
  );
};

const PluginUpdating: Story = { render: () => <PluginUpdatingDemo /> };

// ---------------------------------------------------------------------------
// 26: Browser tools + plugins (BrowserToolsCard above PluginList)
// ---------------------------------------------------------------------------

const WithBrowserToolsDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin(), githubPlugin()]);
  const [browserTools, setBrowserTools] = useState(mockBrowserTools);
  return (
    <SidePanelShell>
      <Accordion type="multiple" className="mb-2 space-y-2">
        <BrowserToolsCard
          tools={browserTools}
          activeTools={new Set()}
          onToolsChange={updater => setBrowserTools(updater)}
          serverVersion="0.0.42"
        />
      </Accordion>
      <PluginList plugins={plugins} failedPlugins={[]} activeTools={new Set()} setPlugins={setPlugins} toolFilter="" />
    </SidePanelShell>
  );
};

const WithBrowserTools: Story = { render: () => <WithBrowserToolsDemo /> };

// ---------------------------------------------------------------------------
// 27: Browser tools only — no plugins installed, BrowserToolsCard shown alone
// ---------------------------------------------------------------------------

const BrowserToolsOnlyDemo = () => {
  const [browserTools, setBrowserTools] = useState(mockBrowserTools);
  return (
    <SidePanelShell>
      <Accordion type="multiple" className="mb-2 space-y-2">
        <BrowserToolsCard
          tools={browserTools}
          activeTools={new Set()}
          onToolsChange={updater => setBrowserTools(updater)}
          serverVersion="0.0.42"
        />
      </Accordion>
    </SidePanelShell>
  );
};

const BrowserToolsOnly: Story = { render: () => <BrowserToolsOnlyDemo /> };

// ---------------------------------------------------------------------------
// 28: Skip-permissions banner — warning shown when OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS is set
// ---------------------------------------------------------------------------

const SkipPermissionsBannerDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin(), githubPlugin()]);
  const [browserTools, setBrowserTools] = useState(mockBrowserTools);
  return (
    <SidePanelShell>
      <div className="shrink-0 border-destructive border-b-2 bg-destructive/15 px-4 py-1.5">
        <div className="flex items-center gap-1.5">
          <ShieldOff className="h-3.5 w-3.5 shrink-0 text-destructive" />
          <span className="font-head text-destructive text-xs uppercase">Approvals skipped</span>
        </div>
        <p className="mt-0.5 text-[11px] text-foreground/70 leading-tight">
          AI runs tools without asking. Off tools stay off. Set by{' '}
          <code className="font-mono">OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS</code>.
        </p>
      </div>
      <Accordion type="multiple" className="mt-2 mb-2 space-y-2">
        <BrowserToolsCard
          tools={browserTools}
          activeTools={new Set()}
          onToolsChange={updater => setBrowserTools(updater)}
          serverVersion="0.0.42"
        />
      </Accordion>
      <PluginList plugins={plugins} failedPlugins={[]} activeTools={new Set()} setPlugins={setPlugins} toolFilter="" />
    </SidePanelShell>
  );
};

const SkipPermissionsBanner: Story = { render: () => <SkipPermissionsBannerDemo /> };

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default meta;
export {
  ActiveToolExecution,
  AllToolsDisabled,
  BrowserToolsOnly,
  Disconnected,
  Loading,
  ManyToolsWithSearch,
  MultiplePluginsMixed,
  OmnisearchEmpty,
  OmnisearchInstalledResults,
  OmnisearchInstalling,
  OmnisearchMixed,
  OmnisearchNoResults,
  OmnisearchNpmLoading,
  OmnisearchNpmResults,
  OmnisearchWithResults,
  PluginRemoving,
  PluginUpdating,
  PluginWithContextMenu,
  SinglePluginClosed,
  SinglePluginReady,
  SinglePluginUnavailable,
  SkipPermissionsBanner,
  ToolFilterActive,
  WithBrowserTools,
  WithFailedPlugins,
};
