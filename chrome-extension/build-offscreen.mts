import { resolve } from 'node:path';
import { build } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { IS_DEV, IS_PROD } from '@extension/env';
import { copyFileSync, mkdirSync } from 'node:fs';

const rootDir = resolve(import.meta.dirname);
const srcDir = resolve(rootDir, 'src');
const outDir = resolve(rootDir, '..', 'dist', 'offscreen');

// Build the offscreen script
await build({
  configFile: false,
  resolve: {
    alias: {
      '@src': srcDir,
    },
  },
  plugins: [nodePolyfills()],
  build: {
    lib: {
      name: 'OffscreenScript',
      fileName: 'offscreen',
      formats: ['iife'],
      entry: resolve(srcDir, 'offscreen', 'offscreen.ts'),
    },
    outDir,
    emptyOutDir: true,
    sourcemap: IS_DEV,
    minify: IS_PROD,
    rollupOptions: {
      external: ['chrome'],
      output: {
        entryFileNames: 'offscreen.js',
      },
    },
  },
});

// Copy the HTML file
mkdirSync(outDir, { recursive: true });
copyFileSync(resolve(srcDir, 'offscreen', 'offscreen.html'), resolve(outDir, 'offscreen.html'));

console.log('[Build] Offscreen document built successfully');
