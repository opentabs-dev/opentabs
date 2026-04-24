/**
 * Pre-script value accessor (adapter-side).
 *
 * Reads values stashed by this plugin's pre-script at document_start.
 * The pre-script writes to `globalThis.__openTabs.preScript[<pluginName>][key]`
 * via the context handed to `definePreScript`. The adapter IIFE runtime
 * injects the plugin name at build time; this reader consults the plugin
 * binding set up by the adapter wrapper.
 *
 * Returns `undefined` when:
 *   - The plugin has no pre-script declared.
 *   - The adapter was injected into a tab that was already open when the
 *     plugin registered (pre-scripts only fire on future navigations).
 *   - The pre-script ran but didn't call `set(key, ...)`.
 *
 * Callers MUST handle `undefined` — it is a normal branch, not an error.
 */
export const getPreScriptValue = <T = unknown>(key: string): T | undefined => {
  const ot = (globalThis as Record<string, unknown>).__openTabs as
    | { preScript?: Record<string, Record<string, unknown>>; _pluginName?: string }
    | undefined;
  const pluginName = ot?._pluginName;
  if (!pluginName) return undefined;
  const bucket = ot?.preScript?.[pluginName];
  if (!bucket) return undefined;
  return bucket[key] as T | undefined;
};
