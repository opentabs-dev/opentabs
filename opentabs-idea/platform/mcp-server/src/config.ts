/**
 * Config system — ~/.opentabs/config.json
 *
 * Single source of truth for local plugin paths and tool enabled/disabled state.
 * Created automatically on first MCP server run with sensible defaults.
 *
 * The config directory defaults to ~/.opentabs but can be overridden via the
 * OPENTABS_CONFIG_DIR environment variable. This is essential for parallel
 * E2E test execution where each test worker needs its own isolated config
 * to avoid clobbering shared state.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/** Shape of ~/.opentabs/config.json */
export interface OpentabsConfig {
  /** Filesystem paths to local plugin directories */
  plugins: string[];
  /** Tool enabled/disabled state: prefixed tool name → boolean. Absent = disabled. */
  tools: Record<string, boolean>;
}

const CONFIG_DIR = process.env.OPENTABS_CONFIG_DIR || join(homedir(), ".opentabs");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: OpentabsConfig = {
  plugins: [],
  tools: {},
};

/**
 * Load config from ~/.opentabs/config.json.
 * Creates the directory and file with defaults if they don't exist.
 * Catches file read/parse errors — returns defaults and logs a warning.
 */
export const loadConfig = async (): Promise<OpentabsConfig> => {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });

    let raw: string;
    try {
      raw = await readFile(CONFIG_PATH, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // First run — create default config
        await writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");
        console.log(`[opentabs] Created default config at ${CONFIG_PATH}`);
        return { ...DEFAULT_CONFIG, plugins: [], tools: {} };
      }
      throw err;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Validate and normalize
    const plugins = Array.isArray(parsed.plugins) ? (parsed.plugins as string[]) : [];
    const tools =
      parsed.tools && typeof parsed.tools === "object" && !Array.isArray(parsed.tools)
        ? (parsed.tools as Record<string, boolean>)
        : {};

    return { plugins, tools };
  } catch (err) {
    console.warn(`[opentabs] Failed to load config from ${CONFIG_PATH}, using defaults:`, err);
    return { ...DEFAULT_CONFIG, plugins: [], tools: {} };
  }
};

/**
 * Save config to ~/.opentabs/config.json.
 */
export const saveConfig = async (config: OpentabsConfig): Promise<void> => {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch (err) {
    console.warn(`[opentabs] Failed to save config to ${CONFIG_PATH}:`, err);
  }
};

/**
 * Check if a tool is enabled in config.
 * Absent from tools object = disabled.
 */
export const isToolEnabled = (config: OpentabsConfig, prefixedName: string): boolean =>
  config.tools[prefixedName] === true;

/**
 * Set a single tool's enabled/disabled state and persist.
 */
export const setToolEnabled = async (
  config: OpentabsConfig,
  prefixedName: string,
  enabled: boolean
): Promise<void> => {
  config.tools[prefixedName] = enabled;
  await saveConfig(config);
};

/**
 * Set all tools for a plugin enabled/disabled and persist.
 * Takes an array of prefixed tool names for the plugin.
 */
export const setAllToolsEnabled = async (
  config: OpentabsConfig,
  prefixedToolNames: string[],
  enabled: boolean
): Promise<void> => {
  for (const name of prefixedToolNames) {
    config.tools[name] = enabled;
  }
  await saveConfig(config);
};
