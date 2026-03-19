/**
 * Cross-platform utilities for the OpenTabs platform.
 *
 * Provides portable abstractions for file operations, process spawning,
 * and platform detection that work correctly on macOS, Linux, and Windows.
 */

import { chmod, rename, unlink, writeFile } from 'node:fs/promises';
import { toErrorMessage } from './error.js';

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/** Returns true when running on Windows (process.platform === 'win32'). */
export const isWindows = (): boolean => process.platform === 'win32';

// ---------------------------------------------------------------------------
// Command resolution for cross-platform process spawning
// ---------------------------------------------------------------------------

/**
 * Resolves a bare command name for the current platform.
 *
 * On Windows, npm is distributed as `npm.cmd` (a cmd wrapper). Process
 * spawning requires the full name on Windows because it does not search
 * PATHEXT the way cmd.exe does.
 *
 * On Unix, the command name is returned unchanged.
 */
export const platformExec = (cmd: string): string => {
  if (!isWindows()) return cmd;
  switch (cmd) {
    case 'npm':
    case 'npx':
    case 'node':
      return `${cmd}.cmd`;
    default:
      return cmd;
  }
};

// ---------------------------------------------------------------------------
// Environment sanitization
// ---------------------------------------------------------------------------

/**
 * Strip undefined values from an environment object.
 *
 * `process.env` values are `string | undefined`. On Windows, libuv rejects
 * `undefined` values in the `env` option passed to `spawn` / `fork` with
 * `EINVAL`. This helper produces a clean `Record<string, string>` safe for
 * all platforms.
 */
export const sanitizeEnv = (env: Record<string, string | undefined>): Record<string, string> => {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) clean[key] = value;
  }
  return clean;
};

// ---------------------------------------------------------------------------
// Atomic file writes
// ---------------------------------------------------------------------------

/**
 * Write a file atomically: write to a temporary file in the same directory,
 * optionally set restrictive permissions, then rename over the target.
 *
 * On POSIX, `rename(2)` is atomic — readers never see a partially-written file.
 * On Windows (NTFS), `rename` fails when the target already exists. The
 * fallback deletes the target first, then renames. This creates a brief window
 * where the file does not exist; callers that read this file should retry on
 * ENOENT.
 *
 * @param filePath  — absolute path to the destination file
 * @param content   — file content to write
 * @param mode      — optional POSIX permission mode (e.g., 0o600). Silently
 *                    skipped on Windows with a debug-level warning.
 */
export const atomicWrite = async (filePath: string, content: string, mode?: number): Promise<void> => {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tmpPath, content, 'utf-8');

    if (mode !== undefined) {
      await safeChmod(tmpPath, mode);
    }

    if (isWindows()) {
      // NTFS rename does not atomically replace an existing file. Remove the
      // target first, then rename. The unlink may fail with ENOENT if the
      // target does not exist yet — that is fine.
      await unlink(filePath).catch(() => {});
    }

    await rename(tmpPath, filePath);
  } catch (err) {
    // Clean up the temporary file on any failure.
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/**
 * Set file permissions, silently succeeding on Windows where POSIX chmod
 * is not supported. Logs a warning if chmod fails on a platform that
 * supports it (i.e., on POSIX systems).
 */
export const safeChmod = async (filePath: string, mode: number): Promise<void> => {
  if (isWindows()) {
    // Windows does not support POSIX file permissions.
    return;
  }

  await chmod(filePath, mode).catch((err: unknown) => {
    console.warn(
      `Warning: Could not set file permissions on ${filePath}: ${toErrorMessage(err)}. The file may be readable by other users.`,
    );
  });
};
