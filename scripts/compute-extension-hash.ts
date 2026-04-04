/**
 * Compute a SHA-256 content hash of the extension's key runtime files
 * and embed it in two places:
 *
 *   1. `platform/browser-extension/.extension-hash` — plain text file
 *      read by the MCP server so it can relay the hash to the side panel.
 *   2. `window.__EXTENSION_HASH__` assignment prepended to the side panel
 *      bundle — read by the side panel at runtime (stays frozen in memory
 *      even after the on-disk bundle changes).
 *
 * Runs after the extension bundles are built but before install-extension.ts
 * copies them to the managed install directory.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const extDir = join(import.meta.dirname, '..', 'platform', 'browser-extension');
const sidePanelPath = join(extDir, 'dist', 'side-panel', 'side-panel.js');

// Strip any previous hash assignment from side-panel.js before hashing
// so that the hash is computed from the original bundle content only.
const hashPrefix = /^window\.__EXTENSION_HASH__="[0-9a-f]+";\n/;
const sidePanelJs = readFileSync(sidePanelPath, 'utf-8').replace(hashPrefix, '');

const filesToHash = ['dist/background.js', 'dist/side-panel/styles.css', 'dist/offscreen/index.js'];

const hash = createHash('sha256');
for (const file of filesToHash) {
  hash.update(readFileSync(join(extDir, file)));
}
hash.update(sidePanelJs);
const extensionHash = hash.digest('hex').slice(0, 16);

// Write hash file for the MCP server to read
writeFileSync(join(extDir, '.extension-hash'), `${extensionHash}\n`);

// Prepend hash assignment to side panel bundle
writeFileSync(sidePanelPath, `window.__EXTENSION_HASH__="${extensionHash}";\n${sidePanelJs}`);

console.log(`  Extension hash: ${extensionHash}`);
