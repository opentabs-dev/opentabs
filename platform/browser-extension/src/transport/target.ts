/**
 * Build-time target platform.
 *
 * `__OPENTABS_TARGET__` is substituted by esbuild via a `define` (see
 * `build-extension.ts`). The Chrome build leaves it as the default `'chrome'`;
 * a Firefox build sets `OPENTABS_TARGET=firefox`, which makes esbuild inline the
 * literal `'firefox'` and dead-code-eliminate the unused branch.
 *
 * Using a `define`d global (rather than reading an env var at runtime) keeps the
 * bundle self-contained and lets the bundler strip the unused transport path
 * entirely from each target's output.
 */

declare const __OPENTABS_TARGET__: 'chrome' | 'firefox' | undefined;

export type ExtensionTarget = 'chrome' | 'firefox';

/** The platform this bundle was built for. Defaults to 'chrome'. */
export const TARGET: ExtensionTarget = typeof __OPENTABS_TARGET__ === 'string' ? __OPENTABS_TARGET__ : 'chrome';

export const isFirefox = TARGET === 'firefox';
