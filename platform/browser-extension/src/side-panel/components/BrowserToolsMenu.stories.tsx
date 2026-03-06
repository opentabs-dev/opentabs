import type { Meta, StoryObj } from '@storybook/react';
import { BrowserToolsMenu } from './BrowserToolsMenu';

const meta: Meta<typeof BrowserToolsMenu> = {
  title: 'Components/BrowserToolsMenu',
  component: BrowserToolsMenu,
  decorators: [Story => <div className="p-8">{Story()}</div>],
};

type Story = StoryObj<typeof BrowserToolsMenu>;

const Default: Story = { args: { serverVersion: '0.0.42' } };

const NoVersion: Story = { args: {} };

const LongVersion: Story = { args: { serverVersion: '1.2.3-beta.45+build.6789' } };

export default meta;
export { Default, NoVersion, LongVersion };
