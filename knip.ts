import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['e2e/*.ts', 'scripts/*.ts'],
      ignoreDependencies: [
        // Peer dependencies required by ESLint plugins at runtime
        '@typescript-eslint/parser',
        'eslint-plugin-react-hooks',
      ],
    },
    'platform/shared': {
      entry: ['src/**/*.test.ts'],
    },
    'platform/mcp-server': {
      entry: ['src/**/*.test.ts'],
    },
    'platform/plugin-sdk': {},
    'platform/cli': {
      entry: ['src/**/*.test.ts'],
      ignoreDependencies: [
        // Resolved at runtime via import.meta.resolve() in scaffold.ts to read its version
        '@opentabs-dev/plugin-tools',
      ],
    },
    'platform/plugin-tools': {
      entry: ['src/**/*.test.ts'],
    },
    'platform/browser-extension': {
      entry: [
        'src/background.ts',
        'src/offscreen/index.ts',
        'src/side-panel/index.tsx',
        'src/side-panel/styles.css',
        'src/**/*.test.ts',
        'src/**/*.stories.tsx',
      ],
      ignoreDependencies: [
        // CSS-only dependency imported via @import in styles.css (knip cannot trace CSS imports)
        'tw-animate-css',
        // Vite plugin used in .storybook/main.ts via dynamic import (knip cannot trace dynamic imports)
        '@vitejs/plugin-react',
      ],
    },
    'platform/create-plugin': {},
  },
  tags: ['+@public'],
  ignore: [
    '**/dist/**',
    'plugins/**',
    'docs/**',
    'docs-v2/**',
    'platform/browser-extension/side-panel/**/*.{js,css}',
    '**/storybook-static/**',
    '.ralph/worktrees/**',
    '.claude/worktrees/**',
  ],
  ignoreExportsUsedInFile: true,
};

export default config;
