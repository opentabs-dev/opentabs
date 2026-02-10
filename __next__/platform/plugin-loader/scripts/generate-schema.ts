/**
 * Generates a JSON Schema from the plugin manifest Zod schema
 * and writes it to platform/schemas/plugin-v1.json.
 *
 * Run: bun run platform/plugin-loader/scripts/generate-schema.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { pluginManifestSchema } from '../src/manifest-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(__dirname, '../../schemas/plugin-v1.json');

const jsonSchema = z.toJSONSchema(pluginManifestSchema, {
  unrepresentable: 'any',
});

/* Add $id and title for IDE autocompletion */
const schema = {
  ...jsonSchema,
  $id: 'https://opentabs.dev/schemas/plugin-v1.json',
  title: 'OpenTabs Plugin Manifest',
  description: 'Schema for opentabs-plugin.json — the plugin manifest file for OpenTabs plugins.',
};

writeFileSync(outputPath, JSON.stringify(schema, null, 2) + '\n', 'utf-8');

console.log(`JSON Schema written to ${outputPath}`);
