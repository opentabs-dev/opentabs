import { cn } from '../utils';
import type * as React from 'react';

const RetroInput = ({
  type = 'text',
  placeholder = 'Enter text',
  className = '',
  ...props
}: React.ComponentProps<'input'>) => (
  <input
    type={type}
    placeholder={placeholder}
    className={cn(
      'placeholder:text-muted-foreground w-full rounded border-2 px-4 py-2 font-sans shadow-md transition focus:shadow-xs focus:outline-hidden',
      props['aria-invalid'] ? 'border-destructive text-destructive shadow-destructive shadow-xs' : 'border-border',
      className,
    )}
    {...props}
  />
);

export { RetroInput };
