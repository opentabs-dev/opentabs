import { cn } from '../../lib/utils';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

const badgeVariants = cva('font-semibold rounded inline-flex items-center', {
  variants: {
    variant: {
      default: 'bg-muted text-muted-foreground',
      outline: 'outline-2 outline-foreground text-foreground',
      solid: 'bg-foreground text-background',
      surface: 'outline-2 bg-primary text-primary-foreground',
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

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = ({ children, size = 'md', variant = 'default', className = '', ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
    {children}
  </span>
);
