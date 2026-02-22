import type { PluginMeta } from './extension-messages.js';

/**
 * Checks if a URL matches any of the given Chrome match patterns.
 *
 * @param url - The full URL to test (e.g., `https://app.slack.com/client`)
 * @param patterns - Chrome extension match patterns to test against
 * @returns `true` if the URL matches at least one pattern
 */
export const urlMatchesPatterns = (url: string, patterns: string[]): boolean => {
  for (const pattern of patterns) {
    if (matchPattern(url, pattern)) return true;
  }
  return false;
};

/**
 * Tests a single URL against a Chrome extension match pattern.
 *
 * Pattern format: `<scheme>://<host>[:<port>]/<path>` where scheme is
 * `*`, `http`, `https`, or `ftp`; host supports `*` (any host) and
 * `*.domain` (subdomain wildcard); path supports `*` as a glob.
 *
 * Examples:
 * - `*://localhost:9516/*` matches `http://localhost:9516/anything`
 * - `*://*.slack.com/*` matches `https://app.slack.com/anything`
 * - `http://example.com/*` matches `http://example.com/anything`
 *
 * @param url - The full URL to test
 * @param pattern - A Chrome extension match pattern string
 * @returns `true` if the URL matches the pattern
 */
export const matchPattern = (url: string, pattern: string): boolean => {
  const matchResult = pattern.match(/^(\*|https?|ftp):\/\/(.+?)(\/.*)$/);
  if (!matchResult?.[1] || !matchResult[2] || !matchResult[3]) return false;

  const [, scheme, hostWithPort, path] = matchResult;

  // Separate host and optional port from the pattern's host portion.
  // Examples: "localhost:9516" → host="localhost", port="9516"
  //           "*.slack.com"   → host="*.slack.com", port=""
  //           "*"             → host="*", port=""
  let patternHost: string;
  let patternPort: string;
  const colonIdx = hostWithPort.lastIndexOf(':');
  // Only split on colon if what follows looks like a port number (all digits)
  // and the host isn't just "*" — avoids misinterpreting IPv6 or *.host:port
  if (colonIdx > 0 && /^\d+$/.test(hostWithPort.slice(colonIdx + 1))) {
    patternHost = hostWithPort.slice(0, colonIdx);
    patternPort = hostWithPort.slice(colonIdx + 1);
  } else {
    patternHost = hostWithPort;
    patternPort = '';
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Scheme match
  if (scheme !== '*' && parsed.protocol !== `${scheme}:`) return false;
  if (scheme === '*' && !['http:', 'https:'].includes(parsed.protocol)) return false;

  // Port match — if the pattern specifies a port, the URL must have that port.
  // URL.port is "" for default ports (80 for http, 443 for https).
  if (patternPort) {
    if (parsed.port !== patternPort) return false;
  }

  // Host match
  if (patternHost !== '*') {
    if (patternHost.startsWith('*.')) {
      const suffix = patternHost.slice(2);
      if (parsed.hostname !== suffix && !parsed.hostname.endsWith(`.${suffix}`)) return false;
    } else {
      if (parsed.hostname !== patternHost) return false;
    }
  }

  // Path match — convert glob to regex
  if (path !== '/*') {
    const pathRegex = new RegExp('^' + path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    if (!pathRegex.test(parsed.pathname)) return false;
  }

  return true;
};

/**
 * Finds all open tabs matching a plugin's URL patterns, sorted by rank (best first).
 *
 * Ranking prefers (in order):
 *   1. Active tab in the focused window
 *   2. Active tab in any window
 *   3. Any tab in the focused window
 *   4. First matching tab
 *
 * This enables fallback: when the best-ranked tab is not ready, callers can
 * try subsequent tabs in order.
 *
 * @param plugin - Plugin metadata containing `urlPatterns` to match against
 * @returns Matching tabs sorted by rank (highest-priority first), deduplicated by tab ID
 */
export const findAllMatchingTabs = async (plugin: PluginMeta): Promise<chrome.tabs.Tab[]> => {
  // Collect all matching tabs across all URL patterns, deduplicating by tab ID
  const seen = new Set<number>();
  const allMatches: chrome.tabs.Tab[] = [];

  for (const pattern of plugin.urlPatterns) {
    let tabs: chrome.tabs.Tab[];
    try {
      tabs = await chrome.tabs.query({ url: pattern });
    } catch {
      continue;
    }
    for (const tab of tabs) {
      if (tab.id !== undefined && !seen.has(tab.id)) {
        seen.add(tab.id);
        allMatches.push(tab);
      }
    }
  }

  if (allMatches.length <= 1) return allMatches;

  // Determine the focused window for ranking
  let focusedWindowId: number | undefined;
  try {
    const focusedWindow = await chrome.windows.getLastFocused();
    focusedWindowId = focusedWindow.id;
  } catch {
    // Cannot determine focused window — ranking falls back to insertion order
  }

  // Rank: active+focused > active > focused > other
  const rank = (tab: chrome.tabs.Tab): number => {
    const inFocused = focusedWindowId !== undefined && tab.windowId === focusedWindowId;
    if (tab.active && inFocused) return 3;
    if (tab.active) return 2;
    if (inFocused) return 1;
    return 0;
  };

  return allMatches.slice().sort((a, b) => rank(b) - rank(a));
};

/**
 * Finds the best matching tab for a plugin's URL patterns.
 *
 * @param plugin - Plugin metadata containing `urlPatterns` to match against
 * @returns The highest-ranked matching tab, or `null` if no matching tabs exist.
 *   See {@link findAllMatchingTabs} for ranking details.
 */
export const findMatchingTab = async (plugin: PluginMeta): Promise<chrome.tabs.Tab | null> => {
  const tabs = await findAllMatchingTabs(plugin);
  return tabs[0] ?? null;
};
