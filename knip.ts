import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['e2e/*.ts', 'scripts/*.ts'],
      ignoreDependencies: [
        // Referenced as Babel preset/plugin strings in build-side-panel.ts config, not as imports
        '@babel/preset-react',
        '@babel/preset-typescript',
        'babel-plugin-react-compiler',
      ],
    },
    'platform/shared': {
      entry: ['src/**/*.test.ts'],
    },
    'platform/mcp-server': {
      entry: ['src/**/*.test.ts', 'src/dev-proxy.ts', 'src/stdio.ts', 'src/telemetry.ts'],
    },
    'platform/plugin-sdk': {},
    'platform/cli': {
      entry: ['src/**/*.test.ts'],
      ignoreDependencies: [
        // Referenced as a string literal in scaffolded package.json output, not a static import
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
        'esbuild-plugin-babel.d.ts',
        '.storybook/globals.d.ts',
      ],
      ignoreDependencies: [
        // Required at runtime by rolldown-vite (aliased as "vite") for Storybook builds
        'rollup',
      ],
    },
    'platform/create-plugin': {},
  },
  tags: ['+@public'],
  ignore: [
    'plugins/**',
    'docs/**',
    'platform/browser-extension/side-panel/**/*.{js,css}',
    'platform/browser-extension/src/dev/*.js',
  ],
  ignoreExportsUsedInFile: true,
};

export default config;
