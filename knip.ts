import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      ignoreDependencies: [
        // Peer dependencies required by ESLint plugins at runtime
        'postcss',
        'postcss-load-config',
        '@tailwindcss/vite',
        '@typescript-eslint/parser',
        'eslint-plugin-react-hooks',
        // Used by bash scripts / CLI tooling
        'cross-env',
        'run-script-os',
      ],
    },
    'chrome-extension': {
      entry: [
        'src/background/index.ts',
        'src/offscreen/offscreen.ts',
        'src/adapters/slack.ts',
        'src/adapters/datadog.ts',
        'src/adapters/sqlpad.ts',
        'src/adapters/logrocket.ts',
        'src/adapters/retool.ts',
        'src/adapters/snowflake.ts',
        'manifest.ts',
      ],
      ignoreDependencies: [
        // Build-graph dependencies: these packages output to the shared dist/ directory
        // referenced by manifest.ts (content scripts, options page, side panel).
        // Turborepo needs them declared so ^build orders the build correctly and
        // --filter=chrome-extension... includes them.
        '@extension/content-script',
        '@extension/options',
        '@extension/side-panel',
      ],
    },
    'pages/content': {
      entry: ['src/stub/index.ts'],
    },
    'packages/mcp-server': {
      ignoreDependencies: [
        // ws is imported by websocket-relay.ts; @types/ws provides its type definitions
        'ws',
        '@types/ws',
      ],
    },
    'packages/hmr': {
      entry: [
        // Rollup entry points built as separate bundles
        'lib/injections/reload.ts',
        'lib/injections/refresh.ts',
      ],
      ignoreDependencies: [
        // ws is imported by init-reload-server.ts and watch-rebuild-plugin.ts
        'ws',
        '@types/ws',
      ],
    },
    'packages/e2e': {
      entry: ['tests/**/*.e2e.ts', 'lib/**/*.ts'],
      ignoreDependencies: [
        // ws is imported by test clients and e2e test files
        'ws',
        '@types/ws',
      ],
    },
    'packages/tsconfig': {
      // JSON config files only
      ignore: ['**/*'],
    },
  },
  ignore: ['**/dist/**'],
  // Tailwind CSS v4 @source directives in CSS files are not JS imports
  ignoreUnresolved: [/\.tsx$/],
  ignoreExportsUsedInFile: true,
};

export default config;
