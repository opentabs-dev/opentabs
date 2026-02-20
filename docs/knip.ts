import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    // fumadocs-mdx consumes named exports via generated .source/ code at build time
    'source.config.ts',
    // Imported from content/docs/components.mdx — Knip cannot trace ESM imports inside MDX files
    'components/retroui/Badge.tsx',
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
