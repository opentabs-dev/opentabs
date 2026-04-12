/**
 * Browser extension installation logic.
 *
 * The installExtension() function is called by `opentabs start` for
 * auto-initialization on first run.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_COPY_EXCLUDE_PATTERN } from '@opentabs-dev/shared';
import { getCliVersion } from '../version-info.js';

const resolveExtensionDir = (): string => {
  try {
    return dirname(fileURLToPath(import.meta.resolve('@opentabs-dev/browser-extension/package.json')));
  } catch {
    const cliDir = dirname(fileURLToPath(import.meta.url));
    return resolve(cliDir, '..', '..', '..', 'browser-extension');
  }
};

interface InstallExtensionResult {
  /** Whether the extension was installed or updated (false = already up-to-date) */
  installed: boolean;
  /** Whether this was the first installation (no prior extension directory) */
  firstTime: boolean;
  /** The destination directory */
  extensionDest: string;
  /** The installed version */
  version: string;
}

/**
 * Install or update the browser extension to ~/.opentabs/extension/.
 *
 * Skips installation if the extension is already installed at the current version.
 * The configDir parameter specifies the base directory (defaults to ~/.opentabs).
 */
const installExtension = async (configDir: string): Promise<InstallExtensionResult> => {
  const extensionSrc = resolveExtensionDir();

  // Verify the extension source exists
  if (
    !(await access(join(extensionSrc, 'manifest.json')).then(
      () => true,
      () => false,
    ))
  ) {
    throw new Error(
      `Browser extension not found at ${extensionSrc}. Try reinstalling: npm install -g @opentabs-dev/cli`,
    );
  }

  const version = await getCliVersion();
  const extensionDest = join(configDir, 'extension');
  const versionMarkerPath = join(extensionDest, '.opentabs-version');
  const firstTime = !existsSync(join(extensionDest, 'manifest.json'));

  // Check if already up-to-date
  if (!firstTime) {
    if (
      await access(versionMarkerPath).then(
        () => true,
        () => false,
      )
    ) {
      const installedVersion = (await readFile(versionMarkerPath, 'utf-8')).trim();
      if (installedVersion === version) {
        return { installed: false, firstTime: false, extensionDest, version };
      }
    }
  }

  // Copy extension directory, skipping node_modules, src, .git, tsconfig*,
  // and preserving the adapters/ directory (written at runtime by the MCP server).
  cpSync(extensionSrc, extensionDest, {
    recursive: true,
    force: true,
    filter: (source: string) => {
      const rel = relative(extensionSrc, source);
      if (rel === '') return true;
      if (EXTENSION_COPY_EXCLUDE_PATTERN.test(rel)) return false;
      if (rel === 'adapters' || rel.startsWith('adapters/') || rel.startsWith('adapters\\')) return false;
      return true;
    },
  });

  // Create adapters directory for plugins
  mkdirSync(join(extensionDest, 'adapters'), { recursive: true, mode: 0o700 });

  // Write version marker
  await writeFile(versionMarkerPath, version, { encoding: 'utf-8', mode: 0o600 });

  // Verify installation
  if (!existsSync(join(extensionDest, 'manifest.json'))) {
    throw new Error('Installation verification failed — manifest.json missing from destination.');
  }

  return { installed: true, firstTime, extensionDest, version };
};

export type { InstallExtensionResult };
export { installExtension };
