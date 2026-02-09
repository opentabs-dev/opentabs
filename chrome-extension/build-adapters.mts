/**
 * Build script for MAIN world adapters
 *
 * Adapters run in the page's JavaScript context (MAIN world) and are loaded
 * via chrome.scripting.registerContentScripts from the background script.
 *
 * Adapter entries are derived from SERVICE_REGISTRY — adding a new service
 * to the registry and creating its adapter file is all that's needed.
 *
 * Output: dist/adapters/*.js (IIFE format)
 */

import { resolve } from 'node:path';
import { withPageConfig } from '@extension/vite-config';
import { IS_DEV } from '@extension/env';
import { SERVICE_REGISTRY } from '@extension/shared';
import { build } from 'vite';

const rootDir = resolve(import.meta.dirname);
const srcDir = resolve(rootDir, 'src');
const adaptersDir = resolve(srcDir, 'adapters');
const outDir = resolve(rootDir, '..', 'dist', 'adapters');

// Derive adapter entries from the service registry
const adapterEntries: Record<string, string> = Object.fromEntries(
  SERVICE_REGISTRY.map(def => [def.type, resolve(adaptersDir, `${def.type}.ts`)]),
);

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
