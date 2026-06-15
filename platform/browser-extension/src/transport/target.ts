/**
 * Build-time target platform.
 *
 * `__OPENTABS_TARGET__` and `__OPENTABS_IS_FIREFOX__` are substituted by
 * esbuild via `define` (see `build-extension.ts`). The Chrome build leaves the
 * target as the default `'chrome'`; a Firefox build sets `OPENTABS_TARGET=firefox`,
 * which makes esbuild inline literals and dead-code-eliminate unused branches.
 *
 * Cross-module consumers use the exported `isFirefox` runtime flag. Bundles that
 * must remove static references to browser-specific APIs should guard those
 * references directly with `__OPENTABS_IS_FIREFOX__` in the same module so
 * esbuild can drop the dead branch before AMO/Firefox linting.
 */

declare const __OPENTABS_TARGET__: 'chrome' | 'firefox' | undefined;
declare const __OPENTABS_IS_FIREFOX__: boolean | undefined;

export type ExtensionTarget = 'chrome' | 'firefox';

/** The platform this bundle was built for. Defaults to 'chrome'. */
export const TARGET: ExtensionTarget = typeof __OPENTABS_TARGET__ === 'string' ? __OPENTABS_TARGET__ : 'chrome';

export const isFirefox = typeof __OPENTABS_IS_FIREFOX__ === 'boolean' ? __OPENTABS_IS_FIREFOX__ : TARGET === 'firefox';
