'use client';

import { cn } from '../utils';
import { Switch as SwitchPrimitive } from 'radix-ui';
import type * as React from 'react';

const RetroSwitch = ({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) => (
  <SwitchPrimitive.Root
    className={cn(
      'peer border-foreground data-[state=checked]:bg-primary inline-flex h-6 w-11 shrink-0 cursor-pointer items-center border-2 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}>
    <SwitchPrimitive.Thumb
      className={cn(
        'bg-primary border-foreground data-[state=checked]:bg-background pointer-events-none mx-0.5 block h-4 w-4 border-2 ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
);

export { RetroSwitch };
