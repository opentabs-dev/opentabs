import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'source.config.ts',
    'mdx-components.tsx',
    // RetroUI component library barrel — all re-exported components are part of the public API
    'components/retroui/index.ts',
  ],
  ignoreDependencies: [
    // Peer dependency required by ESLint's typescript-eslint at runtime
    '@typescript-eslint/parser',
    // Consumed via FlatCompat string reference in eslint.config.ts — Knip cannot trace string-based plugin references
    'eslint-plugin-react-hooks',
  ],
  ignoreExportsUsedInFile: true,
};

export default config;
