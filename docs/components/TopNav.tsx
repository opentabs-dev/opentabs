'use client';

import { SiDiscord, SiGithub } from '@icons-pack/react-simple-icons';
import { MoonIcon, SunIcon } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/retroui';
import { navConfig } from '@/config/navigation';
import { useTheme } from '@/contexts/ThemeContext';
import HamburgerMenu from './HamburgerMenu';

export default function TopNav() {
  const { isDarkMode, toggleDarkMode } = useTheme();

  return (
    <nav className="sticky top-0 right-0 z-50 w-full border-b-2 bg-background">
      <div className="container mx-auto max-w-6xl px-4 lg:px-0">
        <div className="flex h-16 items-center justify-between">
          {/* Logo Section */}
          <div className="shrink-0">
            <Link href="/" className="flex items-center gap-2 font-head text-2xl">
              <Image src="/icon.svg" alt="OpenTabs logo" width={36} height={36} />
              <span className="text-foreground">OpenTabs</span>
            </Link>
          </div>

          {/* Navigation Links */}
          <div className="hidden space-x-4 md:flex">
            {navConfig.topNavItems.map(item => (
              <Link
                key={item.title}
                href={item.href}
                className="decoration-primary underline-offset-2 transition-all hover:underline">
                {item.title}
              </Link>
            ))}
          </div>

          <div className="flex items-center space-x-4 lg:hidden">
            <button type="button" onClick={toggleDarkMode} aria-label="Toggle dark mode">
              {isDarkMode ? <SunIcon size={20} /> : <MoonIcon size={20} />}
            </button>
            <Link
              href="https://discord.gg/b8Hjpz4B"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Discord">
              <SiDiscord size={24} />
            </Link>
            <Link
              href="https://github.com/opentabs-dev/opentabs"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub">
              <SiGithub size={24} />
            </Link>
            <HamburgerMenu />
          </div>

          <div className="hidden items-center space-x-3 lg:flex">
            <Link href="https://discord.gg/b8Hjpz4B" target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="icon" aria-label="Discord">
                <SiDiscord size={14} />
              </Button>
            </Link>
            <Link href="https://github.com/opentabs-dev/opentabs" target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="icon" aria-label="GitHub">
                <SiGithub size={14} />
              </Button>
            </Link>
            <Button variant="secondary" size="icon" onClick={toggleDarkMode} aria-label="Toggle dark mode">
              {isDarkMode ? <SunIcon size={14} /> : <MoonIcon size={14} />}
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
