import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { expect, screen, userEvent, within } from 'storybook/test';
import type { PluginState } from '../bridge';
import { PluginCard } from './PluginCard';
import { Accordion } from './retro/Accordion';
import { darkVars, lightVars } from './storybook-helpers';

const mockPlugin = (overrides?: Partial<PluginState>): PluginState => ({
  name: 'slack',
  displayName: 'Slack',
  version: '0.1.0',
  permission: 'auto',
  source: 'local',
  tabState: 'ready',
  urlPatterns: ['*://*.slack.com/*'],
  homepage: 'https://app.slack.com',
  sdkVersion: '0.0.3',
  reviewed: true,
  hasPreScript: false,
  tabs: [{ tabId: 1, url: 'https://app.slack.com/client/T123', title: 'Slack', ready: true }],
  tools: [
    {
      name: 'send_message',
      displayName: 'Send Message',
      description: 'Send a message',
      icon: 'send',
      permission: 'auto',
    },
    {
      name: 'list_channels',
      displayName: 'List Channels',
      description: 'List channels',
      icon: 'list',
      permission: 'auto',
    },
    {
      name: 'search',
      displayName: 'Search',
      description: 'Search messages',
      icon: 'search',
      permission: 'off',
    },
  ],
  ...overrides,
});

const meta: Meta<typeof PluginCard> = {
  title: 'Components/PluginCard',
  component: PluginCard,
  decorators: [
    Story => (
      <div className="w-80">
        <Accordion type="multiple" defaultValue={['slack', 'github', 'datadog']}>
          {Story()}
        </Accordion>
      </div>
    ),
  ],
};

type Story = StoryObj<typeof PluginCard>;

const ReadyDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const Ready: Story = {
  render: () => <ReadyDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByText('Slack');
    await userEvent.click(trigger);
    await expect(canvas.getByText('Send Message')).toBeVisible();
  },
};

const TabClosedDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin({ tabState: 'closed', tabs: undefined })]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const TabClosed: Story = {
  render: () => <TabClosedDemo />,
};

const TabUnavailableDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin({ tabState: 'unavailable' })]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const TabUnavailable: Story = {
  render: () => <TabUnavailableDemo />,
};

const ReadyMultipleTabsDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({
      tabs: [
        { tabId: 1, url: 'https://app.slack.com/client/T111', title: 'Slack — #general', ready: true },
        { tabId: 2, url: 'https://app.slack.com/client/T222', title: 'Slack — #engineering', ready: true },
        { tabId: 3, url: 'https://app.slack.com/client/T333', title: 'Slack — DMs', ready: true },
      ],
    }),
  ]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const ReadyMultipleTabs: Story = {
  render: () => <ReadyMultipleTabsDemo />,
};

const ClosedWithHomepageDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin({ tabState: 'closed', tabs: undefined })]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const ClosedWithHomepage: Story = {
  render: () => <ClosedWithHomepageDemo />,
};

const ClosedWithoutHomepageDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin({ tabState: 'closed', tabs: undefined, homepage: undefined })]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const ClosedWithoutHomepage: Story = {
  render: () => <ClosedWithoutHomepageDemo />,
};

const ClosedWithLastSeenUrlDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({ tabState: 'closed', tabs: undefined, homepage: undefined, hasLastSeenUrl: true }),
  ]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const ClosedWithLastSeenUrl: Story = {
  render: () => <ClosedWithLastSeenUrlDemo />,
};

const UnavailableWithTabsDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({
      tabState: 'unavailable',
      tabs: [
        { tabId: 1, url: 'https://app.slack.com/client/T111', title: 'Slack — loading', ready: false },
        { tabId: 2, url: 'https://app.slack.com/client/T222', title: 'Slack — loading', ready: false },
      ],
    }),
  ]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const UnavailableWithTabs: Story = {
  render: () => <UnavailableWithTabsDemo />,
};

const OpenTabThemePairDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({
      tabs: [
        { tabId: 1, url: 'https://app.slack.com/client/T111', title: 'Slack — #general', ready: true },
        { tabId: 2, url: 'https://app.slack.com/client/T222', title: 'Slack — #engineering', ready: true },
      ],
    }),
  ]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const OpenTabThemePair: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-muted-foreground text-xs">Light</span>
        <div style={lightVars}>
          <Accordion type="multiple" defaultValue={['slack']}>
            <OpenTabThemePairDemo />
          </Accordion>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-muted-foreground text-xs">Dark</span>
        <div style={darkVars}>
          <Accordion type="multiple" defaultValue={['slack']}>
            <OpenTabThemePairDemo />
          </Accordion>
        </div>
      </div>
    </div>
  ),
};

const ReadyWithUpdateDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({
      update: {
        latestVersion: '0.2.0',
        updateCommand: 'npm update -g opentabs-plugin-slack@latest',
      },
    }),
  ]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const ReadyWithUpdate: Story = {
  render: () => <ReadyWithUpdateDemo />,
};

const WithActiveToolDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set(['slack:send_message'])} setPlugins={setPlugins} />;
};

const WithActiveTool: Story = {
  render: () => <WithActiveToolDemo />,
};

const MultiplePluginsDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin(),
    mockPlugin({
      name: 'github',
      displayName: 'GitHub',
      urlPatterns: ['*://github.com/*'],
      homepage: 'https://github.com',
      tabState: 'closed',
      tabs: undefined,
      tools: [
        {
          name: 'create_issue',
          displayName: 'Create Issue',
          description: 'Create issue',
          icon: 'plus',
          permission: 'auto',
        },
      ],
    }),
    mockPlugin({
      name: 'datadog',
      displayName: 'Datadog',
      urlPatterns: ['*://*.datadoghq.com/*'],
      homepage: 'https://app.datadoghq.com',
      tabState: 'unavailable',
      source: 'npm',
      tabs: [{ tabId: 5, url: 'https://app.datadoghq.com/dashboard', title: 'Datadog', ready: false }],
      tools: [
        {
          name: 'query_metrics',
          displayName: 'Query Metrics',
          description: 'Query metrics',
          icon: 'bar-chart',
          permission: 'auto',
        },
      ],
    }),
  ]);
  return (
    <div className="space-y-2">
      {plugins.map(p => (
        <PluginCard key={p.name} plugin={p} activeTools={new Set(['slack:send_message'])} setPlugins={setPlugins} />
      ))}
    </div>
  );
};

const MultiplePlugins: Story = {
  render: () => <MultiplePluginsDemo />,
};

const WithMenuDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin({ source: 'npm', permission: 'auto', tabState: 'ready' })]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return (
    <PluginCard
      plugin={plugin}
      activeTools={new Set()}
      setPlugins={setPlugins}
      onUpdate={() => undefined}
      onRemove={() => undefined}
    />
  );
};

const WithMenu: Story = {
  render: () => <WithMenuDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const menuTrigger = canvas.getByLabelText('Plugin options');
    await userEvent.click(menuTrigger);
    const menuItems = await screen.findAllByRole('menuitem');
    await expect(menuItems.length).toBeGreaterThan(0);
  },
};

const WithMenuAndUpdateDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({
      source: 'npm',
      permission: 'auto',
      tabState: 'ready',
      update: {
        latestVersion: '0.2.0',
        updateCommand: 'npm update -g opentabs-plugin-slack@latest',
      },
    }),
  ]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return (
    <PluginCard
      plugin={plugin}
      activeTools={new Set()}
      setPlugins={setPlugins}
      onUpdate={() => undefined}
      onRemove={() => undefined}
    />
  );
};

const WithMenuAndUpdate: Story = {
  render: () => <WithMenuAndUpdateDemo />,
};

const RemovingStateDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin({ source: 'npm', permission: 'auto', tabState: 'ready' })]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return (
    <PluginCard
      plugin={plugin}
      activeTools={new Set()}
      setPlugins={setPlugins}
      onUpdate={() => undefined}
      onRemove={() => undefined}
      removingPlugin={true}
    />
  );
};

const RemovingState: Story = {
  render: () => <RemovingStateDemo />,
};

const GroupedToolsDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({
      tools: [
        {
          name: 'send_message',
          displayName: 'Send Message',
          description: 'Send a message to a channel or DM conversation',
          icon: 'send',
          permission: 'auto',
          group: 'Messages',
        },
        {
          name: 'read_messages',
          displayName: 'Read Messages',
          description: 'Read recent messages from a channel',
          icon: 'message-square',
          permission: 'auto',
          group: 'Messages',
        },
        {
          name: 'search_messages',
          displayName: 'Search Messages',
          description: 'Search messages across channels using keywords and filters',
          icon: 'search',
          permission: 'auto',
          group: 'Messages',
        },
        {
          name: 'edit_message',
          displayName: 'Edit Message',
          description: 'Edit a previously sent message',
          icon: 'pencil',
          permission: 'off',
          group: 'Messages',
        },
        {
          name: 'list_channels',
          displayName: 'List Channels',
          description: 'List all public and private channels in the workspace',
          icon: 'list',
          permission: 'auto',
          group: 'Channels',
        },
        {
          name: 'create_channel',
          displayName: 'Create Channel',
          description: 'Create a new public or private channel',
          icon: 'plus',
          permission: 'auto',
          group: 'Channels',
        },
        {
          name: 'get_channel_info',
          displayName: 'Get Channel Info',
          description: 'Get details about a channel including topic, purpose, and members',
          icon: 'info',
          permission: 'auto',
          group: 'Channels',
        },
        {
          name: 'list_users',
          displayName: 'List Users',
          description: 'List all users in the workspace',
          icon: 'users',
          permission: 'auto',
          group: 'Users',
        },
        {
          name: 'get_user_profile',
          displayName: 'Get User Profile',
          description: 'Retrieve a user profile including display name, email, and timezone',
          icon: 'user',
          permission: 'auto',
          group: 'Users',
        },
        {
          name: 'add_reaction',
          displayName: 'Add Reaction',
          description: 'Add an emoji reaction to a message',
          icon: 'smile',
          permission: 'auto',
          group: 'Reactions',
        },
        {
          name: 'pin_message',
          displayName: 'Pin Message',
          description: 'Pin a message to a channel',
          icon: 'pin',
          permission: 'off',
          group: 'Reactions',
        },
      ],
    }),
  ]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set(['slack:send_message'])} setPlugins={setPlugins} />;
};

const GroupedTools: Story = {
  render: () => <GroupedToolsDemo />,
};

const MixedGroupedUngroupedDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({
      tools: [
        {
          name: 'send_message',
          displayName: 'Send Message',
          description: 'Send a message to a channel',
          icon: 'send',
          permission: 'auto',
          group: 'Messages',
        },
        {
          name: 'read_messages',
          displayName: 'Read Messages',
          description: 'Read recent messages from a channel',
          icon: 'message-square',
          permission: 'auto',
          group: 'Messages',
        },
        {
          name: 'list_channels',
          displayName: 'List Channels',
          description: 'List all channels in the workspace',
          icon: 'list',
          permission: 'auto',
          group: 'Channels',
        },
        {
          name: 'upload_file',
          displayName: 'Upload File',
          description: 'Upload a file to a channel with an optional comment',
          icon: 'upload',
          permission: 'auto',
        },
        {
          name: 'open_dm',
          displayName: 'Open DM',
          description: 'Open a direct message conversation with a user',
          icon: 'message-circle',
          permission: 'auto',
        },
      ],
    }),
  ]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const MixedGroupedUngrouped: Story = {
  render: () => <MixedGroupedUngroupedDemo />,
};

/** Tools assigned to different groups — group header dividers with Switch toggles appear between sections. */
const WithGroupsDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({
      tools: [
        {
          name: 'send_message',
          displayName: 'Send Message',
          description: 'Send a message to a channel or DM',
          icon: 'send',
          permission: 'auto',
          group: 'Messaging',
        },
        {
          name: 'read_messages',
          displayName: 'Read Messages',
          description: 'Read recent messages from a channel',
          icon: 'message-square',
          permission: 'auto',
          group: 'Messaging',
        },
        {
          name: 'list_channels',
          displayName: 'List Channels',
          description: 'List all channels in the workspace',
          icon: 'list',
          permission: 'auto',
          group: 'Channels',
        },
        {
          name: 'create_channel',
          displayName: 'Create Channel',
          description: 'Create a new channel',
          icon: 'plus',
          permission: 'auto',
          group: 'Channels',
        },
        {
          name: 'list_users',
          displayName: 'List Users',
          description: 'List all users in the workspace',
          icon: 'users',
          permission: 'auto',
          group: 'Users',
        },
        {
          name: 'get_user_profile',
          displayName: 'Get User Profile',
          description: 'Get profile details for a user',
          icon: 'user',
          permission: 'auto',
          group: 'Users',
        },
        {
          name: 'upload_file',
          displayName: 'Upload File',
          description: 'Upload a file to a channel',
          icon: 'upload',
          permission: 'off',
          group: 'Files',
        },
      ],
    }),
  ]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const WithGroups: Story = {
  render: () => <WithGroupsDemo />,
};

/** No tools have a group field — renders as a flat list with no group headers. */
const NoGroupsDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({
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
          description: 'Search messages',
          icon: 'search',
          permission: 'off',
        },
      ],
    }),
  ]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const NoGroups: Story = {
  render: () => <NoGroupsDemo />,
};

/** All tools share the same group — a single group header appears above all tools. */
const SingleGroupDemo = () => {
  const [plugins, setPlugins] = useState([
    mockPlugin({
      tools: [
        {
          name: 'send_message',
          displayName: 'Send Message',
          description: 'Send a message to a channel or DM',
          icon: 'send',
          permission: 'auto',
          group: 'Messaging',
        },
        {
          name: 'read_messages',
          displayName: 'Read Messages',
          description: 'Read recent messages from a channel',
          icon: 'message-square',
          permission: 'auto',
          group: 'Messaging',
        },
        {
          name: 'search_messages',
          displayName: 'Search Messages',
          description: 'Search across all channels',
          icon: 'search',
          permission: 'auto',
          group: 'Messaging',
        },
        {
          name: 'edit_message',
          displayName: 'Edit Message',
          description: 'Edit a previously sent message',
          icon: 'pencil',
          permission: 'off',
          group: 'Messaging',
        },
      ],
    }),
  ]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const SingleGroup: Story = {
  render: () => <SingleGroupDemo />,
};

const SkipPermissionsDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const SkipPermissions: Story = {
  render: () => <SkipPermissionsDemo />,
};

const ReviewedDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin({ reviewed: true })]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const Reviewed: Story = {
  render: () => <ReviewedDemo />,
};

const UnreviewedDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin({ reviewed: false })]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const Unreviewed: Story = {
  render: () => <UnreviewedDemo />,
};

const UnreviewedOffDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin({ reviewed: false, permission: 'off' })]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return (
    <div>
      <p className="mb-2 text-muted-foreground text-xs">
        Change permission from Off to Ask or Auto to see the confirmation dialog:
      </p>
      <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />
    </div>
  );
};

const UnreviewedWithDialog: Story = {
  render: () => <UnreviewedOffDemo />,
};

const ThemePairDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return <PluginCard plugin={plugin} activeTools={new Set()} setPlugins={setPlugins} />;
};

const ThemePair: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-muted-foreground text-xs">Light</span>
        <div style={lightVars}>
          <Accordion type="multiple" defaultValue={['slack']}>
            <ThemePairDemo />
          </Accordion>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-muted-foreground text-xs">Dark</span>
        <div style={darkVars}>
          <Accordion type="multiple" defaultValue={['slack']}>
            <ThemePairDemo />
          </Accordion>
        </div>
      </div>
    </div>
  ),
};

const WithActionErrorDemo = () => {
  const [plugins, setPlugins] = useState([mockPlugin()]);
  const plugin = plugins[0];
  if (!plugin) return null;
  return (
    <PluginCard
      plugin={plugin}
      activeTools={new Set()}
      setPlugins={setPlugins}
      actionError="Failed to remove plugin: npm ERR! EACCES"
    />
  );
};

/** Shows the actionError Alert rendered inside the expanded accordion content.
 * The internal toggleError state (set on setToolPermission/setPluginPermission failures)
 * uses identical Alert markup — this story covers the visual for both. */
const WithActionError: Story = {
  render: () => <WithActionErrorDemo />,
};

/** toggleError is internal state triggered by permission toggle failures.
 * It renders with the same Alert markup as actionError (shown in WithActionError).
 * This story documents the visual — actionError is used as the proxy since toggleError
 * cannot be set from props. */
const WithToggleError: Story = {
  render: () => <WithActionErrorDemo />,
};

export default meta;
export {
  ClosedWithHomepage,
  ClosedWithLastSeenUrl,
  ClosedWithoutHomepage,
  GroupedTools,
  MixedGroupedUngrouped,
  MultiplePlugins,
  NoGroups,
  OpenTabThemePair,
  Ready,
  ReadyMultipleTabs,
  ReadyWithUpdate,
  RemovingState,
  Reviewed,
  SingleGroup,
  SkipPermissions,
  TabClosed,
  TabUnavailable,
  ThemePair,
  UnavailableWithTabs,
  Unreviewed,
  UnreviewedWithDialog,
  WithActionError,
  WithActiveTool,
  WithGroups,
  WithMenu,
  WithMenuAndUpdate,
  WithToggleError,
};
