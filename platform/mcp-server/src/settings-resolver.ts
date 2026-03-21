/**
 * Settings resolver: derives effective URL patterns and homepage from
 * user-provided settings values combined with a plugin's configSchema.
 *
 * url-type settings with valid user values produce Chrome match patterns
 * (e.g., *://hostname/*) that are appended to the plugin's static urlPatterns.
 * The first valid url-type setting also becomes the effective homepage if
 * no static homepage is defined.
 */

import type { ConfigSchema } from '@opentabs-dev/shared';
import { log } from './logger.js';

interface ResolvedSettings {
  /** Static urlPatterns plus patterns derived from url-type settings */
  effectiveUrlPatterns: string[];
  /** Static homepage or derived from the first url-type setting value */
  effectiveHomepage: string | undefined;
  /** Validated setting values (invalid values are excluded). url fields store the full Record<string, string> map. */
  resolvedValues: Record<string, unknown>;
  /** Instance name → Chrome match pattern mapping for multi-instance url settings */
  instanceMap: Record<string, string>;
}

/**
 * Derive a Chrome match pattern from a URL string.
 * Returns `*://hostname/*` for valid URLs, or null for invalid ones.
 */
const deriveMatchPattern = (urlString: string): string | null => {
  try {
    const url = new URL(urlString);
    return `*://${url.hostname}/*`;
  } catch {
    return null;
  }
};

/**
 * Resolve plugin settings by combining a plugin's configSchema with
 * user-provided values from config.json.
 *
 * For url-type settings, validates that the value is a parseable URL and
 * derives a Chrome match pattern. Invalid URLs are logged and skipped.
 *
 * Returns effective URL patterns (static + derived), effective homepage,
 * and the validated setting values map.
 */
const resolvePluginSettings = (
  pluginName: string,
  staticUrlPatterns: string[],
  staticHomepage: string | undefined,
  configSchema: ConfigSchema | undefined,
  userSettings: Record<string, unknown> | undefined,
): ResolvedSettings => {
  const derivedPatterns: string[] = [];
  const resolvedValues: Record<string, unknown> = {};
  let derivedHomepage: string | undefined;
  let instanceMap: Record<string, string> = {};

  if (configSchema && userSettings) {
    for (const [key, definition] of Object.entries(configSchema)) {
      const rawValue = userSettings[key];
      if (rawValue === undefined || rawValue === null) continue;

      if (definition.type === 'url') {
        if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) {
          log.warn(
            `Plugin "${pluginName}" setting "${key}": expected a Record<string, string>, got ${typeof rawValue} — skipping`,
          );
          continue;
        }
        const urlMap = rawValue as Record<string, string>;
        const validEntries: Record<string, string> = {};
        for (const [instanceName, url] of Object.entries(urlMap)) {
          if (typeof url !== 'string' || url.length === 0) {
            log.warn(
              `Plugin "${pluginName}" setting "${key}" instance "${instanceName}": expected a URL string — skipping`,
            );
            continue;
          }
          const pattern = deriveMatchPattern(url);
          if (!pattern) {
            log.warn(
              `Plugin "${pluginName}" setting "${key}" instance "${instanceName}": invalid URL "${url}" — skipping`,
            );
            continue;
          }
          derivedPatterns.push(pattern);
          validEntries[instanceName] = pattern;
          if (!derivedHomepage) derivedHomepage = url;
        }
        if (Object.keys(validEntries).length > 0) {
          instanceMap = { ...instanceMap, ...validEntries };
          resolvedValues[key] = rawValue;
        }
      } else if (definition.type === 'string') {
        if (typeof rawValue === 'string') {
          resolvedValues[key] = rawValue;
        }
      } else if (definition.type === 'number') {
        if (typeof rawValue === 'number') {
          resolvedValues[key] = rawValue;
        }
      } else if (definition.type === 'boolean') {
        if (typeof rawValue === 'boolean') {
          resolvedValues[key] = rawValue;
        }
      } else if (definition.type === 'select') {
        if (typeof rawValue === 'string' && definition.options?.includes(rawValue)) {
          resolvedValues[key] = rawValue;
        }
      }
    }
  }

  return {
    effectiveUrlPatterns: [...staticUrlPatterns, ...derivedPatterns],
    effectiveHomepage: staticHomepage ?? derivedHomepage,
    resolvedValues,
    instanceMap,
  };
};

export { resolvePluginSettings };
export type { ResolvedSettings };
