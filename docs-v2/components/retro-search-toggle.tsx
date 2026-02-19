'use client';

import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
  hideIfDisabled?: boolean;
}

export function RetroSearchToggleSm({ className, hideIfDisabled }: Props) {
  const { setOpenSearch, enabled } = useSearchContext();
  if (hideIfDisabled && !enabled) return null;
  return (
    <button
      type="button"
      aria-label="Open Search"
      data-search=""
      onClick={() => setOpenSearch(true)}
      className={cn(
        'border-border bg-background flex items-center justify-center border-2 p-2 shadow-sm transition-all hover:translate-y-0.5 hover:shadow-none',
        className,
      )}>
      <Search className="size-4" />
    </button>
  );
}

export function RetroSearchToggleLg({ className, hideIfDisabled }: Props) {
  const { setOpenSearch, enabled, hotKey } = useSearchContext();
  if (hideIfDisabled && !enabled) return null;
  return (
    <button
      type="button"
      data-search-full=""
      onClick={() => setOpenSearch(true)}
      className={cn(
        'border-border bg-background text-muted-foreground inline-flex w-full items-center gap-2 border-2 px-3 py-2 text-sm shadow-md transition-all hover:shadow-sm',
        className,
      )}>
      <Search className="size-4 shrink-0" />
      <span className="font-sans">Search</span>
      {hotKey.length > 0 && (
        <div className="ml-auto inline-flex gap-0.5">
          {hotKey.map((k, i) => (
            <kbd key={i} className="border-border bg-background border-2 px-1.5 py-0.5 font-mono text-xs">
              {k.display}
            </kbd>
          ))}
        </div>
      )}
    </button>
  );
}
