'use client';

import { cn } from '../utils';
import { cva } from 'class-variance-authority';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { forwardRef } from 'react';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, ComponentRef } from 'react';

const tooltipContentVariants = cva(
  'z-50 overflow-hidden border-2 border-border bg-background px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        primary: 'bg-primary text-primary-foreground',
        solid: 'bg-black text-white',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const RetroTooltipProvider = TooltipPrimitive.Provider;

const RetroTooltip = TooltipPrimitive.Root;

const RetroTooltipTrigger = TooltipPrimitive.Trigger;

const RetroTooltipContent = forwardRef<
  ComponentRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & VariantProps<typeof tooltipContentVariants>
>(({ className, sideOffset = 4, variant, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(tooltipContentVariants({ variant, className }))}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
RetroTooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { RetroTooltip, RetroTooltipTrigger, RetroTooltipContent, RetroTooltipProvider };
