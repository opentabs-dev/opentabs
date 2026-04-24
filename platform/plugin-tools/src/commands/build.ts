/**
 * `opentabs-plugin build` command — generates dist/tools.json and bundles the adapter IIFE.
 * Plugin metadata (name, version, displayName, description, urlPatterns) is read from
 * package.json's `opentabs` field; tool schemas are serialized from the plugin module.
 * With `--watch`, rebuilds automatically when tsc output in `dist/` changes.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { FSWatcher } from 'node:fs';
import { mkdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { access, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConfigSchema, ManifestTool, OpenTabsPlugin, ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { LUCIDE_ICON_NAMES, validatePluginName, validateUrlPattern } from '@opentabs-dev/plugin-sdk';
import type { PluginPackageJson } from '@opentabs-dev/shared';
import {
  ADAPTER_FILENAME,
  ADAPTER_SOURCE_MAP_FILENAME,
  atomicWrite,
  DEFAULT_HOST,
  DEFAULT_PORT,
  getConfigDir,
  getConfigPath,
  PRE_SCRIPT_FILENAME,
  parsePluginPackageJson,
  pluginNameFromPackage,
  TOOLS_FILENAME,
  toErrorMessage,
} from '@opentabs-dev/shared';
import type { Command } from 'commander';
import type { Plugin as EsbuildPlugin } from 'esbuild';
import { build as esbuild } from 'esbuild';
import pc from 'picocolors';
import { z } from 'zod';
import {
  generateDarkIcon,
  generateInactiveIcon,
  namespaceSvgIds,
  validateIconSvg,
  validateInactiveIconColors,
} from '../validate-icon.js';

const DEBOUNCE_MS = 100;

// Monotonically increasing counter used to cache-bust ESM imports in watch mode.
// Each rebuild uses a unique query string (?t=N) so Node.js never returns a cached
// module from a previous build. The cache grows by one entry per rebuild, which is
// acceptable for a dev-only watch loop bounded by developer activity.
let pluginCacheKey = 0;

/** Write config atomically with restrictive permissions via the shared helper. */
const atomicWriteConfig = (configPath: string, content: string): Promise<void> =>
  atomicWrite(configPath, content, 0o600);

const CONFIG_LOCK_RETRY_DELAY_MS = 50;
const CONFIG_LOCK_MAX_RETRIES = 20;
/** Lock directories older than this threshold are considered stale (5 minutes). */
const STALE_LOCK_THRESHOLD_MS = 5 * 60 * 1_000;

/**
 * Acquire an advisory lock for the config file by atomically creating a lock
 * directory. `mkdir` is atomic on POSIX — it fails with EEXIST if the
 * directory already exists, providing safe mutual exclusion without race
 * conditions. Retries with a short delay if the lock is held. If the lock
 * directory is older than STALE_LOCK_THRESHOLD_MS, it is removed automatically
 * (the owning process likely crashed). Returns a release function that removes
 * the lock directory.
 */
const acquireConfigLock = async (configPath: string): Promise<() => void> => {
  const lockDir = `${configPath}.lock`;
  const pidFile = join(lockDir, 'pid.txt');

  // Atomically create the lock directory and write our PID. Returns a release
  // function on success, or null if the directory already exists (EEXIST).
  const tryAcquire = (): (() => void) | null => {
    try {
      mkdirSync(lockDir);
      writeFileSync(pidFile, String(process.pid));
      return () => {
        try {
          rmSync(lockDir, { recursive: true });
        } catch {
          // Lock directory already removed — benign
        }
      };
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
        return null;
      }
      throw err;
    }
  };

  for (let attempt = 0; attempt < CONFIG_LOCK_MAX_RETRIES; attempt++) {
    const release = tryAcquire();
    if (release) return release;

    // Check for stale lock — if the lock directory is older than the threshold
    // AND the holding process is no longer alive, remove it and re-acquire.
    try {
      const lockStat = statSync(lockDir);
      const ageMs = Date.now() - lockStat.mtimeMs;
      if (ageMs > STALE_LOCK_THRESHOLD_MS) {
        // Verify whether the holding process is still alive.
        let holderAlive = false;
        try {
          const pid = parseInt(readFileSync(pidFile, 'utf8'), 10);
          if (!Number.isNaN(pid)) {
            try {
              process.kill(pid, 0);
              holderAlive = true;
            } catch (killErr: unknown) {
              // EPERM means the process exists but we lack permission to signal it.
              if (
                killErr instanceof Error &&
                'code' in killErr &&
                (killErr as NodeJS.ErrnoException).code === 'EPERM'
              ) {
                holderAlive = true;
              }
              // ESRCH means the process is gone — lock is truly stale.
            }
          }
        } catch {
          // pid.txt missing or unreadable — assume stale
        }

        if (!holderAlive) {
          console.warn(
            pc.yellow(
              `Warning: Stale config lock detected (${Math.round(ageMs / 1_000)}s old). Removing and retrying.`,
            ),
          );
          try {
            rmSync(lockDir, { recursive: true });
          } catch {
            // Already removed by a concurrent process — benign
          }
          // Immediately try to re-acquire atomically. This closes the TOCTOU
          // window: without this step, another process that also detected the
          // stale lock could win mkdirSync between our rmSync and the next
          // loop iteration.
          const staleRelease = tryAcquire();
          if (staleRelease) return staleRelease;
          // Another process won the race — fall through to retry delay
        }
      }
    } catch {
      // stat failed — lock was released concurrently; retry immediately
      continue;
    }

    // Lock held by another process — wait before retrying
    await new Promise<void>(r => setTimeout(r, CONFIG_LOCK_RETRY_DELAY_MS));
  }
  throw new Error('Could not acquire config lock — another build may be running');
};

/**
 * Resolve a stored plugin path to its absolute form for comparison.
 * Handles both absolute paths and relative paths (resolved against configDir).
 */
const resolvePluginPathForComparison = (storedPath: string, configDir: string): string => {
  if (isAbsolute(storedPath)) return storedPath;
  if (storedPath.startsWith('~/')) return resolve(homedir(), storedPath.slice(2));
  return resolve(configDir, storedPath);
};

/**
 * Convert an absolute path under HOME to a portable ~/... prefix.
 * Paths not under HOME are returned unchanged.
 */
const toPortablePath = (absolutePath: string): string => {
  const home = homedir();
  if (absolutePath.startsWith(`${home}/`) || absolutePath.startsWith(`${home}\\`)) {
    return `~/${absolutePath.slice(home.length + 1)}`;
  }
  return absolutePath;
};

/**
 * Add the plugin directory to localPlugins in ~/.opentabs/config.json.
 * Uses an absolute path for consistency with the CLI's `localPlugins.add`.
 * Uses advisory file locking to prevent concurrent builds from overwriting
 * each other's registrations.
 * Returns true if newly registered, false if already present.
 */
const registerInConfig = async (projectDir: string): Promise<boolean> => {
  if (process.env.OPENTABS_SKIP_REGISTER === '1') return false;
  const configPath = getConfigPath();
  if (
    !(await access(configPath).then(
      () => true,
      () => false,
    ))
  ) {
    console.warn(pc.yellow('Warning: Config file not found — skipping auto-registration.'));
    console.warn(pc.yellow(`  Run ${pc.cyan('opentabs start')} to create ~/.opentabs/config.json`));
    return false;
  }

  let releaseLock: (() => void) | undefined;
  try {
    releaseLock = await acquireConfigLock(configPath);

    // Re-read config inside the lock to get the latest state
    let config: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(await readFile(configPath, 'utf-8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        console.warn(pc.yellow('Warning: Config file is not a JSON object — skipping auto-registration.'));
        return false;
      }
      config = parsed as Record<string, unknown>;
    } catch {
      console.warn(pc.yellow('Warning: Config file has invalid JSON — skipping auto-registration.'));
      return false;
    }

    if (!Array.isArray(config.localPlugins)) {
      config.localPlugins = [];
    } else {
      config.localPlugins = (config.localPlugins as unknown[]).filter((p): p is string => typeof p === 'string');
    }
    const plugins = config.localPlugins as string[];

    const absolutePath = resolve(projectDir);
    const configDir = dirname(configPath);

    // Check for duplicates by comparing resolved absolute paths
    const alreadyRegistered = plugins.some(
      existing => resolvePluginPathForComparison(existing, configDir) === absolutePath,
    );
    if (alreadyRegistered) return false;

    plugins.push(toPortablePath(absolutePath));
    await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return true;
  } finally {
    if (releaseLock) releaseLock();
  }
};

/**
 * Notify the running MCP server to reload plugins by calling POST /reload.
 * Fails silently — the build succeeds regardless of whether the server is running.
 */
const notifyServer = async (): Promise<void> => {
  if (process.env.OPENTABS_SKIP_NOTIFY === '1') return;

  const authJsonPath = join(getConfigDir(), 'extension', 'auth.json');
  if (
    !(await access(authJsonPath).then(
      () => true,
      () => false,
    ))
  )
    return;

  let secret: string | undefined;
  try {
    const parsed: unknown = JSON.parse(await readFile(authJsonPath, 'utf-8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.secret === 'string') secret = record.secret;
    }
  } catch {
    return;
  }

  if (!secret) return;

  const portEnv = process.env.OPENTABS_PORT;
  let port: number;
  if (portEnv !== undefined) {
    port = Number(portEnv);
  } else {
    let configPort: number | null = null;
    try {
      const raw = readFileSync(getConfigPath(), 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const p = (parsed as Record<string, unknown>).port;
        if (typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535) {
          configPort = p;
        }
      }
    } catch {
      // Config file missing or invalid — use default
    }
    port = configPort ?? DEFAULT_PORT;
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) return;

  try {
    const res = await fetch(`http://${DEFAULT_HOST}:${port}/reload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      console.log(pc.dim('Notified MCP server to reload plugins.'));
    }
  } catch {
    // Server not running — ignore
  }
};

/**
 * Validate the plugin's package.json has the required `opentabs` field.
 * Returns the parsed PluginPackageJson or throws with a descriptive error.
 */
const validatePackageJson = (pkgJson: unknown, projectDir: string): PluginPackageJson => {
  const result = parsePluginPackageJson(pkgJson, projectDir);
  if (!result.ok) {
    throw new Error(result.error);
  }

  // Additional validation: URL patterns
  for (const pattern of result.value.opentabs.urlPatterns) {
    const patternError = validateUrlPattern(pattern);
    if (patternError) throw new Error(patternError);
  }

  // Additional validation: exclude patterns
  for (const pattern of result.value.opentabs.excludePatterns ?? []) {
    const patternError = validateUrlPattern(pattern);
    if (patternError) throw new Error(`Invalid exclude pattern: ${patternError}`);
  }

  return result.value;
};

const validatePlugin = (plugin: OpenTabsPlugin): string[] => {
  const errors: string[] = [];

  // Name
  const nameError = validatePluginName(plugin.name);
  if (nameError) errors.push(nameError);

  // Display name
  if (plugin.displayName.length === 0) errors.push('Plugin displayName is required');

  // Description
  if (plugin.description.length === 0) errors.push('Plugin description is required');

  // URL patterns
  const hasRequiredUrlSetting =
    plugin.configSchema && Object.values(plugin.configSchema).some(s => s.type === 'url' && s.required);
  if (plugin.urlPatterns.length === 0 && !hasRequiredUrlSetting) {
    errors.push('At least one URL pattern is required (or declare a required url-type configSchema field)');
  } else {
    for (const pattern of plugin.urlPatterns) {
      const patternError = validateUrlPattern(pattern);
      if (patternError) errors.push(patternError);
    }
  }

  // Exclude patterns (optional)
  if (plugin.excludePatterns) {
    for (const pattern of plugin.excludePatterns) {
      const patternError = validateUrlPattern(pattern);
      if (patternError) errors.push(`Invalid exclude pattern: ${patternError}`);
    }
  }

  // Homepage (optional)
  if (plugin.homepage !== undefined) {
    try {
      new URL(plugin.homepage);
    } catch {
      errors.push(`Invalid homepage URL: "${plugin.homepage}" is not a valid URL`);
    }
  }

  // Tools
  if (plugin.tools.length === 0) {
    errors.push('At least one tool is required');
  } else {
    const TOOL_NAME_REGEX = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
    const toolNames = new Set<string>();
    for (const tool of plugin.tools) {
      if (tool.name.length === 0) {
        errors.push('Tool name is required');
      } else if (!TOOL_NAME_REGEX.test(tool.name)) {
        errors.push(
          `Tool name "${tool.name}" must be snake_case (lowercase alphanumeric with underscores, e.g., "send_message")`,
        );
      }
      if (tool.displayName !== undefined && tool.displayName.length === 0)
        errors.push(
          `Tool "${tool.name || '(unnamed)'}" has an empty displayName — either omit it for auto-derivation or provide a non-empty value`,
        );
      if (tool.description.length === 0) errors.push(`Tool "${tool.name || '(unnamed)'}" is missing a description`);
      if (tool.icon !== undefined && !LUCIDE_ICON_NAMES.has(tool.icon)) {
        errors.push(
          `Tool "${tool.name || '(unnamed)'}" has invalid icon "${tool.icon}" — must be a valid Lucide icon name (kebab-case). See https://lucide.dev/icons`,
        );
      }
      if (tool.name.length > 0 && toolNames.has(tool.name)) {
        errors.push(`Duplicate tool name "${tool.name}"`);
      }
      if (tool.name.length > 0) toolNames.add(tool.name);
    }
  }

  return errors;
};

const convertToolSchemas = (tool: ToolDefinition) => {
  let inputSchema: Record<string, unknown>;
  try {
    inputSchema = z.toJSONSchema(tool.input) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Tool "${tool.name}" input schema failed to serialize to JSON Schema. ` +
        `Schemas cannot use .transform(), .pipe(), or .preprocess() — these produce runtime-only behavior ` +
        `that cannot be represented in JSON Schema. ${toErrorMessage(err)}`,
    );
  }

  let outputSchema: Record<string, unknown>;
  try {
    outputSchema = z.toJSONSchema(tool.output) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Tool "${tool.name}" output schema failed to serialize to JSON Schema. ` +
        `Schemas cannot use .transform(), .pipe(), or .preprocess() — these produce runtime-only behavior ` +
        `that cannot be represented in JSON Schema. ${toErrorMessage(err)}`,
    );
  }

  delete inputSchema.$schema;
  delete outputSchema.$schema;

  return { inputSchema, outputSchema };
};

/**
 * Minify an SVG string by removing XML comments, collapsing whitespace
 * between tags to a single space, and trimming leading/trailing whitespace.
 */
/**
 * Safely encode a string as a JavaScript string literal for code generation.
 * Uses JSON.stringify (which handles all special characters) and additionally
 * escapes sequences that could break out of script contexts.
 */
const jsStringLiteral = (value: string): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

const minifySvg = (svg: string): string => {
  let result = svg.replace(/<!--[\s\S]*?-->/g, '');
  // Collapse whitespace between tags to a single space
  result = result.replace(/>\s+</g, '> <');
  // Collapse remaining runs of whitespace — loop until stable
  let prev: string;
  do {
    prev = result;
    result = result.replace(/\s{2,}/g, ' ');
  } while (result !== prev);
  return result.trim();
};

/** Result of reading and validating icon files from a plugin directory */
interface IconResult {
  iconSvg?: string;
  iconInactiveSvg?: string;
  iconDarkSvg?: string;
  iconDarkInactiveSvg?: string;
}

/**
 * Read, validate, and optionally auto-generate icon files for a plugin.
 * Throws on validation failure or invalid file combinations.
 * Returns the minified SVG strings if icons are present.
 *
 * Icon file layout:
 *   icon.svg               — required for any icon support
 *   icon-inactive.svg      — optional manual grayscale override (auto-generated if absent)
 *   icon-dark.svg          — optional dark mode variant (auto-generated if absent)
 *   icon-dark-inactive.svg — optional dark mode inactive override (auto-generated if absent)
 */
const readAndValidateIcons = async (projectDir: string, pluginName: string): Promise<IconResult> => {
  const iconPath = join(projectDir, 'icon.svg');
  const inactivePath = join(projectDir, 'icon-inactive.svg');
  const darkPath = join(projectDir, 'icon-dark.svg');
  const darkInactivePath = join(projectDir, 'icon-dark-inactive.svg');

  const fileExists = (p: string) =>
    access(p).then(
      () => true,
      () => false,
    );

  const hasIcon = await fileExists(iconPath);
  const hasInactive = await fileExists(inactivePath);
  const hasDark = await fileExists(darkPath);
  const hasDarkInactive = await fileExists(darkInactivePath);

  // No icons — nothing to do
  if (!hasIcon && !hasInactive && !hasDark && !hasDarkInactive) {
    console.log(pc.dim('Plugin icon: none (using letter avatar)'));
    return {};
  }

  // icon-inactive.svg without icon.svg is an error
  if (!hasIcon && hasInactive) {
    throw new Error(
      'icon-inactive.svg requires icon.svg to also be present. Add an icon.svg or remove icon-inactive.svg.',
    );
  }

  // icon-dark.svg or icon-dark-inactive.svg without icon.svg is an error
  if (!hasIcon && (hasDark || hasDarkInactive)) {
    throw new Error('icon-dark.svg and icon-dark-inactive.svg require icon.svg to also be present.');
  }

  // icon-dark-inactive.svg without icon-dark.svg is an error
  if (!hasDark && hasDarkInactive) {
    throw new Error(
      'icon-dark-inactive.svg requires icon-dark.svg to also be present. Add an icon-dark.svg or remove icon-dark-inactive.svg.',
    );
  }

  // Read and validate icon.svg
  const iconContent = await readFile(iconPath, 'utf-8');
  const iconValidation = validateIconSvg(iconContent, 'icon.svg');
  if (!iconValidation.valid) {
    throw new Error(`icon.svg validation failed:\n${iconValidation.errors.map(e => `  - ${e}`).join('\n')}`);
  }

  const minifiedIcon = minifySvg(iconContent);

  // --- Inactive variant (light mode) ---
  let minifiedInactive: string;
  if (hasInactive) {
    const inactiveContent = await readFile(inactivePath, 'utf-8');
    const inactiveStructValidation = validateIconSvg(inactiveContent, 'icon-inactive.svg');
    if (!inactiveStructValidation.valid) {
      throw new Error(
        `icon-inactive.svg validation failed:\n${inactiveStructValidation.errors.map(e => `  - ${e}`).join('\n')}`,
      );
    }
    const inactiveColorValidation = validateInactiveIconColors(inactiveContent);
    if (!inactiveColorValidation.valid) {
      throw new Error(
        `icon-inactive.svg color validation failed:\n${inactiveColorValidation.errors.map(e => `  - ${e}`).join('\n')}`,
      );
    }
    minifiedInactive = minifySvg(inactiveContent);
  } else {
    minifiedInactive = minifySvg(generateInactiveIcon(iconContent));
  }

  // --- Dark mode active variant ---
  let minifiedDark: string;
  if (hasDark) {
    const darkContent = await readFile(darkPath, 'utf-8');
    const darkValidation = validateIconSvg(darkContent, 'icon-dark.svg');
    if (!darkValidation.valid) {
      throw new Error(`icon-dark.svg validation failed:\n${darkValidation.errors.map(e => `  - ${e}`).join('\n')}`);
    }
    minifiedDark = minifySvg(darkContent);
  } else {
    minifiedDark = minifySvg(generateDarkIcon(iconContent));
  }

  // --- Dark mode inactive variant ---
  let minifiedDarkInactive: string;
  if (hasDarkInactive) {
    const darkInactiveContent = await readFile(darkInactivePath, 'utf-8');
    const darkInactiveStructValidation = validateIconSvg(darkInactiveContent, 'icon-dark-inactive.svg');
    if (!darkInactiveStructValidation.valid) {
      throw new Error(
        `icon-dark-inactive.svg validation failed:\n${darkInactiveStructValidation.errors.map(e => `  - ${e}`).join('\n')}`,
      );
    }
    const darkInactiveColorValidation = validateInactiveIconColors(darkInactiveContent);
    if (!darkInactiveColorValidation.valid) {
      throw new Error(
        `icon-dark-inactive.svg color validation failed:\n${darkInactiveColorValidation.errors.map(e => `  - ${e}`).join('\n')}`,
      );
    }
    minifiedDarkInactive = minifySvg(darkInactiveContent);
  } else {
    // Auto-generate: grayscale the dark variant (whether explicit or auto-generated)
    const darkSource = hasDark ? await readFile(darkPath, 'utf-8') : generateDarkIcon(iconContent);
    minifiedDarkInactive = minifySvg(generateInactiveIcon(darkSource));
  }

  const parts: string[] = [];
  if (hasInactive) parts.push('icon-inactive.svg');
  if (hasDark) parts.push('icon-dark.svg');
  if (hasDarkInactive) parts.push('icon-dark-inactive.svg');
  const autoGenerated: string[] = [];
  if (!hasInactive) autoGenerated.push('inactive');
  if (!hasDark) autoGenerated.push('dark');
  if (!hasDarkInactive) autoGenerated.push('dark-inactive');
  console.log(
    pc.dim(
      `Plugin icon: icon.svg${parts.length > 0 ? ` + ${parts.join(' + ')}` : ''} found` +
        (autoGenerated.length > 0
          ? `, auto-generating ${autoGenerated.join(', ')} variant${autoGenerated.length > 1 ? 's' : ''}`
          : ''),
    ),
  );

  return {
    iconSvg: namespaceSvgIds(minifiedIcon, pluginName),
    iconInactiveSvg: namespaceSvgIds(minifiedInactive, pluginName),
    iconDarkSvg: namespaceSvgIds(minifiedDark, pluginName),
    iconDarkInactiveSvg: namespaceSvgIds(minifiedDarkInactive, pluginName),
  };
};

/** Full manifest shape written to dist/tools.json */
interface PluginManifestOutput {
  sdkVersion: string;
  configSchema?: ConfigSchema;
  iconSvg?: string;
  iconInactiveSvg?: string;
  iconDarkSvg?: string;
  iconDarkInactiveSvg?: string;
  preScriptFile?: string;
  preScriptHash?: string;
  tools: ManifestTool[];
}

/**
 * Derive a display name from a snake_case tool name.
 * 'send_message' → 'Send Message', 'get_user_profile' → 'Get User Profile'
 */
const deriveDisplayName = (name: string): string =>
  name
    .split('_')
    .map(w => {
      const first = w.charAt(0);
      return first ? first.toUpperCase() + w.slice(1) : '';
    })
    .join(' ');

/** Serialize plugin tools to ManifestTool[] */
const generateToolsManifest = (plugin: OpenTabsPlugin): ManifestTool[] =>
  plugin.tools.map(tool => {
    const { inputSchema, outputSchema } = convertToolSchemas(tool);
    return {
      name: tool.name,
      displayName: tool.displayName || deriveDisplayName(tool.name),
      description: tool.description,
      ...(tool.summary ? { summary: tool.summary } : {}),
      icon: tool.icon || 'wrench',
      ...(tool.group ? { group: tool.group } : {}),
      input_schema: inputSchema,
      output_schema: outputSchema,
    };
  });

/**
 * Resolve the installed @opentabs-dev/plugin-sdk version from the plugin's node_modules.
 * Returns the exact semver version string (e.g. '0.0.10'), not a range.
 * Throws with a descriptive error if the SDK is not installed.
 */
const resolveSdkVersion = async (projectDir: string): Promise<string> => {
  const sdkPkgPath = join(projectDir, 'node_modules', '@opentabs-dev', 'plugin-sdk', 'package.json');
  if (
    !(await access(sdkPkgPath).then(
      () => true,
      () => false,
    ))
  ) {
    throw new Error('Could not resolve @opentabs-dev/plugin-sdk version. Ensure the package is installed.');
  }
  let sdkPkg: unknown;
  try {
    sdkPkg = JSON.parse(await readFile(sdkPkgPath, 'utf-8'));
  } catch {
    throw new Error('Could not resolve @opentabs-dev/plugin-sdk version. Ensure the package is installed.');
  }
  if (typeof sdkPkg !== 'object' || sdkPkg === null || !('version' in sdkPkg)) {
    throw new Error('Could not resolve @opentabs-dev/plugin-sdk version. Ensure the package is installed.');
  }
  const version = (sdkPkg as Record<string, unknown>).version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Could not resolve @opentabs-dev/plugin-sdk version. Ensure the package is installed.');
  }
  return version;
};

/** Generate the full manifest (tools) for dist/tools.json */
const generateManifest = (
  plugin: OpenTabsPlugin,
  sdkVersion: string,
  icons?: IconResult,
  preScript?: { file: string; hash: string },
): PluginManifestOutput => ({
  sdkVersion,
  ...(plugin.configSchema && Object.keys(plugin.configSchema).length > 0 ? { configSchema: plugin.configSchema } : {}),
  ...(icons?.iconSvg ? { iconSvg: icons.iconSvg } : {}),
  ...(icons?.iconInactiveSvg ? { iconInactiveSvg: icons.iconInactiveSvg } : {}),
  ...(icons?.iconDarkSvg ? { iconDarkSvg: icons.iconDarkSvg } : {}),
  ...(icons?.iconDarkInactiveSvg ? { iconDarkInactiveSvg: icons.iconDarkInactiveSvg } : {}),
  ...(preScript ? { preScriptFile: preScript.file, preScriptHash: preScript.hash } : {}),
  tools: generateToolsManifest(plugin),
});

/**
 * esbuild plugin that marks `node:*` imports as side-effect-free externals.
 * This allows esbuild to tree-shake unused Node.js builtins from the adapter
 * IIFE bundle. Without `sideEffects: false`, esbuild conservatively keeps
 * `require("node:child_process")` etc. even when none of the imported bindings
 * are used — and those `require()` calls crash in the browser.
 */
const stripNodeBuiltins: EsbuildPlugin = {
  name: 'strip-node-builtins',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^node:/ }, args => ({
      path: args.path,
      external: true,
      sideEffects: false,
    }));
  },
};

const bundleIIFE = async (sourceEntry: string, outDir: string, pluginName: string): Promise<void> => {
  // Create a temporary wrapper entry that imports the plugin and registers it
  // on window.__openTabs.adapters. This is bundled as an IIFE so the adapter
  // is available when executed in MAIN world.
  const wrapperPath = join(outDir, `_adapter_entry_${crypto.randomUUID()}.ts`);
  const relativeImport = `./${relative(outDir, sourceEntry).replace(/\.ts$/, '.js')}`;

  const name = JSON.stringify(pluginName);
  const wrapperCode = `import plugin from ${JSON.stringify(relativeImport)};
import type { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';

// Typed accessor for the globalThis.__openTabs runtime namespace, replacing
// untyped \`(globalThis as any).__openTabs\` casts throughout the wrapper.
interface LogEntry { level: string; message: string; data: unknown[]; ts: string }
interface NavigationInterceptor {
  callbacks: Map<string, () => void>;
  origPushState: typeof history.pushState;
  origReplaceState: typeof history.replaceState;
}
interface OpenTabsRuntime {
  adapters: Record<string, OpenTabsPlugin>;
  _setLogTransport?: (fn: (entry: LogEntry) => void) => () => void;
  _logNonce?: string;
  _readinessNonce?: string;
  _notifyReadinessChanged?: () => void;
  _navigationInterceptor?: NavigationInterceptor;
  /** The currently-executing plugin adapter's name.
   *  Set by each tool-handler wrap before calling user code so
   *  getPreScriptValue() reads the correct per-plugin namespace. */
  _pluginName?: string;
  preScript?: Record<string, Record<string, unknown>>;
}
declare global {
  var __openTabs: OpenTabsRuntime | undefined;
}

// On re-injection, the previous hash-setter may have frozen __openTabs and
// its adapters property (non-writable, non-configurable). Rebuild if needed
// so the adapter can be registered on a mutable container.
if (!globalThis.__openTabs) {
  globalThis.__openTabs = {} as OpenTabsRuntime;
} else {
  const desc = Object.getOwnPropertyDescriptor(globalThis.__openTabs, 'adapters');
  if (desc && !desc.writable) {
    const ot = globalThis.__openTabs;
    const newAdaptersObj: Record<string, OpenTabsPlugin> = {};
    if (ot.adapters) {
      for (const key of Object.keys(ot.adapters)) {
        const d = Object.getOwnPropertyDescriptor(ot.adapters, key);
        if (d) Object.defineProperty(newAdaptersObj, key, d);
      }
    }
    globalThis.__openTabs = Object.assign({}, ot, { adapters: newAdaptersObj });
  }
}
if (!globalThis.__openTabs.adapters) {
  globalThis.__openTabs.adapters = {} as Record<string, OpenTabsPlugin>;
}
const adapters = globalThis.__openTabs.adapters;

// --- Log transport: batch entries and flush via postMessage to the relay ---
// Access _setLogTransport from globalThis (registered by the SDK's log module
// at import time) rather than via a direct import, so the wrapper works even
// when the plugin's installed SDK version predates the log module.
const setLogTransport = globalThis.__openTabs._setLogTransport;

const LOG_FLUSH_INTERVAL = 100;
const LOG_BATCH_MAX = 50;
let logBatch: LogEntry[] = [];
let logFlushTimer: ReturnType<typeof setTimeout> | null = null;

const flushLogs = () => {
  if (logBatch.length === 0) return;
  const entries = logBatch;
  logBatch = [];
  try {
    const nonce = globalThis.__openTabs?._logNonce;
    window.postMessage({ type: 'opentabs:plugin-logs', plugin: ${name}, entries, nonce: nonce ?? '' }, '*');
  } catch {
    // Extension not available — drop silently
  }
};

const logTransport = (entry: LogEntry) => {
  logBatch.push(entry);
  if (logBatch.length >= LOG_BATCH_MAX) {
    if (logFlushTimer !== null) { clearTimeout(logFlushTimer); logFlushTimer = null; }
    flushLogs();
  } else if (logFlushTimer === null) {
    logFlushTimer = setTimeout(() => { logFlushTimer = null; flushLogs(); }, LOG_FLUSH_INTERVAL);
  }
};

const restoreTransport = setLogTransport ? setLogTransport(logTransport) : undefined;

// --- Readiness notification: delegate to the relay via postMessage ---
// The readiness nonce is injected by the ISOLATED world relay (injectReadinessRelay)
// into globalThis.__openTabs._readinessNonce. The closure captures the plugin name
// and reads the nonce at call time so it always uses the current nonce (survives
// re-injection where the nonce is updated).
const ot = globalThis.__openTabs!;
ot._notifyReadinessChanged = () => {
  try {
    const nonce = globalThis.__openTabs?._readinessNonce;
    if (nonce) {
      window.postMessage({ type: 'opentabs:readiness-changed', plugin: ${name}, nonce }, '*');
    }
  } catch {
    // Extension not available — drop silently
  }
};

const existing = adapters[${name}];
if (existing) {
  // teardown() calls onDeactivate() as its first step, so invoking teardown()
  // is sufficient — calling onDeactivate() here too would fire it twice.
  if (typeof existing.teardown === 'function') {
    try { existing.teardown(); } catch (e) { console.warn('[OpenTabs] teardown failed for ' + ${name} + ':', e); }
  }
}
// Remove the old adapter property. If it's non-configurable (locked by
// hashAndFreeze), rebuild the adapters container with all other adapters
// and replace __openTabs on globalThis.
if (!Reflect.deleteProperty(adapters, ${name})) {
  const ot = globalThis.__openTabs!;
  const newAdapters: Record<string, OpenTabsPlugin> = {};
  for (const key of Object.keys(adapters)) {
    if (key !== ${name}) {
      const desc = Object.getOwnPropertyDescriptor(adapters, key);
      if (desc) Object.defineProperty(newAdapters, key, desc);
    }
  }
  globalThis.__openTabs = Object.assign({}, ot, { adapters: newAdapters });
}

// Wrap each tool.handle() to flush log entries after execution and call
// lifecycle hooks (onToolInvocationStart / onToolInvocationEnd) if defined.
// Flushing logs here guarantees entries emitted during a tool call are sent
// via postMessage before the tool result is returned, instead of relying on
// the background LOG_FLUSH_INTERVAL timer which can be delayed under load.
const hasLifecycleHooks = typeof plugin.onToolInvocationStart === 'function' || typeof plugin.onToolInvocationEnd === 'function';
for (const tool of plugin.tools) {
  const origHandle = tool.handle;
  tool.handle = async function(...handleArgs: [unknown, ...unknown[]]) {
    const startTime = performance.now();
    // Pin the current plugin name so getPreScriptValue() in the SDK reads
    // this plugin's bucket, not another adapter's.
    const runtime = globalThis.__openTabs!;
    runtime._pluginName = ${name};
    if (hasLifecycleHooks && typeof plugin.onToolInvocationStart === 'function') {
      try { plugin.onToolInvocationStart(tool.name); } catch (e) { console.warn('[OpenTabs] onToolInvocationStart failed:', e); }
    }
    let success = true;
    try {
      return await origHandle.apply(this, handleArgs);
    } catch (err) {
      success = false;
      throw err;
    } finally {
      if (hasLifecycleHooks) {
        const durationMs = performance.now() - startTime;
        if (typeof plugin.onToolInvocationEnd === 'function') {
          try { plugin.onToolInvocationEnd(tool.name, success, durationMs); } catch (e) { console.warn('[OpenTabs] onToolInvocationEnd failed:', e); }
        }
      }
      if (logFlushTimer !== null) { clearTimeout(logFlushTimer); logFlushTimer = null; }
      flushLogs();
    }
  };
}

// Re-read the adapters reference (may have been rebuilt above)
const currentAdapters = globalThis.__openTabs!.adapters;
currentAdapters[${name}] = plugin;

// Wire onActivate
if (typeof plugin.onActivate === 'function') {
  try { plugin.onActivate(); } catch (e) { console.warn('[OpenTabs] onActivate failed for ' + ${name} + ':', e); }
}

// Wire onNavigate — use a shared interceptor so multiple plugins can coexist.
// A single monkey-patch of history.pushState/replaceState dispatches to all
// registered callbacks. Each plugin registers/unregisters its callback. When
// the last callback is removed, the original methods are restored.
if (typeof plugin.onNavigate === 'function') {
  let lastUrl = location.href;
  const checkUrl = () => {
    const newUrl = location.href;
    if (newUrl !== lastUrl) {
      lastUrl = newUrl;
      try { plugin.onNavigate!(newUrl); } catch (e) { console.warn('[OpenTabs] onNavigate failed:', e); }
    }
  };

  const ot = globalThis.__openTabs!;
  if (!ot._navigationInterceptor) {
    // First plugin to need navigation — install the shared interceptor
    const origPushState = history.pushState.bind(history);
    const origReplaceState = history.replaceState.bind(history);
    const callbacks = new Map<string, () => void>();
    ot._navigationInterceptor = { callbacks, origPushState, origReplaceState };
    history.pushState = function(...args: Parameters<typeof history.pushState>) {
      origPushState(...args);
      for (const cb of callbacks.values()) { cb(); }
    };
    history.replaceState = function(...args: Parameters<typeof history.replaceState>) {
      origReplaceState(...args);
      for (const cb of callbacks.values()) { cb(); }
    };
  }

  const interceptor = ot._navigationInterceptor;
  interceptor.callbacks.set(${name}, checkUrl);

  // popstate/hashchange use addEventListener which safely supports multiple listeners
  window.addEventListener('popstate', checkUrl);
  window.addEventListener('hashchange', checkUrl);

  // Wrap teardown to unregister this plugin's navigation callback
  const origTeardown = typeof plugin.teardown === 'function' ? plugin.teardown.bind(plugin) : undefined;
  const origOnDeactivate = typeof plugin.onDeactivate === 'function' ? plugin.onDeactivate.bind(plugin) : undefined;
  plugin.teardown = function() {
    if (origOnDeactivate) {
      try { origOnDeactivate(); } catch (e) { console.warn('[OpenTabs] onDeactivate failed for ' + ${name} + ':', e); }
    }
    // Unregister this plugin's callback from the shared interceptor
    const nav = globalThis.__openTabs?._navigationInterceptor;
    if (nav) {
      nav.callbacks.delete(${name});
      if (nav.callbacks.size === 0) {
        // Last plugin removed — restore original history methods
        history.pushState = nav.origPushState;
        history.replaceState = nav.origReplaceState;
        delete globalThis.__openTabs!._navigationInterceptor;
      }
    }
    window.removeEventListener('popstate', checkUrl);
    window.removeEventListener('hashchange', checkUrl);
    // Flush remaining logs and tear down log transport
    if (logFlushTimer !== null) { clearTimeout(logFlushTimer); logFlushTimer = null; }
    flushLogs();
    if (restoreTransport) restoreTransport();
    if (origTeardown) origTeardown();
  };
  delete (plugin as Record<string, unknown>).onDeactivate;
} else {
  // No onNavigate — still wrap teardown for onDeactivate ordering and log cleanup
  const origTeardown = typeof plugin.teardown === 'function' ? plugin.teardown.bind(plugin) : undefined;
  const origOnDeactivate = typeof plugin.onDeactivate === 'function' ? plugin.onDeactivate.bind(plugin) : undefined;
  plugin.teardown = function() {
    if (origOnDeactivate) {
      try { origOnDeactivate(); } catch (e) { console.warn('[OpenTabs] onDeactivate failed for ' + ${name} + ':', e); }
    }
    // Flush remaining logs and tear down log transport
    if (logFlushTimer !== null) { clearTimeout(logFlushTimer); logFlushTimer = null; }
    flushLogs();
    if (restoreTransport) restoreTransport();
    if (origTeardown) origTeardown();
  };
  delete (plugin as Record<string, unknown>).onDeactivate;
}
`;
  await writeFile(wrapperPath, wrapperCode, 'utf-8');

  try {
    await esbuild({
      entryPoints: [wrapperPath],
      outfile: join(outDir, ADAPTER_FILENAME),
      format: 'iife',
      platform: 'browser',
      bundle: true,
      minify: false,
      sourcemap: 'linked',
      plugins: [stripNodeBuiltins],
    });
  } finally {
    await unlink(wrapperPath).catch(() => {});
  }
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatTimestamp = (): string => {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

/**
 * Bundle the plugin's pre-script into an IIFE at dist/pre-script.iife.js.
 * The pre-script runs at document_start in MAIN world via
 * chrome.scripting.registerContentScripts, strictly before any page script.
 *
 * The wrapper sets globalThis.__openTabs._preScriptRunner before dynamically
 * importing the user module. definePreScript() inside the user module calls
 * _preScriptRunner synchronously so the callback runs at document_start.
 * _preScriptRunner is cleaned up in the finally block after the import resolves.
 *
 * Returns the SHA-256 hex hash of the generated IIFE content (without the
 * sourceMappingURL comment) so the manifest can carry it for change detection.
 */
const bundlePreScript = async (preScriptEntry: string, outDir: string, pluginName: string): Promise<string> => {
  const setupPath = join(outDir, `_pre_script_setup_${crypto.randomUUID()}.ts`);
  const name = JSON.stringify(pluginName);
  const logPrefix = JSON.stringify(`[opentabs:${pluginName}:pre-script]`);

  // Setup code is injected before the user module via esbuild's inject option.
  // This runs synchronously at document_start — no async imports needed.
  // _preScriptRunner self-destructs after being called once, so definePreScript()
  // can only capture values on the first invocation.
  const setupCode = `declare global {
  var __openTabs: {
    _preScriptRunner?: (fn: (ctx: {
      set(key: string, value: unknown): void;
      log: {
        debug(...args: unknown[]): void;
        info(...args: unknown[]): void;
        warn(...args: unknown[]): void;
        error(...args: unknown[]): void;
      };
    }) => void) => void;
    preScript?: Record<string, Record<string, unknown>>;
  } | undefined;
}

if (!globalThis.__openTabs) {
  (globalThis as Record<string, unknown>).__openTabs = {};
}
const _ot = globalThis.__openTabs!;
if (!_ot.preScript) {
  _ot.preScript = {};
}

// Reset this plugin's pre-script bucket on every load. Each navigation gets
// a clean slate so stale values from the previous page don't leak.
_ot.preScript[${name}] = {};

// Plugin-scoped logger. Pre-script logs go directly to console — the
// extension's ISOLATED-world log relay hasn't loaded yet at document_start.
const _logPrefix = ${logPrefix};
const _log = {
  debug: (...args: unknown[]) => { console.debug(_logPrefix, ...args); },
  info:  (...args: unknown[]) => { console.info(_logPrefix, ...args); },
  warn:  (...args: unknown[]) => { console.warn(_logPrefix, ...args); },
  error: (...args: unknown[]) => { console.error(_logPrefix, ...args); },
};

// Install _preScriptRunner so definePreScript() in the user module can invoke
// the callback synchronously. Self-destructs after first call so it cannot
// be called again after the pre-script has loaded.
_ot._preScriptRunner = (fn) => {
  delete _ot._preScriptRunner;
  const ctx = {
    set(key: string, value: unknown) {
      _ot.preScript![${name}]![key] = value;
    },
    log: _log,
  };
  try {
    fn(ctx as Parameters<typeof fn>[0]);
  } catch (e) {
    console.error(_logPrefix, 'pre-script threw:', e);
  }
};
`;

  await writeFile(setupPath, setupCode, 'utf-8');

  try {
    await esbuild({
      // The user module is the entry point. The setup code is injected before it
      // via esbuild's inject option, which adds an implicit import of setupPath
      // at the top of every bundled file — setup runs first, then the user module.
      entryPoints: [preScriptEntry],
      inject: [setupPath],
      outfile: join(outDir, PRE_SCRIPT_FILENAME),
      format: 'iife',
      platform: 'browser',
      bundle: true,
      minify: false,
      sourcemap: 'linked',
      plugins: [stripNodeBuiltins],
    });
  } finally {
    await unlink(setupPath).catch(() => {});
  }

  const iifeRaw = await readFile(join(outDir, PRE_SCRIPT_FILENAME), 'utf-8');
  const iifeContent = iifeRaw.replace(/\n\/\/# sourceMappingURL=[^\n]+\n?$/, '');
  return createHash('sha256').update(iifeContent).digest('hex');
};

/**
 * Core build pipeline. Throws on errors instead of calling process.exit,
 * so callers can decide how to handle failures (exit in one-shot mode,
 * continue watching in watch mode).
 */
const runBuild = async (projectDir: string): Promise<void> => {
  const startTime = performance.now();

  // Step 1: Read and validate package.json (must have opentabs field)
  const pkgJsonPath = join(projectDir, 'package.json');
  if (
    !(await access(pkgJsonPath).then(
      () => true,
      () => false,
    ))
  ) {
    throw new Error('No valid package.json found in current directory. Run this command from a plugin directory.');
  }
  let pkgJsonRaw: unknown;
  try {
    pkgJsonRaw = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
  } catch {
    throw new Error('No valid package.json found in current directory. Run this command from a plugin directory.');
  }

  console.log(pc.dim('Validating package.json opentabs field...'));
  const pkgJson = validatePackageJson(pkgJsonRaw, projectDir);

  // Step 1b: Read and validate icon files (if present)
  const icons = await readAndValidateIcons(projectDir, pkgJson.name);

  // Determine entry point — look for compiled output in dist/
  const entryPoint = resolve(projectDir, 'dist', 'index.js');
  const sourceEntry = resolve(projectDir, 'src', 'index.ts');

  if (
    !(await access(entryPoint).then(
      () => true,
      () => false,
    ))
  ) {
    const sourceExists = await access(sourceEntry).then(
      () => true,
      () => false,
    );
    if (!sourceExists) {
      throw new Error(
        `Neither compiled output (${entryPoint}) nor source (${sourceEntry}) found. Is this a plugin directory?`,
      );
    }
    console.log(pc.dim('Compiled output not found, running tsc...'));
    // Prepend node_modules/.bin to PATH so the project-local tsc is found
    const binDir = join(projectDir, 'node_modules', '.bin');
    const pathSep = process.platform === 'win32' ? ';' : ':';
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
    const envWithBin = {
      ...process.env,
      [pathKey]: `${binDir}${pathSep}${process.env[pathKey] ?? ''}`,
    };
    const tscResult = spawnSync('tsc', [], {
      cwd: projectDir,
      env: envWithBin,
      shell: true,
    });
    if (tscResult.error) {
      if ((tscResult.error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('tsc not found — run npm install to install TypeScript');
      }
      throw tscResult.error;
    }
    if ((tscResult.status ?? 1) !== 0) {
      const stderr = tscResult.stderr.toString().trim();
      const stdout = tscResult.stdout.toString().trim();
      throw new Error(`tsc failed:\n${stderr || stdout || 'Unknown error'}`);
    }
    if (
      !(await access(entryPoint).then(
        () => true,
        () => false,
      ))
    ) {
      throw new Error(`tsc succeeded but ${entryPoint} was not created. Check your tsconfig.json outDir setting.`);
    }
  }

  // Step 2: Dynamically import the plugin module (cache-bust for watch mode rebuilds)
  // Increment the counter before each import to guarantee a unique query string (?t=N)
  // that Node.js has never seen before, ensuring it reads the rebuilt file from disk.
  // pathToFileURL converts the absolute path to a file:// URL, which is required on
  // Windows where bare paths like C:\... are not valid ESM specifiers.
  pluginCacheKey++;
  console.log(pc.dim('Loading plugin module...'));
  const entryUrl = `${pathToFileURL(entryPoint).href}?t=${String(pluginCacheKey)}`;
  const mod = (await import(entryUrl)) as {
    default?: OpenTabsPlugin;
  };
  const defaultExport = mod.default;
  if (!defaultExport) {
    throw new Error('Plugin module must export a default instance of OpenTabsPlugin.');
  }
  const plugin = defaultExport;

  // Step 3: Validate
  console.log(pc.dim('Validating plugin...'));
  const errors = validatePlugin(plugin);
  if (errors.length > 0) {
    throw new Error(`Validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  // Hint: warn if isReady() unconditionally returns false (default scaffold value)
  try {
    const ready = await plugin.isReady();
    if (!ready) {
      console.warn(
        pc.yellow(
          'Warning: isReady() returned false — the plugin will report as "unavailable" in the browser. Update isReady() with a real authentication check (e.g., check for session cookies, a DOM element, or a page global).',
        ),
      );
    }
  } catch {
    // isReady() may throw if it depends on a browser environment — skip the check
  }

  // Step 4: Bundle IIFE (before manifest, so adapterHash can be included)
  console.log(pc.dim('Bundling adapter IIFE...'));
  const distDir = join(projectDir, 'dist');
  mkdirSync(distDir, { recursive: true });

  // Derive the canonical adapter key from the npm package name — this must
  // match what the MCP server derives via pluginNameFromPackage() so the
  // extension can look up the right adapter in globalThis.__openTabs.adapters.
  const derivedName = pluginNameFromPackage(pkgJson.name);
  if (plugin.name !== derivedName) {
    console.warn(
      pc.yellow(
        `Warning: plugin class name "${plugin.name}" does not match the name derived from package.json ("${derivedName}"). The adapter will be registered as "${derivedName}". Update the plugin class name to avoid confusion.`,
      ),
    );
  }

  await bundleIIFE(sourceEntry, distDir, derivedName);
  // Read the bundled IIFE. esbuild appends a //# sourceMappingURL= comment at
  // the end when sourcemap:'linked' is used. Strip it so we can move it to the
  // very end of the file (after hashAndFreeze), keeping the source map reference
  // valid and the source map's line mappings correct for the IIFE code.
  const iifePath = join(distDir, ADAPTER_FILENAME);
  const iifeRaw = await readFile(iifePath, 'utf-8');
  const sourceMappingUrlMatch = /\n\/\/# sourceMappingURL=[^\n]+\n?$/.exec(iifeRaw);
  const sourceMappingUrlSuffix = sourceMappingUrlMatch ? sourceMappingUrlMatch[0] : '';
  const iifeContent = sourceMappingUrlSuffix ? iifeRaw.slice(0, -sourceMappingUrlSuffix.length) : iifeRaw;
  // Hash only the core IIFE content (without the source map reference comment).
  const adapterHash = createHash('sha256').update(iifeContent).digest('hex');

  // Append a self-contained snippet that sets the adapter hash and then freezes
  // the adapter entry to prevent cross-adapter tampering. The freeze must happen
  // AFTER the hash is set (since frozen objects reject new properties). The
  // property descriptor uses writable:false + configurable:false so that:
  //   - Simple assignment by page scripts fails (non-writable)
  //   - Object.defineProperty by page scripts fails (non-configurable)
  //   - Reflect.deleteProperty by page scripts fails (non-configurable)
  // Re-injection and cleanup are handled by the IIFE wrapper and the
  // extension's cleanup script, which rebuild the adapters container on
  // globalThis when deletion of a non-configurable property fails.
  // The snippet is kept on the same line as the IIFE's closing `})();` (no
  // leading/trailing newlines) so it does not shift line numbers in the .map
  // file. The sourceMappingURL comment is placed last so source map tooling
  // finds it at the end of the file, as required by the source map spec.
  // The '__adapterHash' property name must match ADAPTER_HASH_PROP in
  // platform/browser-extension/src/constants.ts.
  const safeName = jsStringLiteral(derivedName);
  const safeHash = jsStringLiteral(adapterHash);
  const hashAndFreeze = `(function(){var o=(globalThis).__openTabs;if(o&&o.adapters&&o.adapters[${safeName}]){var a=o.adapters[${safeName}];a.__adapterHash=${safeHash};if(a.tools&&Array.isArray(a.tools)){for(var i=0;i<a.tools.length;i++){Object.freeze(a.tools[i]);}Object.freeze(a.tools);}Object.freeze(a);Object.defineProperty(o.adapters,${safeName},{value:a,writable:false,configurable:false,enumerable:true});Object.defineProperty(o,"adapters",{value:o.adapters,writable:false,configurable:false});}})();`;
  await writeFile(iifePath, iifeContent + hashAndFreeze + sourceMappingUrlSuffix, 'utf-8');
  const iifeSize = (await stat(iifePath)).size;
  console.log(`  Written: ${pc.bold(`dist/${ADAPTER_FILENAME}`)} (${formatBytes(iifeSize)})`);

  const sourceMapPath = join(distDir, ADAPTER_SOURCE_MAP_FILENAME);
  if (
    await access(sourceMapPath).then(
      () => true,
      () => false,
    )
  ) {
    const sourceMapSize = (await stat(sourceMapPath)).size;
    console.log(`  Written: ${pc.bold(`dist/${ADAPTER_SOURCE_MAP_FILENAME}`)} (${formatBytes(sourceMapSize)})`);
  } else {
    console.log(pc.dim('  Source map not generated'));
  }

  // Step 5: Resolve installed SDK version
  console.log(pc.dim('Resolving SDK version...'));
  const sdkVersion = await resolveSdkVersion(projectDir);

  // Step 5b: Bundle pre-script IIFE (when plugin declares opentabs.preScript)
  let preScriptInfo: { file: string; hash: string } | undefined;
  if (pkgJson.opentabs.preScript) {
    const preScriptSourcePath = resolve(projectDir, pkgJson.opentabs.preScript);
    const sourceExists = await access(preScriptSourcePath).then(
      () => true,
      () => false,
    );
    if (!sourceExists) {
      throw new Error(
        `Declared preScript source not found: ${preScriptSourcePath}. Check the "opentabs.preScript" field in package.json.`,
      );
    }
    console.log(pc.dim('Bundling pre-script IIFE...'));
    const preScriptHash = await bundlePreScript(preScriptSourcePath, distDir, derivedName);
    preScriptInfo = { file: PRE_SCRIPT_FILENAME, hash: preScriptHash };
    const preScriptFileSize = (await stat(join(distDir, PRE_SCRIPT_FILENAME))).size;
    console.log(`  Written: ${pc.bold(`dist/${PRE_SCRIPT_FILENAME}`)} (${formatBytes(preScriptFileSize)})`);
  }

  // Step 6: Generate dist/tools.json (tool schemas + icons)
  console.log(pc.dim(`Generating ${TOOLS_FILENAME}...`));
  const manifest = generateManifest(plugin, sdkVersion, icons, preScriptInfo);
  const toolsJsonPath = join(distDir, TOOLS_FILENAME);
  await writeFile(toolsJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  const toolCount = manifest.tools.length;
  const parts = [`${toolCount} tool${toolCount === 1 ? '' : 's'}`];
  console.log(`  Written: ${pc.bold(`dist/${TOOLS_FILENAME}`)} (${parts.join(', ')})`);

  // Step 7: Embed marketplace icons in package.json opentabs field
  if (icons?.iconSvg) {
    const rawPkg = JSON.parse(await readFile(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
    const opentabs = rawPkg.opentabs as Record<string, unknown>;
    opentabs.iconSvg = icons.iconSvg;
    opentabs.iconDarkSvg = icons.iconDarkSvg ?? icons.iconSvg;
    await writeFile(pkgJsonPath, `${JSON.stringify(rawPkg, null, 2)}\n`, 'utf-8');
    console.log(`  Embedded marketplace icons in ${pc.bold('package.json')}`);
  }

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log('');
  const summary = `Built ${pkgJson.name} v${pkgJson.version} — ${parts.join(', ')} (${elapsed}s)`;
  console.log(pc.green(summary));
};

const handleBuild = async (options: { watch?: boolean }): Promise<void> => {
  const projectDir = process.cwd();

  // Initial build — always runs
  try {
    await runBuild(projectDir);
  } catch (err: unknown) {
    console.error(pc.red(`Error: ${toErrorMessage(err)}`));
    process.exit(1);
  }

  // Auto-register in config (first build only) and notify server
  try {
    const registered = await registerInConfig(projectDir);
    if (registered) {
      console.log(pc.green('Registered in ~/.opentabs/config.json'));
    }
  } catch (err: unknown) {
    console.warn(pc.yellow(`Warning: Could not auto-register plugin: ${toErrorMessage(err)}`));
  }
  try {
    await notifyServer();
  } catch {
    // Notification failures are non-fatal
  }

  if (!options.watch) return;

  // Watch mode: watch dist/ for changes to .js files and rebuild
  const distDir = join(projectDir, 'dist');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let building = false;
  let pendingRebuild = false;

  const rebuild = async () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (building) {
      pendingRebuild = true;
      return;
    }
    building = true;
    console.log('');
    console.log(pc.dim(`[${formatTimestamp()}] Change detected, rebuilding...`));
    try {
      await runBuild(projectDir);
      // Notify server after each successful rebuild in watch mode
      try {
        await notifyServer();
      } catch {
        // Notification failures are non-fatal
      }
    } catch (err: unknown) {
      console.error(pc.red(`[${formatTimestamp()}] Rebuild failed: ${toErrorMessage(err)}`));
    } finally {
      building = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        void rebuild();
      }
    }
  };

  let watcher: FSWatcher;
  try {
    watcher = watch(distDir, { recursive: true }, (_event, filename) => {
      // Only react to .js file changes (tsc output), skip adapter.iife.js
      // and temporary wrapper files to avoid rebuild loops
      if (
        !filename?.endsWith('.js') ||
        filename === ADAPTER_FILENAME ||
        filename === PRE_SCRIPT_FILENAME ||
        filename.startsWith('_adapter_entry_') ||
        filename.startsWith('_pre_script_setup_')
      )
        return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void rebuild(), DEBOUNCE_MS);
    });
  } catch {
    console.error(pc.red(`Error: Could not watch ${distDir}. Ensure the dist/ directory exists.`));
    process.exit(1);
  }

  watcher.on('error', err => {
    console.error(pc.red(`Watch error: ${toErrorMessage(err)}`));
    console.error(pc.yellow('Watcher stopped. Restart with: opentabs-plugin build --watch'));
    process.exit(1);
  });

  console.log('');
  console.log(pc.cyan(`Watching ${pc.bold('dist/')} for changes... (Ctrl+C to stop)`));

  const cleanup = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
    console.log('');
    console.log(pc.dim('Watcher stopped.'));
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  if (process.platform !== 'win32') {
    process.on('SIGTERM', cleanup);
  }

  // Keep the process alive
  await new Promise<never>(() => {});
};

const registerBuildCommand = (program: Command): void => {
  program
    .command('build')
    .description('Build the current plugin directory (dist/tools.json + adapter IIFE)')
    .option('-w, --watch', 'Watch dist/ for changes and rebuild automatically')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs-plugin build
  $ opentabs-plugin build --watch`,
    )
    .action((options: { watch?: boolean }) => handleBuild(options));
};

export {
  convertToolSchemas,
  deriveDisplayName,
  formatBytes,
  formatTimestamp,
  generateManifest,
  generateToolsManifest,
  minifySvg,
  notifyServer,
  readAndValidateIcons,
  registerBuildCommand,
  registerInConfig,
  resolvePluginPathForComparison,
  resolveSdkVersion,
  toPortablePath,
  validatePackageJson,
  validatePlugin,
};
