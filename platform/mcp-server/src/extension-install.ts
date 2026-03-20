/**
 * Managed extension auto-install.
 *
 * On every MCP server startup (and hot reload), checks whether the browser
 * extension in ~/.opentabs/extension/ is up to date with the server's package
 * version. If the version file is missing or stale, copies the extension from
 * the platform/browser-extension/ source directory, writes a version marker,
 * and creates the adapters/ directory for plugin IIFEs.
 *
 * The copy excludes build/development artifacts (node_modules, src, .git,
 * tsconfig*) — only the files needed to load an unpacked extension in Chrome.
 */

import { cpSync, mkdirSync } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_COPY_EXCLUDE_PATTERN } from '@opentabs-dev/shared';
import { getAdaptersDir, getExtensionDir, getExtensionVersionFile } from './config.js';
import { log } from './logger.js';
import { version } from './version.js';

/**
 * Resolve the browser-extension source directory relative to this module's
 * compiled location. The MCP server compiles to dist/extension-install.js,
 * so browser-extension is at ../../browser-extension from that file.
 */
const getExtensionSourceDir = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'browser-extension');

/**
 * Ensure the managed extension in ~/.opentabs/extension/ matches the current
 * server version. Copies the extension source if the version is missing or
 * outdated, creating the directory structure as needed.
 *
 * Safe to call on every reload — skips the copy when versions match.
 */
interface ExtensionInstallResult {
  /** Whether the extension files were updated (version mismatch detected and files copied) */
  versionChanged: boolean;
}

const ensureExtensionInstalled = async (): Promise<ExtensionInstallResult> => {
  const extensionDir = getExtensionDir();
  const versionFile = getExtensionVersionFile();
  const adaptersDir = getAdaptersDir();

  // Read installed version (missing file → empty string → mismatch)
  let installedVersion = '';
  try {
    if (
      await access(versionFile).then(
        () => true,
        () => false,
      )
    ) {
      installedVersion = (await readFile(versionFile, 'utf-8')).trim();
    }
  } catch {
    // File unreadable — treat as missing
  }

  if (installedVersion === version) {
    log.debug(`Managed extension is up to date (v${version})`);
    return { versionChanged: false };
  }

  // Version mismatch or missing — perform the copy
  const extensionSrc = getExtensionSourceDir();

  // Verify the source exists before attempting the copy
  if (
    !(await access(join(extensionSrc, 'manifest.json')).then(
      () => true,
      () => false,
    ))
  ) {
    log.warn(`Browser extension source not found at ${extensionSrc}, skipping auto-install`);
    return { versionChanged: false };
  }

  log.info(
    installedVersion
      ? `Updating managed extension: v${installedVersion} → v${version}`
      : `Installing managed extension v${version}`,
  );

  try {
    cpSync(extensionSrc, extensionDir, {
      recursive: true,
      force: true,
      filter: (source: string) => {
        const rel = relative(extensionSrc, source);
        if (rel === '') return true;
        if (EXTENSION_COPY_EXCLUDE_PATTERN.test(rel)) return false;
        // Preserve the adapters/ directory — plugin adapter IIFEs are written
        // there at runtime by the MCP server and must not be overwritten.
        if (rel === 'adapters' || rel.startsWith('adapters/') || rel.startsWith('adapters\\')) return false;
        return true;
      },
    });

    mkdirSync(adaptersDir, { recursive: true });
    await writeFile(versionFile, version, 'utf-8');

    log.info(`Managed extension installed to ${extensionDir}`);
    return { versionChanged: true };
  } catch (err) {
    log.warn('Failed to install managed extension:', err);
    return { versionChanged: false };
  }
};

export type { ExtensionInstallResult };
export { ensureExtensionInstalled };
