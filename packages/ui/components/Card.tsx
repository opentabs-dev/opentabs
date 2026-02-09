import { cn } from '../utils';
import type * as React from 'react';

type RetroCardProps = React.ComponentProps<'div'>;

const RetroCard = ({ className, ...props }: RetroCardProps) => (
  <div className={cn('bg-card inline-block w-full rounded border-2 shadow-md', className)} {...props} />
);

const RetroCardContent = ({ className, ...props }: RetroCardProps) => (
  <div className={cn('p-4', className)} {...props} />
);

export { RetroCard, RetroCardContent };
