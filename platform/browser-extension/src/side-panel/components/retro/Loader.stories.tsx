import type { Meta, StoryObj } from '@storybook/react';
import { Loader } from './Loader';

const meta: Meta<typeof Loader> = {
  title: 'Retro/Loader',
  component: Loader,
  argTypes: {
    variant: { control: 'select', options: ['default', 'secondary', 'outline', 'muted'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
};

type Story = StoryObj<typeof Loader>;

const Default: Story = {};
const Secondary: Story = { args: { variant: 'secondary' } };
const Outline: Story = { args: { variant: 'outline' } };
const Muted: Story = { args: { variant: 'muted' } };
const Small: Story = { args: { size: 'sm' } };
const Large: Story = { args: { size: 'lg' } };

const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['default', 'secondary', 'outline', 'muted'] as const).map(variant => (
        <div key={variant} className="flex items-center gap-4">
          <span className="w-20 font-mono text-muted-foreground text-xs">{variant}</span>
          {(['sm', 'md', 'lg'] as const).map(size => (
            <Loader key={size} variant={variant} size={size} />
          ))}
        </div>
      ))}
    </div>
  ),
};

export default meta;
export { Default, Secondary, Outline, Muted, Small, Large, AllVariants };
