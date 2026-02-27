/**
 * Generates src/lucide-icon-names.ts from the installed lucide-react package.
 *
 * Run with: npm run generate:icons
 *
 * The generated file contains:
 * - LucideIconName: a union type of all kebab-case icon names (for plugin author autocomplete)
 * - LUCIDE_ICON_NAMES: a runtime Set for build-time validation in the CLI
 */

import { iconNames } from 'lucide-react/dynamic';
import { version } from 'lucide-react/package.json';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sorted = [...iconNames].sort();

const typeLines = sorted.map(n => `  | '${n}'`);
const setLines = sorted.map(n => `  '${n}',`);

const content = `/**
 * Union type of all Lucide icon names (kebab-case).
 *
 * Auto-generated from lucide-react v${version} (${sorted.length} icons).
 * Regenerate with: npm run generate:icons
 */
export type LucideIconName =
${typeLines.join('\n')};

/** Runtime set of all valid Lucide icon names for build-time validation */
export const LUCIDE_ICON_NAMES: ReadonlySet<string> = new Set([
${setLines.join('\n')}
]);
`;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outPath = join(scriptDir, '..', 'src', 'lucide-icon-names.ts');
await writeFile(outPath, content);

console.log(`Generated ${outPath} (${sorted.length} icons, ${content.length} bytes)`);
