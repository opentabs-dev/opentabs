import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { RetroNavbar } from '@/components/retro-navbar';
import { RetroSearchToggleLg } from '@/components/retro-search-toggle';
import { RetroThemeToggle } from '@/components/retro-theme-toggle';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: <span className="font-head text-xl">OpenTabs</span>,
    component: <RetroNavbar />,
  },
  searchToggle: {
    components: {
      lg: <RetroSearchToggleLg hideIfDisabled />,
    },
  },
  themeSwitch: {
    component: <RetroThemeToggle />,
  },
};
