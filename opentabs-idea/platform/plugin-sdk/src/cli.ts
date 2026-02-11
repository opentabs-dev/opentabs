#!/usr/bin/env bun

import { resolve, join, relative } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { OpenTabsPlugin, ToolDefinition } from './index.js'

// --- Validation helpers ---

const RESERVED_NAMES = new Set([
  'system',
  'browser',
  'opentabs',
  'extension',
  'config',
  'plugin',
  'tool',
  'mcp',
])

const NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

const validatePluginName = (name: string): string | null => {
  if (!name) return 'Plugin name is required'
  if (!NAME_REGEX.test(name)) return `Plugin name "${name}" must be lowercase alphanumeric with hyphens (e.g., "my-plugin")`
  if (RESERVED_NAMES.has(name)) return `Plugin name "${name}" is reserved — choose a different name`
  return null
}

/**
 * Validates a Chrome match pattern.
 * Valid formats: <scheme>://<host>/<path>
 * scheme: *, http, https, ftp
 * host: *, *.example.com, example.com
 * path: any string starting with /
 */
const validateUrlPattern = (pattern: string): string | null => {
  // Reject overly broad patterns
  if (pattern === '*://*/*' || pattern === '<all_urls>') {
    return `URL pattern "${pattern}" is too broad — restrict to specific domains`
  }

  const match = pattern.match(/^(\*|https?|ftp):\/\/(.+?)(\/.*)$/)
  if (!match) {
    return `URL pattern "${pattern}" is not a valid Chrome match pattern (expected: <scheme>://<host>/<path>)`
  }

  const host = match[2]
  // Host must be *, *.domain, a specific domain, or localhost (with optional port).
  // Chrome match patterns natively support localhost — essential for local development
  // and E2E testing where plugins target local web servers.
  if (
    host !== '*' &&
    !/^localhost(:\d+)?$/.test(host) &&
    !/^(\*\.)?[a-z0-9]+([-.]?[a-z0-9]+)*\.[a-z]{2,}$/i.test(host)
  ) {
    return `URL pattern "${pattern}" has an invalid host "${host}"`
  }

  return null
}

const validatePlugin = (plugin: OpenTabsPlugin): string[] => {
  const errors: string[] = []

  // Name
  const nameError = validatePluginName(plugin.name)
  if (nameError) errors.push(nameError)

  // Version
  if (!plugin.version) errors.push('Plugin version is required')

  // Description
  if (!plugin.description) errors.push('Plugin description is required')

  // URL patterns
  if (!plugin.urlPatterns || plugin.urlPatterns.length === 0) {
    errors.push('At least one URL pattern is required')
  } else {
    for (const pattern of plugin.urlPatterns) {
      const patternError = validateUrlPattern(pattern)
      if (patternError) errors.push(patternError)
    }
  }

  // Tools
  if (!plugin.tools || plugin.tools.length === 0) {
    errors.push('At least one tool is required')
  } else {
    const toolNames = new Set<string>()
    for (const tool of plugin.tools) {
      if (!tool.name) errors.push('Tool name is required')
      if (!tool.description) errors.push(`Tool "${tool.name ?? '(unnamed)'}" is missing a description`)
      if (!tool.input) errors.push(`Tool "${tool.name}" is missing an input schema`)
      if (!tool.output) errors.push(`Tool "${tool.name}" is missing an output schema`)
      if (!tool.handle) errors.push(`Tool "${tool.name}" is missing a handle function`)
      if (tool.name && toolNames.has(tool.name)) {
        errors.push(`Duplicate tool name "${tool.name}"`)
      }
      if (tool.name) toolNames.add(tool.name)
    }
  }

  return errors
}

// --- Schema conversion ---

const convertToolSchemas = (tool: ToolDefinition) => {
  const inputSchema = zodToJsonSchema(tool.input, { target: 'openApi3', $refStrategy: 'none' })
  const outputSchema = zodToJsonSchema(tool.output, { target: 'openApi3', $refStrategy: 'none' })

  // Remove the $schema property that zod-to-json-schema adds
  delete (inputSchema as Record<string, unknown>)['$schema']
  delete (outputSchema as Record<string, unknown>)['$schema']

  return { inputSchema, outputSchema }
}

// --- Manifest generation ---

interface ManifestTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown>
}

interface Manifest {
  name: string
  version: string
  displayName: string
  description: string
  url_patterns: string[]
  tools: ManifestTool[]
}

const generateManifest = (plugin: OpenTabsPlugin): Manifest => {
  const tools: ManifestTool[] = plugin.tools.map((tool) => {
    const { inputSchema, outputSchema } = convertToolSchemas(tool)
    return {
      name: tool.name,
      description: tool.description,
      input_schema: inputSchema as Record<string, unknown>,
      output_schema: outputSchema as Record<string, unknown>,
    }
  })

  return {
    name: `opentabs-plugin-${plugin.name}`,
    version: plugin.version,
    displayName: plugin.displayName ?? plugin.name,
    description: plugin.description,
    url_patterns: plugin.urlPatterns,
    tools,
  }
}

// --- IIFE bundling ---

const bundleIIFE = async (sourceEntry: string, outDir: string, pluginName: string): Promise<void> => {
  // Create a temporary wrapper entry that imports the plugin and registers it
  // on window.__openTabs.adapters. This is bundled as an IIFE so the adapter
  // is available when executed in MAIN world.
  const wrapperPath = join(outDir, '_adapter_entry.ts')
  const relativeImport = './' + relative(outDir, sourceEntry).replace(/\.ts$/, '.js')

  const wrapperCode = `import plugin from ${JSON.stringify(relativeImport)};
(globalThis as any).__openTabs = (globalThis as any).__openTabs || {};
(globalThis as any).__openTabs.adapters = (globalThis as any).__openTabs.adapters || {};
(globalThis as any).__openTabs.adapters[${JSON.stringify(pluginName)}] = plugin;
`
  writeFileSync(wrapperPath, wrapperCode)

  try {
    const result = await Bun.build({
      entrypoints: [wrapperPath],
      outdir: outDir,
      format: 'iife',
      target: 'browser',
      minify: false,
      naming: 'adapter.iife.js',
      external: [],
    })

    if (!result.success) {
      const messages = result.logs.map((log) => log.message ?? String(log)).join('\n')
      throw new Error(`IIFE bundling failed:\n${messages}`)
    }
  } finally {
    try { unlinkSync(wrapperPath) } catch {}
  }
}

// --- Main CLI ---

const main = async () => {
  const args = process.argv.slice(2)

  if (args[0] !== 'build') {
    console.error('Usage: opentabs build')
    console.error('')
    console.error('Commands:')
    console.error('  build    Generate opentabs-plugin.json manifest and bundle adapter IIFE')
    process.exit(1)
  }

  const projectDir = process.cwd()

  // Step 1: Verify plugin project has package.json
  try {
    JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))
  } catch {
    console.error('Error: No valid package.json found in current directory')
    process.exit(1)
  }

  // Determine entry point — look for compiled output in dist/
  const entryPoint = resolve(projectDir, 'dist', 'index.js')
  const sourceEntry = resolve(projectDir, 'src', 'index.ts')

  try {
    readFileSync(entryPoint)
  } catch {
    console.error(`Error: Compiled entry point not found at ${entryPoint}`)
    console.error('Run "tsc" before "opentabs build"')
    process.exit(1)
  }

  // Step 2: Dynamically import the plugin module
  console.log('Loading plugin module...')
  let plugin: OpenTabsPlugin
  try {
    const mod = await import(entryPoint)
    plugin = mod.default
    if (!plugin) {
      console.error('Error: Plugin module must export a default instance of OpenTabsPlugin')
      process.exit(1)
    }
  } catch (err) {
    console.error('Error: Failed to import plugin module:', (err as Error).message)
    process.exit(1)
  }

  // Step 3: Validate
  console.log('Validating plugin...')
  const errors = validatePlugin(plugin)
  if (errors.length > 0) {
    console.error('Validation failed:')
    for (const err of errors) {
      console.error(`  - ${err}`)
    }
    process.exit(1)
  }

  // Step 4: Generate manifest
  console.log('Generating manifest...')
  const manifest = generateManifest(plugin)
  const manifestPath = join(projectDir, 'opentabs-plugin.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`  Written: opentabs-plugin.json`)

  // Step 5: Bundle IIFE
  console.log('Bundling adapter IIFE...')
  const distDir = join(projectDir, 'dist')
  mkdirSync(distDir, { recursive: true })

  try {
    await bundleIIFE(sourceEntry, distDir, plugin.name)
    console.log('  Written: dist/adapter.iife.js')
  } catch (err) {
    console.error('Error: IIFE bundling failed:', (err as Error).message)
    process.exit(1)
  }

  console.log('')
  console.log(`Build complete for plugin "${plugin.name}" v${plugin.version}`)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
