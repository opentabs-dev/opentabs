/**
 * Generate PNG icons from icon.svg at all sizes required by the Chrome
 * extension manifest (16, 32, 48, 128). Uses resvg for high-quality
 * rasterization — the SVG is rendered at each target size directly
 * (no downscaling from a single large render), producing the sharpest
 * result at every resolution.
 *
 * Usage: tsx scripts/generate-icons.ts
 *
 * Output: platform/browser-extension/icons/icon-{size}.png
 */

import { Resvg } from '@resvg/resvg-js';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SIZES = [16, 32, 48, 128] as const;

const repoRoot = join(import.meta.dirname, '..');
const svgPath = join(repoRoot, 'assets', 'icon.svg');
const outDir = join(repoRoot, 'platform', 'browser-extension', 'icons');

const svg = await readFile(svgPath, 'utf-8');

mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  const rendered = resvg.render();
  const png = rendered.asPng();

  const outPath = join(outDir, `icon-${size}.png`);
  await writeFile(outPath, png);
  console.log(`  Generated: icons/icon-${size}.png (${size}x${size})`);
}

const svgDest = join(outDir, 'icon.svg');
await writeFile(svgDest, svg);
console.log(`  Copied:    icons/icon.svg`);

console.log(`\nAll icons written to ${outDir}`);
