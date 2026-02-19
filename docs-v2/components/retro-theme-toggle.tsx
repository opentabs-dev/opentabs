'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
}

export function RetroThemeToggle({ className }: Props) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? resolvedTheme === 'dark' : false;

  return (
    <button
      type="button"
      aria-label="Toggle Theme"
      data-theme-toggle=""
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'border-border bg-background flex items-center justify-center border-2 p-2 shadow-sm transition-all hover:translate-y-0.5 hover:shadow-none',
        className,
      )}>
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
