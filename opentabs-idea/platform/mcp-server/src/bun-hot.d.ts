/**
 * Type declarations for bun --hot globalThis-based cleanup.
 *
 * Bun 1.x provides NO dispose API (neither module.hot nor import.meta.hot).
 * We use a namespaced key on globalThis to stash cleanup handles between
 * hot reloads. This file ensures TypeScript doesn't complain about the
 * dynamic property access on globalThis.
 *
 * The actual HotCleanupHandle interface lives in index.ts where it's used.
 */
