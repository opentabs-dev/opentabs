import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import type { HTMLAttributes, Ref } from 'react';
import { cn } from '../../lib/cn';

const loaderVariants = cva('flex gap-1', {
  variants: {
    variant: {
      default: '[&>div]:bg-primary [&>div]:border-border',
      secondary: '[&>div]:bg-secondary [&>div]:border-border',
      outline: '[&>div]:bg-transparent [&>div]:border-border',
      muted: '[&>div]:bg-muted-foreground [&>div]:border-muted-foreground',
    },
    size: {
      sm: '[&>div]:w-2 [&>div]:h-2',
      md: '[&>div]:w-3 [&>div]:h-3',
      lg: '[&>div]:w-4 [&>div]:h-4',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

interface LoaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'color'>, VariantProps<typeof loaderVariants> {
  count?: number;
  duration?: number;
  delayStep?: number;
  ref?: Ref<HTMLDivElement>;
}

const Loader = ({
  className,
  variant,
  size,
  count = 3,
  duration = 0.5,
  delayStep = 100,
  ref,
  ...props
}: LoaderProps) => (
  <div
    className={cn(loaderVariants({ variant, size }), className)}
    ref={ref}
    role="status"
    aria-label="Loading..."
    {...props}>
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="animate-bounce rounded border-2"
        style={{
          animationDuration: `${duration}s`,
          animationIterationCount: 'infinite',
          animationDelay: `${i * delayStep}ms`,
        }}
      />
    ))}
  </div>
);

export { Loader };
