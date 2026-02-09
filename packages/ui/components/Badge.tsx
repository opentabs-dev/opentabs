import { cn } from '../utils';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

const retroBadgeVariants = cva('font-semibold rounded inline-flex items-center', {
  variants: {
    variant: {
      default: 'bg-muted text-muted-foreground',
      outline: 'outline outline-2 outline-foreground text-foreground',
      solid: 'bg-foreground text-background',
      surface: 'outline outline-2 bg-primary text-primary-foreground',
      destructive: 'bg-destructive text-destructive-foreground',
      connected: 'bg-[#2EB67D] text-white', // Slack Green
      disconnected: 'bg-[#E01E5A] text-white', // Slack Red
    },
    size: {
      sm: 'px-2 py-1 text-xs',
      md: 'px-2.5 py-1.5 text-sm',
      lg: 'px-3 py-2 text-base',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

type RetroBadgeProps = React.ComponentProps<'span'> & VariantProps<typeof retroBadgeVariants>;

const RetroBadge = ({ children, size = 'md', variant = 'default', className = '', ...props }: RetroBadgeProps) => (
  <span className={cn(retroBadgeVariants({ variant, size }), className)} {...props}>
    {children}
  </span>
);

export { RetroBadge };
