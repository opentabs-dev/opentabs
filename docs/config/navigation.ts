import type { INavigationConfig } from '@/types';

export const navConfig: INavigationConfig = {
  topNavItems: [
    { title: 'Docs', href: '/docs' },
    { title: 'SDK', href: '/docs/sdk/plugin-class' },
  ],
  sideNavItems: [
    {
      title: 'Getting Started',
      children: [
        { title: 'Introduction', href: '/docs' },
        { title: 'Quick Start', href: '/docs/quick-start' },
        { title: 'Installation', href: '/docs/install' },
        { title: 'Your First Plugin', href: '/docs/first-plugin' },
      ],
    },
    {
      title: 'Guides',
      children: [
        {
          title: 'Plugin Development',
          href: '/docs/guides/plugin-development',
        },
        { title: 'Error Handling', href: '/docs/guides/error-handling' },
        {
          title: 'Logging & Debugging',
          href: '/docs/guides/logging-debugging',
        },
        {
          title: 'Resources & Prompts',
          href: '/docs/guides/resources-prompts',
        },
        {
          title: 'Streaming & Progress',
          href: '/docs/guides/streaming-progress',
        },
      ],
    },
    {
      title: 'SDK Reference',
      children: [
        { title: 'Plugin Class', href: '/docs/sdk/plugin-class' },
        { title: 'Tools', href: '/docs/sdk/tools' },
        { title: 'Resources', href: '/docs/sdk/resources' },
        { title: 'Prompts', href: '/docs/sdk/prompts' },
        { title: 'Utilities', href: '/docs/sdk/utilities' },
        { title: 'Lifecycle Hooks', href: '/docs/sdk/lifecycle-hooks' },
        { title: 'Error Types', href: '/docs/sdk/error-types' },
      ],
    },
    {
      title: 'Server Reference',
      children: [
        { title: 'CLI Commands', href: '/docs/reference/cli' },
        { title: 'Configuration', href: '/docs/reference/configuration' },
        { title: 'MCP Server', href: '/docs/reference/mcp-server' },
        { title: 'Browser Tools', href: '/docs/reference/browser-tools' },
        {
          title: 'Troubleshooting',
          href: '/docs/reference/troubleshooting',
        },
      ],
    },
    {
      title: 'Contributing',
      children: [
        {
          title: 'Development Setup',
          href: '/docs/contributing/dev-setup',
        },
        { title: 'Architecture', href: '/docs/contributing/architecture' },
        { title: 'Publishing', href: '/docs/contributing/publishing' },
      ],
    },
  ],
};
