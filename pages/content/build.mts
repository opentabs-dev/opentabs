import { resolve } from 'node:path';
import { makeEntryPointPlugin } from '@extension/hmr';
import { withPageConfig } from '@extension/vite-config';
import { IS_DEV } from '@extension/env';
import { build } from 'vite';

const rootDir = resolve(import.meta.dirname);
const srcDir = resolve(rootDir, 'src');
const outDir = resolve(rootDir, '..', '..', 'dist', 'content');

// Content stub entry (minimal ISOLATED world script for chrome API access)
// All services use this stub; API logic is handled by per-service MAIN world adapters.
const stubConfig = withPageConfig({
  mode: IS_DEV ? 'development' : undefined,
  resolve: {
    alias: {
      '@src': srcDir,
    },
  },
  publicDir: false,
  plugins: [IS_DEV && makeEntryPointPlugin()],
  build: {
    lib: {
      name: 'stub',
      formats: ['iife'],
      entry: resolve(srcDir, 'stub', 'index.ts'),
      fileName: 'stub',
    },
    outDir,
    emptyOutDir: false,
  },
});

const configs = [stubConfig];

const builds = configs.map(async config => {
  //@ts-expect-error This is hidden property into vite's resolveConfig()
  config.configFile = false;
  await build(config);
});

await Promise.all(builds);
