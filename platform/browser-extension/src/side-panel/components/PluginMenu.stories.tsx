import type { Meta, StoryObj } from '@storybook/react';
import { expect, screen, userEvent, within } from 'storybook/test';
import type { PluginState } from '../bridge';
import { PluginMenu } from './PluginMenu';

const mockNpmPlugin = (overrides?: Partial<PluginState>): PluginState => ({
  name: 'slack',
  displayName: 'Slack',
  version: '0.1.0',
  permission: 'auto',
  source: 'npm',
  npmPackageName: '@opentabs-dev/opentabs-plugin-slack',
  tabState: 'ready',
  urlPatterns: ['*://*.slack.com/*'],
  sdkVersion: '0.0.3',
  reviewed: true,
  hasPreScript: false,
  tools: [
    {
      name: 'send_message',
      displayName: 'Send Message',
      description: 'Send a message',
      icon: 'send',
      permission: 'auto',
    },
  ],
  ...overrides,
});

const meta: Meta<typeof PluginMenu> = {
  title: 'Components/PluginMenu',
  component: PluginMenu,
  decorators: [Story => <div className="p-8">{Story()}</div>],
};

type Story = StoryObj<typeof PluginMenu>;

const Default: Story = {
  render: () => (
    <PluginMenu
      plugin={mockNpmPlugin()}
      onUpdate={() => undefined}
      onRemove={() => undefined}
      updating={false}
      removing={false}
    />
  ),
};

const WithUpdate: Story = {
  render: () => (
    <PluginMenu
      plugin={mockNpmPlugin({ update: { latestVersion: '0.2.0', updateCommand: 'npm update slack' } })}
      onUpdate={() => undefined}
      onRemove={() => undefined}
      updating={false}
      removing={false}
    />
  ),
};

const LocalPlugin: Story = {
  render: () => (
    <div>
      <p className="mb-2 text-muted-foreground text-xs">
        Local plugin — menu shows &ldquo;Remove&rdquo; instead of &ldquo;Uninstall&rdquo;:
      </p>
      <PluginMenu
        plugin={mockNpmPlugin({ source: 'local' })}
        onUpdate={() => undefined}
        onRemove={() => undefined}
        updating={false}
        removing={false}
      />
    </div>
  ),
};

const WithConfirmDialog: Story = {
  render: () => (
    <div>
      <p className="mb-2 text-muted-foreground text-xs">
        Open the menu and click Uninstall to see the confirmation dialog:
      </p>
      <PluginMenu
        plugin={mockNpmPlugin()}
        onUpdate={() => undefined}
        onRemove={() => alert('Plugin removed!')}
        updating={false}
        removing={false}
      />
    </div>
  ),
};

const UpdateBadge: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-muted-foreground text-xs">No update — no badge on trigger</p>
        <PluginMenu
          plugin={mockNpmPlugin()}
          onUpdate={() => undefined}
          onRemove={() => undefined}
          updating={false}
          removing={false}
        />
      </div>
      <div>
        <p className="mb-1 text-muted-foreground text-xs">Update available — yellow dot on trigger</p>
        <PluginMenu
          plugin={mockNpmPlugin({ update: { latestVersion: '0.2.0', updateCommand: 'npm update slack' } })}
          onUpdate={() => undefined}
          onRemove={() => undefined}
          updating={false}
          removing={false}
        />
      </div>
    </div>
  ),
};

const AllStates: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-muted-foreground text-xs">Default (no update)</p>
        <PluginMenu
          plugin={mockNpmPlugin()}
          onUpdate={() => undefined}
          onRemove={() => undefined}
          updating={false}
          removing={false}
        />
      </div>
      <div>
        <p className="mb-1 text-muted-foreground text-xs">With update available (badge + menu item)</p>
        <PluginMenu
          plugin={mockNpmPlugin({ update: { latestVersion: '0.2.0', updateCommand: 'npm update slack' } })}
          onUpdate={() => undefined}
          onRemove={() => undefined}
          updating={false}
          removing={false}
        />
      </div>
      <div>
        <p className="mb-1 text-muted-foreground text-xs">Updating (spinner on Update item)</p>
        <PluginMenu
          plugin={mockNpmPlugin({ update: { latestVersion: '0.2.0', updateCommand: 'npm update slack' } })}
          onUpdate={() => undefined}
          onRemove={() => undefined}
          updating={true}
          removing={false}
        />
      </div>
      <div>
        <p className="mb-1 text-muted-foreground text-xs">Removing (spinner on Uninstall item)</p>
        <PluginMenu
          plugin={mockNpmPlugin()}
          onUpdate={() => undefined}
          onRemove={() => undefined}
          updating={false}
          removing={true}
        />
      </div>
      <div>
        <p className="mb-1 text-muted-foreground text-xs">Local plugin (shows &ldquo;Remove&rdquo;)</p>
        <PluginMenu
          plugin={mockNpmPlugin({ source: 'local' })}
          onUpdate={() => undefined}
          onRemove={() => undefined}
          updating={false}
          removing={false}
        />
      </div>
    </div>
  ),
};

const Muted: Story = {
  render: () => (
    <PluginMenu
      plugin={mockNpmPlugin()}
      onUpdate={() => undefined}
      onRemove={() => undefined}
      updating={false}
      removing={false}
      muted={true}
    />
  ),
};

const VersionInMenu: Story = {
  render: () => (
    <PluginMenu
      plugin={mockNpmPlugin()}
      onUpdate={() => undefined}
      onRemove={() => undefined}
      updating={false}
      removing={false}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const menuTrigger = canvas.getByLabelText('Plugin options');
    await userEvent.click(menuTrigger);
    await expect(screen.getByText('v0.1.0')).toBeVisible();
  },
};

const FullMenu: Story = {
  render: () => (
    <PluginMenu
      plugin={mockNpmPlugin({ update: { latestVersion: '0.2.0', updateCommand: 'npm update slack' } })}
      onUpdate={() => undefined}
      onRemove={() => undefined}
      updating={false}
      removing={false}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByLabelText('Plugin options');
    await userEvent.click(trigger);
    await expect(screen.getByText('v0.1.0')).toBeVisible();
    await expect(screen.getByText(/Update to v0\.2\.0/)).toBeVisible();
    await expect(screen.getByText('Uninstall')).toBeVisible();
  },
};

export default meta;
export { AllStates, Default, FullMenu, LocalPlugin, Muted, UpdateBadge, VersionInMenu, WithConfirmDialog, WithUpdate };
