'use client';

import Link from 'next/link';
import { Menu } from 'lucide-react';
import { SidebarTrigger } from 'fumadocs-ui/components/sidebar/base';
import { RetroSearchToggleSm } from '@/components/retro-search-toggle';

export function RetroNavbar() {
  return (
    <header
      id="nd-subnav"
      className="border-border bg-background max-md:layout:[--fd-header-height:--spacing(14)] sticky top-(--fd-docs-row-1) z-30 flex h-(--fd-header-height) items-center gap-1 border-b-2 px-4 [grid-area:header] md:hidden">
      <Link href="/" className="font-head mr-auto text-xl">
        OpenTabs
      </Link>
      <RetroSearchToggleSm hideIfDisabled />
      <SidebarTrigger
        aria-label="Toggle sidebar"
        className="border-border bg-background flex items-center justify-center border-2 p-2 shadow-sm transition-all hover:translate-y-0.5 hover:shadow-none">
        <Menu className="size-4" />
      </SidebarTrigger>
    </header>
  );
}
