import type { ToolPermission } from '@opentabs-dev/shared';
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import type { BrowserToolState } from '../bridge';
import { BrowserToolsCard } from './BrowserToolsCard';
import { Accordion } from './retro/Accordion';

const mockBrowserTools: BrowserToolState[] = [
  { name: 'browser_list_tabs', description: 'List all open browser tabs', permission: 'auto' },
  { name: 'browser_open_tab', description: 'Open a new browser tab with a URL', permission: 'auto' },
  { name: 'browser_screenshot_tab', description: 'Capture a screenshot of a tab', permission: 'auto' },
  { name: 'browser_click_element', description: 'Click an element matching a CSS selector', permission: 'auto' },
  { name: 'browser_execute_script', description: 'Execute JavaScript in a tab', permission: 'off' },
];

const meta: Meta<typeof BrowserToolsCard> = {
  title: 'Components/BrowserToolsCard',
  component: BrowserToolsCard,
  decorators: [
    Story => (
      <div className="w-80">
        <Accordion type="multiple" defaultValue={['browser-tools']}>
          {Story()}
        </Accordion>
      </div>
    ),
  ],
};

type Story = StoryObj<typeof BrowserToolsCard>;

const DefaultDemo = () => {
  const [tools, setTools] = useState<BrowserToolState[]>(
    mockBrowserTools.map(t => ({ ...t, permission: 'auto' as const })),
  );
  const [perm, setPerm] = useState<ToolPermission>('auto');
  return (
    <BrowserToolsCard
      tools={tools}
      activeTools={new Set()}
      onToolsChange={updater => setTools(updater)}
      browserPermission={perm}
      onBrowserPermissionChange={setPerm}
    />
  );
};

const Default: Story = {
  render: () => <DefaultDemo />,
};

const SomeDisabledDemo = () => {
  const [tools, setTools] = useState(mockBrowserTools);
  const [perm, setPerm] = useState<ToolPermission>('ask');
  return (
    <BrowserToolsCard
      tools={tools}
      activeTools={new Set()}
      onToolsChange={updater => setTools(updater)}
      browserPermission={perm}
      onBrowserPermissionChange={setPerm}
    />
  );
};

const SomeDisabled: Story = {
  render: () => <SomeDisabledDemo />,
};

const AllDisabledDemo = () => {
  const [tools, setTools] = useState<BrowserToolState[]>(
    mockBrowserTools.map(t => ({ ...t, permission: 'off' as const })),
  );
  const [perm, setPerm] = useState<ToolPermission>('off');
  return (
    <BrowserToolsCard
      tools={tools}
      activeTools={new Set()}
      onToolsChange={updater => setTools(updater)}
      browserPermission={perm}
      onBrowserPermissionChange={setPerm}
    />
  );
};

const AllDisabled: Story = {
  render: () => <AllDisabledDemo />,
};

const WithActiveToolDemo = () => {
  const [tools, setTools] = useState<BrowserToolState[]>(
    mockBrowserTools.map(t => ({ ...t, permission: 'auto' as const })),
  );
  const [perm, setPerm] = useState<ToolPermission>('auto');
  return (
    <BrowserToolsCard
      tools={tools}
      activeTools={new Set(['browser:browser_list_tabs'])}
      onToolsChange={updater => setTools(updater)}
      browserPermission={perm}
      onBrowserPermissionChange={setPerm}
    />
  );
};

const WithActiveTool: Story = {
  render: () => <WithActiveToolDemo />,
};

const WithToolFilterDemo = () => {
  const [tools, setTools] = useState<BrowserToolState[]>(
    mockBrowserTools.map(t => ({ ...t, permission: 'auto' as const })),
  );
  const [perm, setPerm] = useState<ToolPermission>('auto');
  return (
    <BrowserToolsCard
      tools={tools}
      activeTools={new Set()}
      onToolsChange={updater => setTools(updater)}
      toolFilter="screenshot"
      browserPermission={perm}
      onBrowserPermissionChange={setPerm}
    />
  );
};

const WithToolFilter: Story = {
  render: () => <WithToolFilterDemo />,
};

/** Tools with group assignments matching realistic browser tool groups. */
const groupedBrowserTools: BrowserToolState[] = [
  { name: 'browser_list_tabs', description: 'List all open browser tabs', permission: 'auto', group: 'Tabs' },
  { name: 'browser_open_tab', description: 'Open a new browser tab with a URL', permission: 'auto', group: 'Tabs' },
  { name: 'browser_close_tab', description: 'Close a browser tab', permission: 'auto', group: 'Tabs' },
  {
    name: 'browser_click_element',
    description: 'Click an element matching a CSS selector',
    permission: 'auto',
    group: 'Page Interaction',
  },
  {
    name: 'browser_type_text',
    description: 'Type text into an input element',
    permission: 'auto',
    group: 'Page Interaction',
  },
  {
    name: 'browser_scroll_page',
    description: 'Scroll the page in a direction',
    permission: 'auto',
    group: 'Page Interaction',
  },
  {
    name: 'browser_screenshot_tab',
    description: 'Capture a screenshot of a tab',
    permission: 'auto',
    group: 'Page Inspection',
  },
  {
    name: 'browser_read_page_content',
    description: 'Read the text content of a page',
    permission: 'auto',
    group: 'Page Inspection',
  },
  {
    name: 'browser_get_dom_structure',
    description: 'Get the DOM tree structure',
    permission: 'auto',
    group: 'Page Inspection',
  },
  { name: 'browser_capture_network', description: 'Capture network requests', permission: 'auto', group: 'Network' },
  {
    name: 'browser_get_cookies',
    description: 'Read cookies for a domain',
    permission: 'auto',
    group: 'Storage & Cookies',
  },
  {
    name: 'browser_set_cookie',
    description: 'Set a cookie for a domain',
    permission: 'auto',
    group: 'Storage & Cookies',
  },
];

const WithGroupsDemo = () => {
  const [tools, setTools] = useState(groupedBrowserTools);
  const [perm, setPerm] = useState<ToolPermission>('auto');
  return (
    <BrowserToolsCard
      tools={tools}
      activeTools={new Set()}
      onToolsChange={updater => setTools(updater)}
      browserPermission={perm}
      onBrowserPermissionChange={setPerm}
    />
  );
};

/** Tools with group assignments render group header dividers with uppercase text and bg-muted/30 styling. */
const WithGroups: Story = {
  render: () => <WithGroupsDemo />,
};

/** Tools without any group field render as a flat list with no group headers. */
const UngroupedToolsDemo = () => {
  const [tools, setTools] = useState(mockBrowserTools);
  const [perm, setPerm] = useState<ToolPermission>('auto');
  return (
    <BrowserToolsCard
      tools={tools}
      activeTools={new Set()}
      onToolsChange={updater => setTools(updater)}
      browserPermission={perm}
      onBrowserPermissionChange={setPerm}
    />
  );
};

const UngroupedTools: Story = {
  render: () => <UngroupedToolsDemo />,
};

/** Mix of grouped and ungrouped tools — ungrouped tools appear under an 'Other' section at the bottom. */
const mixedTools: BrowserToolState[] = [
  { name: 'browser_list_tabs', description: 'List all open browser tabs', permission: 'auto', group: 'Tabs' },
  { name: 'browser_open_tab', description: 'Open a new browser tab with a URL', permission: 'auto', group: 'Tabs' },
  {
    name: 'browser_click_element',
    description: 'Click an element matching a CSS selector',
    permission: 'auto',
    group: 'Page Interaction',
  },
  { name: 'browser_screenshot_tab', description: 'Capture a screenshot of a tab', permission: 'auto' },
  { name: 'browser_execute_script', description: 'Execute JavaScript in a tab', permission: 'off' },
];

const MixedGroupAndUngroupedDemo = () => {
  const [tools, setTools] = useState(mixedTools);
  const [perm, setPerm] = useState<ToolPermission>('auto');
  return (
    <BrowserToolsCard
      tools={tools}
      activeTools={new Set()}
      onToolsChange={updater => setTools(updater)}
      browserPermission={perm}
      onBrowserPermissionChange={setPerm}
    />
  );
};

const MixedGroupAndUngrouped: Story = {
  render: () => <MixedGroupAndUngroupedDemo />,
};

const interactiveTools: BrowserToolState[] = [
  ...mockBrowserTools,
  { name: 'extension_get_state', description: 'Get extension internal state', permission: 'auto' },
];

const InteractiveDemo = () => {
  const [tools, setTools] = useState(interactiveTools);
  const [perm, setPerm] = useState<ToolPermission>('auto');
  return (
    <BrowserToolsCard
      tools={tools}
      activeTools={new Set()}
      onToolsChange={updater => setTools(updater)}
      browserPermission={perm}
      onBrowserPermissionChange={setPerm}
    />
  );
};

const Interactive: Story = {
  render: () => <InteractiveDemo />,
};

const WithServerVersionDemo = () => {
  const [tools, setTools] = useState<BrowserToolState[]>(
    mockBrowserTools.map(t => ({ ...t, permission: 'auto' as const })),
  );
  const [perm, setPerm] = useState<ToolPermission>('auto');
  return (
    <BrowserToolsCard
      tools={tools}
      activeTools={new Set()}
      onToolsChange={updater => setTools(updater)}
      serverVersion="0.0.42"
      browserPermission={perm}
      onBrowserPermissionChange={setPerm}
    />
  );
};

const WithServerVersion: Story = {
  render: () => <WithServerVersionDemo />,
};

const SkipPermissionsDemo = () => {
  const [tools, setTools] = useState<BrowserToolState[]>(
    mockBrowserTools.map(t => ({ ...t, permission: 'auto' as const })),
  );
  return (
    <BrowserToolsCard
      tools={tools}
      activeTools={new Set()}
      onToolsChange={updater => setTools(updater)}
      browserPermission="auto"
    />
  );
};

const SkipPermissions: Story = {
  render: () => <SkipPermissionsDemo />,
};

/**
 * The toggle error Alert appears between the accordion header and content when a
 * setToolPermission or setPluginPermission API call rejects. It auto-clears after
 * ERROR_DISPLAY_DURATION_MS. Error messages:
 * - 'Failed to update browser permission' — browser-level PermissionSelect toggle fails
 * - 'Failed to update ${toolName}' — individual tool PermissionSelect toggle fails
 * Since toggleError is internal state that cannot be set from props, this story shows
 * the card in its normal expanded state. The Alert styling is identical to PluginCard's
 * actionError/toggleError Alert (same markup: mx-3 mb-1 px-2 py-1 text-xs).
 */
const WithToggleError: Story = {
  render: () => <DefaultDemo />,
};

export default meta;
export {
  Default,
  SomeDisabled,
  AllDisabled,
  WithActiveTool,
  WithToolFilter,
  WithGroups,
  UngroupedTools,
  MixedGroupAndUngrouped,
  Interactive,
  WithServerVersion,
  SkipPermissions,
  WithToggleError,
};
