import env, { IS_DEV, IS_PROD } from '@extension/env';
import { watchRebuildPlugin } from '@extension/hmr';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import deepmerge from 'deepmerge';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { resolve } from 'node:path';
import type { UserConfig } from 'vite';

// Project root is 4 levels up from the built file (packages/vite-config/dist/lib -> root)
const projectRoot = resolve(import.meta.dirname, '..', '..', '..', '..');

export const watchOption = IS_DEV
  ? {
      chokidar: {
        awaitWriteFinish: true,
      },
    }
  : undefined;

export const withPageConfig = (config: UserConfig) =>
  defineConfig(
    deepmerge(
      {
        define: {
          'process.env': env,
          __PROJECT_ROOT__: JSON.stringify(projectRoot),
        },
        base: '',
        plugins: [tailwindcss(), react(), IS_DEV && watchRebuildPlugin({ refresh: true }), nodePolyfills()],
        build: {
          sourcemap: IS_DEV,
          minify: IS_PROD,
          reportCompressedSize: IS_PROD,
          emptyOutDir: IS_PROD,
          watch: watchOption,
          rollupOptions: {
            external: ['chrome'],
          },
        },
      },
      config,
    ),
  );
