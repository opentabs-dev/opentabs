/**
 * Pre-script entry point — narrow subpath export for plugins that need to run
 * code at document_start in MAIN world, before any page script.
 *
 * The pre-script runs once per matching-tab navigation, strictly before page
 * JavaScript. Its purpose is to observe or monkey-patch page runtime state
 * that the page would otherwise hide — auth tokens in outbound fetch/XHR,
 * CSRF nonces, early globals, etc. — and stash them in a per-plugin namespace
 * the adapter reads later via `getPreScriptValue`.
 *
 * Pre-scripts run in MAIN world and have NO access to `chrome.*` APIs and NO
 * access to the main SDK (no DOM helpers, no fetch utilities, no tool
 * infrastructure). The only surface is `definePreScript`.
 *
 * The plugin name bound to `set` is injected at build time by the pre-script
 * IIFE wrapper — plugins cannot write to each other's namespaces.
 */

/** Value types the pre-script can stash. JSON-serializable primitives only. */
export type PreScriptValue = string | number | boolean | null | Record<string, unknown> | unknown[];

/** Handle passed to the pre-script callback. */
export interface PreScriptContext {
  /**
   * Stash a value in this plugin's pre-script namespace.
   * The adapter reads it via `getPreScriptValue(key)` from the main SDK.
   */
  set(key: string, value: PreScriptValue): void;
  /**
   * Log to the browser console with a plugin-scoped prefix.
   * Pre-script logs do NOT flow through the extension log relay
   * (the relay's ISOLATED-world listener is installed later by the adapter).
   */
  log: {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  };
}

/**
 * Define the pre-script entry. The callback runs synchronously at
 * document_start in MAIN world. It receives a context with a per-plugin
 * `set(key, value)` writer.
 *
 * The pre-script IIFE wrapper invokes the callback with the correct context.
 * Calling `definePreScript` outside the wrapper (e.g., in tests) is a no-op.
 */
export const definePreScript = (fn: (ctx: PreScriptContext) => void): void => {
  const ot = (globalThis as Record<string, unknown>).__openTabs as
    | { _preScriptRunner?: (fn: (ctx: PreScriptContext) => void) => void }
    | undefined;
  ot?._preScriptRunner?.(fn);
};
