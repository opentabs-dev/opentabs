import type { Meta, StoryObj } from '@storybook/react';
import type { PluginSearchResult } from '../bridge';
import { NpmPluginCard } from './NpmPluginCard';

const mockNpmPlugin = (overrides?: Partial<PluginSearchResult>): PluginSearchResult => ({
  name: '@opentabs-dev/opentabs-plugin-slack',
  displayName: 'Slack',
  description: 'OpenTabs plugin for Slack — send messages, list channels, and search conversations.',
  version: '1.2.0',
  author: 'opentabs-dev',
  iconSvg: '',
  iconDarkSvg: '',
  ...overrides,
});

const meta: Meta<typeof NpmPluginCard> = {
  title: 'Components/NpmPluginCard',
  component: NpmPluginCard,
  decorators: [Story => <div className="w-80">{Story()}</div>],
};

type Story = StoryObj<typeof NpmPluginCard>;

const Default: Story = {
  render: () => <NpmPluginCard plugin={mockNpmPlugin()} installing={false} error={null} onInstall={() => undefined} />,
};

const Official: Story = {
  render: () => (
    <NpmPluginCard
      plugin={mockNpmPlugin({ name: '@opentabs-dev/opentabs-plugin-slack' })}
      installing={false}
      error={null}
      onInstall={() => undefined}
    />
  ),
};

const Installing: Story = {
  render: () => <NpmPluginCard plugin={mockNpmPlugin()} installing={true} error={null} onInstall={() => undefined} />,
};

const WithError: Story = {
  render: () => (
    <NpmPluginCard
      plugin={mockNpmPlugin()}
      installing={false}
      error="Failed to install: package not found in registry."
      onInstall={() => undefined}
    />
  ),
};

const LongDescription: Story = {
  render: () => (
    <NpmPluginCard
      plugin={mockNpmPlugin({
        description:
          'This is a very long description that exceeds two lines of text in the narrow side panel width of approximately 350 pixels, so it should be truncated with an ellipsis after the second line to keep the card compact.',
      })}
      installing={false}
      error={null}
      onInstall={() => undefined}
    />
  ),
};

const AllStates: Story = {
  render: () => (
    <div className="space-y-3">
      <NpmPluginCard plugin={mockNpmPlugin()} installing={false} error={null} onInstall={() => undefined} />
      <NpmPluginCard
        plugin={mockNpmPlugin({
          name: '@opentabs-dev/opentabs-plugin-github',
          author: 'opentabs-dev',
        })}
        installing={false}
        error={null}
        onInstall={() => undefined}
      />
      <NpmPluginCard
        plugin={mockNpmPlugin({
          name: '@opentabs-dev/opentabs-plugin-notion',
          description: 'OpenTabs plugin for Notion — read and write pages, databases, and blocks.',
        })}
        installing={true}
        error={null}
        onInstall={() => undefined}
      />
      <NpmPluginCard
        plugin={mockNpmPlugin({ name: 'opentabs-plugin-linear', author: 'community', version: '0.3.1' })}
        installing={false}
        error="Installation failed: network error."
        onInstall={() => undefined}
      />
    </div>
  ),
};

export default meta;
export { AllStates, Default, Installing, LongDescription, Official, WithError };
