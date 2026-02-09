import { cn } from '../utils';
import { cva } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

const retroButtonVariants = cva(
  'font-sans transition-all rounded outline-hidden cursor-pointer duration-200 font-semibold flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted disabled:text-muted-foreground disabled:border-muted-foreground disabled:shadow-none disabled:hover:translate-y-0 disabled:active:translate-y-0 disabled:active:translate-x-0',
  {
    variants: {
      variant: {
        default:
          'shadow-md hover:shadow active:shadow-none bg-primary text-primary-foreground border-2 border-border transition hover:translate-y-1 active:translate-y-2 active:translate-x-1 hover:bg-primary-hover',
        secondary:
          'shadow-md hover:shadow active:shadow-none bg-secondary text-secondary-foreground border-2 border-border transition hover:translate-y-1 active:translate-y-2 active:translate-x-1',
        outline:
          'shadow-md hover:shadow active:shadow-none bg-transparent border-2 border-border transition hover:translate-y-1 active:translate-y-2 active:translate-x-1',
        link: 'bg-transparent hover:underline',
        ghost: 'bg-transparent hover:bg-accent',
        destructive:
          'shadow-md hover:shadow active:shadow-none bg-destructive text-destructive-foreground border-2 border-border transition hover:translate-y-1 active:translate-y-2 active:translate-x-1',
      },
      size: {
        sm: 'px-3 py-1 text-sm shadow hover:shadow-none',
        md: 'px-4 py-1.5 text-base',
        lg: 'px-6 lg:px-8 py-2 lg:py-3 text-md lg:text-lg',
        icon: 'p-2',
      },
    },
    defaultVariants: {
      size: 'md',
      variant: 'default',
    },
  },
);

type RetroButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof retroButtonVariants> & {
    asChild?: boolean;
  };

const RetroButton = ({
  children,
  size = 'md',
  className = '',
  variant = 'default',
  asChild = false,
  ...props
}: RetroButtonProps) => {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp className={cn(retroButtonVariants({ variant, size }), className)} {...props}>
      {children}
    </Comp>
  );
};

RetroButton.displayName = 'RetroButton';

export { RetroButton };
export type { RetroButtonProps };
