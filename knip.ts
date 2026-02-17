import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['e2e/*.ts'],
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
    },
    'platform/browser-extension': {
      entry: [
        'src/background.ts',
        'src/offscreen/index.ts',
        'src/side-panel/index.tsx',
        'src/side-panel/styles.css',
        'src/**/*.test.ts',
      ],
    },
    'platform/create-plugin': {},
    website: {
      ignoreDependencies: [
        // Peer dependency required by vitepress at runtime
        'vue',
      ],
    },
  },
  tags: ['+@public'],
  ignore: ['**/dist/**', 'plugins/**'],
  ignoreExportsUsedInFile: true,
};

export default config;
