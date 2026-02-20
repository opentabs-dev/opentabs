'use client';

import { cn } from '@/lib/utils';
import { usePathname } from 'fumadocs-core/framework';
import Link from 'fumadocs-core/link';
import { useFooterItems } from 'fumadocs-ui/utils/use-footer-items';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

const normalizeUrl = (url: string): string => (url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url);

const isPageActive = (href: string, pathname: string): boolean => normalizeUrl(href) === normalizeUrl(pathname);

export const RetroPageFooter = () => {
  const footerList = useFooterItems();
  const pathname = usePathname();

  const { previous, next } = useMemo(() => {
    const idx = footerList.findIndex(item => isPageActive(item.url, pathname));
    if (idx === -1) return {};
    return {
      previous: footerList[idx - 1],
      next: footerList[idx + 1],
    };
  }, [footerList, pathname]);

  if (!previous && !next) return null;

  return (
    <div
      className={cn('border-border mt-8 grid gap-4 border-t-2 pt-6', previous && next ? 'grid-cols-2' : 'grid-cols-1')}>
      {previous && (
        <Link
          href={previous.url}
          className="border-border flex flex-col gap-2 border-2 p-4 shadow-md transition-all hover:translate-y-1 hover:shadow active:translate-y-1.5 active:shadow-none max-md:col-span-full">
          <div className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
            <ChevronLeft className="-mx-1 size-4 shrink-0" />
            <span className="font-sans">Previous</span>
          </div>
          <p className="font-head truncate font-medium">{previous.name}</p>
        </Link>
      )}
      {next && (
        <Link
          href={next.url}
          className="border-border flex flex-col gap-2 border-2 p-4 text-end shadow-md transition-all hover:translate-y-1 hover:shadow active:translate-y-1.5 active:shadow-none max-md:col-span-full">
          <div className="text-muted-foreground inline-flex items-center justify-end gap-1.5 text-sm">
            <span className="font-sans">Next</span>
            <ChevronRight className="-mx-1 size-4 shrink-0" />
          </div>
          <p className="font-head truncate font-medium">{next.name}</p>
        </Link>
      )}
    </div>
  );
};
