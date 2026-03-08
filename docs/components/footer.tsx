'use client';

import { Text } from '@/components/retroui/Text';

const product = [
  { name: 'Quick Start', href: '/docs/quick-start' },
  { name: 'Installation', href: '/docs/install' },
  { name: 'Browser Tools', href: '/docs/reference/browser-tools' },
  { name: 'CLI Reference', href: '/docs/reference/cli' },
];

const developers = [
  { name: 'Plugin Development', href: '/docs/guides/plugin-development' },
  { name: 'SDK Reference', href: '/docs/sdk/plugin-class' },
  { name: 'Your First Plugin', href: '/docs/first-plugin' },
  { name: 'Architecture', href: '/docs/contributing/architecture' },
];

const community = [
  { name: 'GitHub', href: 'https://github.com/opentabs-dev/opentabs' },
  { name: 'PRDs', href: 'https://github.com/opentabs-dev/opentabs-prds' },
  { name: 'Contributing', href: '/docs/contributing/dev-setup' },
];

const Footer = () => (
  <footer className="mt-24 border-t-2">
    <div className="mx-auto max-w-6xl px-4 py-16">
      <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Text as="h4" className="mb-4">
            OpenTabs
          </Text>
          <p className="max-w-xs text-muted-foreground text-sm leading-relaxed">
            Your browser is already logged in. Let your AI use it.
          </p>
        </div>

        <div>
          <p className="mb-4 font-bold text-foreground text-sm">Product</p>
          <ul className="space-y-2">
            {product.map(link => (
              <li key={link.name}>
                <a href={link.href} className="text-muted-foreground text-sm transition-colors hover:text-foreground">
                  {link.name}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-4 font-bold text-foreground text-sm">Developers</p>
          <ul className="space-y-2">
            {developers.map(link => (
              <li key={link.name}>
                <a href={link.href} className="text-muted-foreground text-sm transition-colors hover:text-foreground">
                  {link.name}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-4 font-bold text-foreground text-sm">Community</p>
          <ul className="space-y-2">
            {community.map(link => (
              <li key={link.name}>
                <a href={link.href} className="text-muted-foreground text-sm transition-colors hover:text-foreground">
                  {link.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>

    <div className="bg-foreground">
      <div className="mx-auto max-w-6xl px-4 py-6 text-center">
        <Text className="text-background text-sm">
          &copy; {new Date().getFullYear()} OpenTabs. Open source under MIT license.
        </Text>
      </div>
    </div>
  </footer>
);

export default Footer;
