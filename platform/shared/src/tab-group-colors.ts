/**
 * Single source of truth for the Chrome tab-group color palette.
 *
 * This module is intentionally pure-data and free of Node.js imports so it
 * can be safely consumed from browser contexts (Chrome extension service
 * worker, side panel) via the `@opentabs-dev/shared/tab-group-colors`
 * subpath export.
 */

/** Valid Chrome tab group colors, in the order Chrome assigns them. */
export const TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;

/** Union of valid Chrome tab group color names. Equivalent to `chrome.tabGroups.Color`. */
export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number];

/** Type guard: returns true if `value` is a valid Chrome tab group color. */
export const isTabGroupColor = (value: unknown): value is TabGroupColor =>
  typeof value === 'string' && (TAB_GROUP_COLORS as readonly string[]).includes(value);
