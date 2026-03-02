import { cn } from '../lib/cn.js';
import { Wrench } from 'lucide-react';
import { DynamicIcon } from 'lucide-react/dynamic';
import { Suspense, useState, useEffect, useRef } from 'react';
import type { IconName } from 'lucide-react/dynamic';

interface ToolIconProps {
  icon?: string;
  className?: string;
  enabled?: boolean;
  active?: boolean;
}

const FallbackIcon = ({ enabled = true }: { enabled?: boolean }) => (
  <Wrench className={cn('h-3 w-3 transition-colors', enabled ? 'text-primary-foreground' : 'text-muted-foreground')} />
);

const ToolIcon = ({ icon, className = '', enabled = true, active = false }: ToolIconProps) => {
  const [fadingOut, setFadingOut] = useState(false);
  const prevActiveRef = useRef(false);

  useEffect(() => {
    if (prevActiveRef.current && !active) {
      setTimeout(() => setFadingOut(true), 0);
      const timer = setTimeout(() => setFadingOut(false), 500);
      prevActiveRef.current = active;
      return () => clearTimeout(timer);
    }
    prevActiveRef.current = active;
    return;
  }, [active]);

  return (
    <div
      className={cn(
        'relative flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 transition-colors',
        enabled ? 'border-border bg-primary' : 'border-border/40 bg-muted/40',
        className,
      )}>
      {icon ? (
        <Suspense fallback={<FallbackIcon enabled={enabled} />}>
          <DynamicIcon
            name={icon as IconName}
            className={cn('h-3 w-3 transition-colors', enabled ? 'text-primary-foreground' : 'text-muted-foreground')}
            fallback={() => <FallbackIcon enabled={enabled} />}
          />
        </Suspense>
      ) : (
        <FallbackIcon enabled={enabled} />
      )}
      {(active || fadingOut) && (
        <div
          className={cn(
            'bg-success border-card absolute rounded-full border-2',
            active && 'animate-activity-flash',
            fadingOut && !active && 'animate-activity-fade-out',
          )}
          style={{ width: 8, height: 8, bottom: -2, right: -2 }}
        />
      )}
    </div>
  );
};

export { ToolIcon };
