import type { ToolPermission } from '@opentabs-dev/shared';
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { expect, screen, userEvent, within } from 'storybook/test';
import { darkVars, lightVars } from './storybook-helpers';
import { ToolRow } from './ToolRow';

const meta: Meta<typeof ToolRow> = {
  title: 'Components/ToolRow',
  component: ToolRow,
  decorators: [Story => <div className="w-80 rounded border-2 border-border">{Story()}</div>],
};

type Story = StoryObj<typeof ToolRow>;

const Off: Story = {
  args: {
    name: 'send_message',
    displayName: 'Send Message',
    description: 'Send a message to a channel or direct message conversation',
    icon: 'send',
    permission: 'off',
    active: false,
    onPermissionChange: () => {},
  },
};

const Ask: Story = {
  args: {
    ...Off.args,
    permission: 'ask',
  },
};

const Auto: Story = {
  args: {
    ...Off.args,
    permission: 'auto',
  },
};

const Active: Story = { args: { ...Auto.args, active: true } };

const Disabled: Story = {
  args: {
    ...Ask.args,
    disabled: true,
  },
};

const LongDescription: Story = {
  args: {
    ...Auto.args,
    name: 'create_pull_request',
    displayName: 'Create Pull Request',
    description:
      'Create a new pull request from a head branch to a base branch with title, body, reviewers, and labels. Supports draft mode and auto-merge configuration.',
    icon: 'git-pull-request',
  },
};

const WithSummary: Story = {
  args: {
    ...Auto.args,
    name: 'create_pull_request',
    displayName: 'Create Pull Request',
    description:
      'Create a new pull request from a head branch to a base branch with title, body, reviewers, and labels. Supports draft mode and auto-merge configuration.',
    summary: 'Create a new pull request',
    icon: 'git-pull-request',
  },
};

const WithoutSummary: Story = {
  args: {
    ...Auto.args,
    name: 'create_pull_request',
    displayName: 'Create Pull Request',
    description:
      'Create a new pull request from a head branch to a base branch with title, body, reviewers, and labels. Supports draft mode and auto-merge configuration.',
    icon: 'git-pull-request',
  },
};

const InteractiveDemo = () => {
  const [permission, setPermission] = useState<ToolPermission>('auto');
  return (
    <ToolRow
      name="send_message"
      displayName="Send Message"
      description="Send a message to a channel or direct message conversation"
      icon="send"
      permission={permission}
      active={false}
      onPermissionChange={(_tool, p) => setPermission(p)}
    />
  );
};

const Interactive: Story = {
  render: () => <InteractiveDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('combobox');
    await userEvent.click(trigger);
    const askOption = await screen.findByRole('option', { name: /ask/i });
    await userEvent.click(askOption);
    await expect(trigger).toHaveTextContent('Ask');
  },
};

const ToolList: Story = {
  render: () => {
    const tools = [
      {
        name: 'send_message',
        displayName: 'Send Message',
        description: 'Send a message to a channel or direct message conversation',
        icon: 'send',
        permission: 'auto' as ToolPermission,
      },
      {
        name: 'list_channels',
        displayName: 'List Channels',
        description: 'List all public and private channels in the workspace with membership info',
        icon: 'list',
        permission: 'ask' as ToolPermission,
      },
      {
        name: 'search_messages',
        displayName: 'Search Messages',
        description: 'Search messages across channels using keywords, filters, and date ranges',
        icon: 'search',
        permission: 'auto' as ToolPermission,
        active: true,
      },
      {
        name: 'get_user_profile',
        displayName: 'Get User Profile',
        description: 'Retrieve a user profile including display name, email, timezone, and status',
        icon: 'user',
        permission: 'off' as ToolPermission,
      },
      {
        name: 'upload_file',
        displayName: 'Upload File',
        description: 'Upload a file to a channel or direct message with an optional comment',
        icon: 'upload',
        permission: 'auto' as ToolPermission,
      },
    ];
    return (
      <div>
        {tools.map(t => (
          <ToolRow
            key={t.name}
            name={t.name}
            displayName={t.displayName}
            description={t.description}
            icon={t.icon}
            permission={t.permission}
            active={'active' in t && !!t.active}
            onPermissionChange={() => {}}
          />
        ))}
      </div>
    );
  },
};

const ThemePair: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-muted-foreground text-xs">Light</span>
        <div style={lightVars}>
          <ToolRow
            name="send_message"
            displayName="Send Message"
            description="Send a message to a channel"
            icon="send"
            permission="auto"
            active={false}
            onPermissionChange={() => {}}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-muted-foreground text-xs">Dark</span>
        <div style={darkVars}>
          <ToolRow
            name="send_message"
            displayName="Send Message"
            description="Send a message to a channel"
            icon="send"
            permission="auto"
            active={false}
            onPermissionChange={() => {}}
          />
        </div>
      </div>
    </div>
  ),
};

export default meta;
export {
  Off,
  Ask,
  Auto,
  Active,
  Disabled,
  LongDescription,
  WithSummary,
  WithoutSummary,
  Interactive,
  ToolList,
  ThemePair,
};
