/**
 * Extension Build Script
 *
 * Discovers installed plugins via @opentabs/plugin-loader, then:
 * 1. Generates a background entry point that calls initialize() with plugin data
 * 2. Bundles the background script (ESM → single file)
 * 3. Bundles each plugin's adapter as an IIFE for MAIN world injection
 * 4. Bundles the content stub as an IIFE for ISOLATED world
 * 5. Bundles the offscreen document
 * 6. Generates manifest.json from the dynamic plugin registry
 * 7. Copies static assets (icons, _locales, offscreen.html)
 *
 * Usage: bun run platform/browser-extension/build.ts
 */

import { resolve, dirname, basename } from 'node:path';
import { mkdirSync, writeFileSync, cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { loadPlugins } from '@opentabs/plugin-loader';
import type { LoadPluginsResult } from '@opentabs/plugin-loader';
import type { ServiceDefinition } from '@opentabs/core';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT_DIR = resolve(import.meta.dirname, '..', '..');
const EXTENSION_PKG_DIR = resolve(import.meta.dirname);
const EXTENSION_SRC_DIR = resolve(EXTENSION_PKG_DIR, 'src');
const OUT_DIR = resolve(ROOT_DIR, 'dist');
const GENERATED_DIR = resolve(EXTENSION_PKG_DIR, '__generated__');

// Original extension's public assets (icons, _locales)
const ORIGINAL_PUBLIC_DIR = resolve(ROOT_DIR, '..', 'chrome-extension', 'public');

// Content stub source
const CONTENT_STUB_SRC = resolve(EXTENSION_SRC_DIR, 'content-stub', 'index.ts');

// ---------------------------------------------------------------------------
// Step 0: Clean and prepare output directories
// ---------------------------------------------------------------------------

console.log('[Build] Starting extension build...');

if (existsSync(OUT_DIR)) {
  rmSync(OUT_DIR, { recursive: true });
}
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(resolve(OUT_DIR, 'adapters'), { recursive: true });
mkdirSync(resolve(OUT_DIR, 'content'), { recursive: true });
mkdirSync(GENERATED_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Step 1: Discover plugins and generate background entry point
// ---------------------------------------------------------------------------

console.log('[Build] Discovering plugins...');

const result: LoadPluginsResult = await loadPlugins([], [], {
  rootDir: EXTENSION_PKG_DIR,
  skipRegistryMerge: true,
});

console.log(`[Build] Found ${result.plugins.length} plugin(s): ${result.plugins.map(p => p.manifest.name).join(', ')}`);
if (result.failures.length > 0) {
  console.warn(`[Build] ${result.failures.length} plugin(s) failed:`, result.failures);
}

// ---------------------------------------------------------------------------
// Step 2: Generate the background entry point module
//
// This module imports initialize() from the background and calls it with
// the static ServiceDefinition[] and WebappServiceConfig data. For plugins
// that export isHealthy, we import it from the plugin's ./health-check
// export path to avoid pulling in heavy MCP server dependencies.
// ---------------------------------------------------------------------------

console.log('[Build] Generating background entry point...');

/**
 * Serialize a ServiceDefinition to a JS object literal string.
 * All fields are JSON-serializable data.
 */
const serializeServiceDefinition = (def: ServiceDefinition): string => {
  const lines = [
    `    type: ${JSON.stringify(def.type)},`,
    `    displayName: ${JSON.stringify(def.displayName)},`,
    `    environments: ${JSON.stringify(def.environments)},`,
    `    domains: ${JSON.stringify(def.domains)},`,
    `    urlPatterns: ${JSON.stringify(def.urlPatterns)},`,
    `    iconName: ${JSON.stringify(def.iconName)},`,
    `    timeout: ${JSON.stringify(def.timeout)},`,
  ];
  if (def.defaultUrl !== undefined) {
    lines.push(`    defaultUrl: ${JSON.stringify(def.defaultUrl)},`);
  }
  if (def.hostPermissions !== undefined) {
    lines.push(`    hostPermissions: ${JSON.stringify(def.hostPermissions)},`);
  }
  lines.push(`    source: ${JSON.stringify(def.source)},`);
  if (def.packageName !== undefined) {
    lines.push(`    packageName: ${JSON.stringify(def.packageName)},`);
  }
  return `  {\n${lines.join('\n')}\n  }`;
};

// Build health check import lines and config entries
const healthCheckImports: string[] = [];
const serviceConfigEntries: string[] = [];

for (const [serviceId, config] of Object.entries(result.serviceConfigs)) {
  const plugin = result.plugins.find(p => p.manifest.name === config.adapterName);
  const hasIsHealthy = plugin?.isHealthy != null;

  // If the plugin has isHealthy, import it from the ./health-check export path
  if (hasIsHealthy && plugin) {
    const importName = `${config.adapterName}_isHealthy`;
    const packageName = plugin.manifest.name;

    // Try to resolve the health-check export path from the plugin package
    // The plugin should export ./health-check for lightweight extension-side import
    const pluginPkgPath = resolve(ROOT_DIR, 'plugins', packageName, 'package.json');
    let healthCheckExportPath: string | null = null;

    if (existsSync(pluginPkgPath)) {
      const pluginPkg = JSON.parse(readFileSync(pluginPkgPath, 'utf-8'));
      const exports = pluginPkg.exports ?? {};
      if (exports['./health-check']) {
        healthCheckExportPath = `@opentabs/plugin-${packageName}/health-check`;
      }
    }

    if (healthCheckExportPath) {
      healthCheckImports.push(`import { isHealthy as ${importName} } from '${healthCheckExportPath}';`);
    } else {
      // Fallback: warn and skip isHealthy (use default evaluator)
      console.warn(
        `[Build] Plugin "${packageName}" exports isHealthy but has no ./health-check export path. ` +
          `The extension will use the default health check evaluator.`,
      );
    }
  }

  // Serialize the config object
  const isHealthyRef = hasIsHealthy ? `${config.adapterName}_isHealthy` : undefined;
  const configLines = [
    `    serviceId: ${JSON.stringify(config.serviceId)},`,
    `    displayName: ${JSON.stringify(config.displayName)},`,
    `    adapterName: ${JSON.stringify(config.adapterName)},`,
    `    urlPatterns: ${JSON.stringify(config.urlPatterns)},`,
    `    domain: ${JSON.stringify(config.domain)},`,
    `    authErrorPatterns: ${JSON.stringify(config.authErrorPatterns)},`,
    `    healthCheck: ${JSON.stringify(config.healthCheck)},`,
  ];

  if (isHealthyRef && healthCheckImports.some(imp => imp.includes(isHealthyRef))) {
    configLines.push(`    isHealthy: ${isHealthyRef},`);
  }
  if (config.notConnectedMessage) {
    configLines.push(`    notConnectedMessage: ${JSON.stringify(config.notConnectedMessage)},`);
  }
  if (config.tabNotFoundMessage) {
    configLines.push(`    tabNotFoundMessage: ${JSON.stringify(config.tabNotFoundMessage)},`);
  }

  serviceConfigEntries.push(`  ${JSON.stringify(serviceId)}: {\n${configLines.join('\n')}\n  }`);
}

const generatedEntry = `/**
 * AUTO-GENERATED — Do not edit manually.
 * Generated by platform/browser-extension/build.ts at build time.
 *
 * This module initializes the extension background with plugin-discovered
 * service definitions and service controller configs.
 */

import { initialize } from '../src/background/index.ts';
${healthCheckImports.join('\n')}

const serviceDefinitions = [
${result.registry.map(serializeServiceDefinition).join(',\n')}
];

const serviceConfigs = {
${serviceConfigEntries.join(',\n')}
};

initialize(serviceDefinitions, serviceConfigs);
`;

const generatedEntryPath = resolve(GENERATED_DIR, 'entry.ts');
writeFileSync(generatedEntryPath, generatedEntry, 'utf-8');
console.log('[Build] Generated background entry point');

// ---------------------------------------------------------------------------
// Step 3: Bundle the background script
// ---------------------------------------------------------------------------

console.log('[Build] Bundling background script...');

const backgroundResult = await Bun.build({
  entrypoints: [generatedEntryPath],
  outdir: OUT_DIR,
  target: 'browser',
  format: 'esm',
  naming: 'background.js',
  minify: false,
  sourcemap: 'none',
  external: ['chrome'],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

if (!backgroundResult.success) {
  console.error('[Build] Background bundle failed:');
  for (const log of backgroundResult.logs) {
    console.error(log);
  }
  process.exit(1);
}
console.log('[Build] Background script bundled');

// ---------------------------------------------------------------------------
// Step 4: Bundle each plugin adapter as an IIFE
// ---------------------------------------------------------------------------

console.log('[Build] Bundling adapters...');

for (const plugin of result.plugins) {
  const manifest = plugin.manifest;
  const adapterEntry = manifest.adapter.entry;

  // Resolve the adapter entry relative to the plugin package
  const pluginDir = resolve(ROOT_DIR, 'plugins', manifest.name);
  const adapterPath = resolve(pluginDir, adapterEntry);

  if (!existsSync(adapterPath)) {
    console.warn(`[Build] Adapter entry not found for plugin "${manifest.name}": ${adapterPath}`);
    continue;
  }

  const adapterResult = await Bun.build({
    entrypoints: [adapterPath],
    outdir: resolve(OUT_DIR, 'adapters'),
    target: 'browser',
    format: 'iife',
    naming: `${manifest.name}.iife.js`,
    minify: false,
    sourcemap: 'none',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  });

  if (!adapterResult.success) {
    console.error(`[Build] Adapter bundle failed for "${manifest.name}":`);
    for (const log of adapterResult.logs) {
      console.error(log);
    }
  } else {
    console.log(`[Build] Bundled adapter: ${manifest.name}`);
  }
}

// ---------------------------------------------------------------------------
// Step 5: Bundle the content stub as an IIFE
//
// The content stub is bundled as a separate IIFE with its own copy of
// @opentabs/core. The dynamic service registry in that copy starts empty,
// so we generate an entry that pre-populates it with the build-time
// service definitions before the stub logic runs.
// ---------------------------------------------------------------------------

console.log('[Build] Bundling content stub...');

const generatedStubEntry = resolve(GENERATED_DIR, 'content-stub-entry.ts');
const stubEntryCode = `/**
 * AUTO-GENERATED — Do not edit manually.
 * Generated by platform/browser-extension/build.ts at build time.
 *
 * Pre-populates the service registry so getServiceTypeFromHostname()
 * works in the content stub's isolated IIFE copy of @opentabs/core.
 */

import { setServiceRegistry } from '@opentabs/core';

const serviceDefinitions = [
${result.registry.map(serializeServiceDefinition).join(',\n')}
];

setServiceRegistry(serviceDefinitions);

// Run the actual content stub logic
import '../src/content-stub/index.ts';
`;
writeFileSync(generatedStubEntry, stubEntryCode, 'utf-8');

const contentStubResult = await Bun.build({
  entrypoints: [generatedStubEntry],
  outdir: resolve(OUT_DIR, 'content'),
  target: 'browser',
  format: 'iife',
  naming: 'stub.iife.js',
  minify: false,
  sourcemap: 'none',
  external: ['chrome'],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

if (!contentStubResult.success) {
  console.error('[Build] Content stub bundle failed:');
  for (const log of contentStubResult.logs) {
    console.error(log);
  }
  process.exit(1);
}
console.log('[Build] Content stub bundled');

// ---------------------------------------------------------------------------
// Step 6: Bundle the offscreen document
// ---------------------------------------------------------------------------

console.log('[Build] Bundling offscreen document...');

const offscreenEntry = resolve(EXTENSION_SRC_DIR, 'offscreen', 'offscreen.ts');

const offscreenResult = await Bun.build({
  entrypoints: [offscreenEntry],
  outdir: OUT_DIR,
  target: 'browser',
  format: 'esm',
  naming: 'offscreen.js',
  minify: false,
  sourcemap: 'none',
  external: ['chrome'],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

if (!offscreenResult.success) {
  console.error('[Build] Offscreen bundle failed:');
  for (const log of offscreenResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Copy offscreen.html
const offscreenHtmlSrc = resolve(EXTENSION_SRC_DIR, 'offscreen', 'offscreen.html');
cpSync(offscreenHtmlSrc, resolve(OUT_DIR, 'offscreen.html'));
console.log('[Build] Offscreen document bundled');

// ---------------------------------------------------------------------------
// Step 6b: Bundle the side panel
// ---------------------------------------------------------------------------

console.log('[Build] Bundling side panel...');

mkdirSync(resolve(OUT_DIR, 'side-panel'), { recursive: true });

const sidePanelEntry = resolve(EXTENSION_SRC_DIR, 'side-panel', 'side-panel.ts');

const sidePanelResult = await Bun.build({
  entrypoints: [sidePanelEntry],
  outdir: resolve(OUT_DIR, 'side-panel'),
  target: 'browser',
  format: 'esm',
  naming: 'side-panel.js',
  minify: false,
  sourcemap: 'none',
  external: ['chrome'],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

if (!sidePanelResult.success) {
  console.error('[Build] Side panel bundle failed:');
  for (const log of sidePanelResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Copy side-panel HTML
const sidePanelHtmlSrc = resolve(EXTENSION_SRC_DIR, 'side-panel', 'index.html');
cpSync(sidePanelHtmlSrc, resolve(OUT_DIR, 'side-panel', 'index.html'));
console.log('[Build] Side panel bundled');

// ---------------------------------------------------------------------------
// Step 7: Generate manifest.json
// ---------------------------------------------------------------------------

console.log('[Build] Generating manifest.json...');

/** Convert wildcard URL patterns to https-only for manifest entries */
const toHttps = (pattern: string): string => pattern.replace('*://', 'https://');

/** Collect all URL patterns for a service across all environments */
const allPatternsFor = (def: ServiceDefinition): string[] =>
  Object.values(def.urlPatterns).flatMap(patterns => [...patterns].map(toHttps));

/** Host permissions: use service-specific overrides when available, otherwise derive from URL patterns */
const hostPermissions = result.registry.flatMap(def =>
  def.hostPermissions ? [...def.hostPermissions] : allPatternsFor(def),
);

/** Content scripts: one entry per service, all using the same stub */
const contentScripts = result.registry.map(def => ({
  matches: allPatternsFor(def),
  js: ['content/stub.iife.js'],
  run_at: 'document_idle' as const,
}));

/** Web-accessible resources: one entry per adapter IIFE */
const webAccessibleResources = result.registry.map(def => ({
  resources: [`adapters/${def.type}.iife.js`],
  matches: allPatternsFor(def),
}));

// Read version from the browser-extension package.json
const extensionPkg = JSON.parse(readFileSync(resolve(EXTENSION_PKG_DIR, 'package.json'), 'utf-8'));

const manifest = {
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extensionName__',
  version: extensionPkg.version,
  description: '__MSG_extensionDescription__',
  host_permissions: hostPermissions,
  permissions: ['storage', 'scripting', 'tabs', 'alarms', 'offscreen', 'sidePanel'],
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
  action: {
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
  side_panel: {
    default_path: 'side-panel/index.html',
  },
  content_scripts: contentScripts,
  web_accessible_resources: webAccessibleResources,
};

writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
console.log('[Build] manifest.json generated');

// ---------------------------------------------------------------------------
// Step 8: Copy static assets
// ---------------------------------------------------------------------------

console.log('[Build] Copying static assets...');

// Copy icons
if (existsSync(resolve(ORIGINAL_PUBLIC_DIR, 'icons'))) {
  cpSync(resolve(ORIGINAL_PUBLIC_DIR, 'icons'), resolve(OUT_DIR, 'icons'), { recursive: true });
  console.log('[Build] Copied icons');
}

// Copy _locales
if (existsSync(resolve(ORIGINAL_PUBLIC_DIR, '_locales'))) {
  cpSync(resolve(ORIGINAL_PUBLIC_DIR, '_locales'), resolve(OUT_DIR, '_locales'), { recursive: true });
  console.log('[Build] Copied _locales');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n[Build] Extension build complete!');
console.log(`[Build] Output: ${OUT_DIR}`);
console.log(`[Build] Plugins: ${result.plugins.map(p => p.manifest.name).join(', ') || '(none)'}`);
console.log(`[Build] Tools registered: ${result.serviceIds.length} service(s)`);
console.log('\nTo load in Chrome:');
console.log('  1. Open chrome://extensions/');
console.log('  2. Enable Developer mode');
console.log(`  3. Load unpacked → select: ${OUT_DIR}`);
