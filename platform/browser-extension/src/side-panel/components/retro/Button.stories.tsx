import type { Meta, StoryObj } from '@storybook/react';
import { ThemeGrid } from '../storybook-helpers';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'Retro/Button',
  component: Button,
  argTypes: {
    variant: { control: 'select', options: ['default', 'secondary', 'outline', 'link', 'ghost'] },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'icon'] },
    disabled: { control: 'boolean' },
  },
};

type Story = StoryObj<typeof Button>;

const Primary: Story = { args: { children: 'Primary', variant: 'default' } };
const Secondary: Story = { args: { children: 'Secondary', variant: 'secondary' } };
const Outline: Story = { args: { children: 'Outline', variant: 'outline' } };
const Link: Story = { args: { children: 'Link', variant: 'link' } };
const Ghost: Story = { args: { children: 'Ghost', variant: 'ghost' } };
const Small: Story = { args: { children: 'Small', size: 'sm' } };
const Large: Story = { args: { children: 'Large', size: 'lg' } };
const Disabled: Story = { args: { children: 'Disabled', disabled: true } };

const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['default', 'secondary', 'outline', 'link', 'ghost'] as const).map(variant => (
        <div key={variant} className="flex items-center gap-3">
          <span className="w-20 font-mono text-muted-foreground text-xs">{variant}</span>
          {(['sm', 'md', 'lg'] as const).map(size => (
            <Button key={size} variant={variant} size={size}>
              {size}
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};

const ThemePair: Story = {
  render: () => (
    <ThemeGrid>
      <div className="flex flex-col gap-2">
        <Button variant="default">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
      </div>
    </ThemeGrid>
  ),
};

export default meta;
export { Primary, Secondary, Outline, Link, Ghost, Small, Large, Disabled, AllVariants, ThemePair };
