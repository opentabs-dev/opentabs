/**
 * Build script for MAIN world adapters
 *
 * Adapters run in the page's JavaScript context (MAIN world) and are loaded
 * via chrome.scripting.registerContentScripts from the background script.
 *
 * Output: dist/adapters/*.js (IIFE format)
 */

import { resolve } from 'node:path';
import { withPageConfig } from '@extension/vite-config';
import { IS_DEV } from '@extension/env';
import { build } from 'vite';

const rootDir = resolve(import.meta.dirname);
const srcDir = resolve(rootDir, 'src');
const adaptersDir = resolve(srcDir, 'adapters');
const outDir = resolve(rootDir, '..', 'dist', 'adapters');

// Define adapters to build
const adapterEntries = {
  slack: resolve(adaptersDir, 'slack.ts'),
  datadog: resolve(adaptersDir, 'datadog.ts'),
  sqlpad: resolve(adaptersDir, 'sqlpad.ts'),
  logrocket: resolve(adaptersDir, 'logrocket.ts'),
  retool: resolve(adaptersDir, 'retool.ts'),
  snowflake: resolve(adaptersDir, 'snowflake.ts'),
};

// Build each adapter as an IIFE
const configs = Object.entries(adapterEntries).map(([name, entry]) =>
  withPageConfig({
    mode: IS_DEV ? 'development' : undefined,
    resolve: {
      alias: {
        '@src': srcDir,
      },
    },
    publicDir: false,
    build: {
      lib: {
        name: `${name}Adapter`,
        formats: ['iife'],
        entry,
        fileName: name,
      },
      outDir,
      emptyOutDir: false,
    },
  }),
);

const builds = configs.map(async config => {
  //@ts-expect-error This is hidden property into vite's resolveConfig()
  config.configFile = false;
  await build(config);
});

await Promise.all(builds);

console.log('[Adapters Build] Built adapters:', Object.keys(adapterEntries).join(', '));
