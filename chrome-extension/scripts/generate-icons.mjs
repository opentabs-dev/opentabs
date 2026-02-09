#!/usr/bin/env node

/**
 * Generate PNG icons from SVG source
 *
 * Usage: node scripts/generate-icons.mjs
 *
 * Requires: sharp (installed as devDependency)
 */

import sharp from 'sharp';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '../public/icons');
const SIZES = [16, 32, 48, 128];

const generateIcons = async () => {
  const svgPath = join(ICONS_DIR, 'icon.svg');
  const svgBuffer = readFileSync(svgPath);

  console.log('Generating icons from:', svgPath);

  for (const size of SIZES) {
    const outputPath = join(ICONS_DIR, `icon-${size}.png`);

    await sharp(svgBuffer, { density: 2300 }) // High density for better quality
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({
        compressionLevel: 9,
        quality: 100,
      })
      .toFile(outputPath);

    console.log(`  ✓ icon-${size}.png`);
  }

  console.log('\nDone! Generated', SIZES.length, 'icons.');
};

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
