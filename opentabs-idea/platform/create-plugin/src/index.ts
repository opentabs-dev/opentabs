#!/usr/bin/env bun

import { resolve, join } from 'node:path'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'

// --- Validation (shared with plugin-sdk/cli.ts) ---

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
  if (!NAME_REGEX.test(name))
    return `Plugin name "${name}" must be lowercase alphanumeric with hyphens (e.g., "my-plugin")`
  if (RESERVED_NAMES.has(name))
    return `Plugin name "${name}" is reserved — choose a different name`
  return null
}

// --- Argument parsing ---

interface CliArgs {
  name: string
  domain?: string
  display?: string
  description?: string
}

const parseArgs = (argv: string[]): CliArgs | null => {
  const args = argv.slice(2)
  let name = ''
  let domain: string | undefined
  let display: string | undefined
  let description: string | undefined

  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg === '--domain' && i + 1 < args.length) {
      domain = args[++i]
    } else if (arg === '--display' && i + 1 < args.length) {
      display = args[++i]
    } else if (arg === '--description' && i + 1 < args.length) {
      description = args[++i]
    } else if (arg === '--help' || arg === '-h') {
      return null
    } else if (!arg.startsWith('--') && !name) {
      name = arg
    } else {
      console.error(`Unknown argument: ${arg}`)
      return null
    }
    i++
  }

  if (!name) return null
  return { name, domain, display, description }
}

// --- Template generation ---

const generatePackageJson = (args: CliArgs): string => {
  const pkg = {
    name: `opentabs-plugin-${args.name}`,
    version: '0.0.1',
    type: 'module',
    keywords: ['opentabs-plugin'],
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
    },
    types: './dist/index.d.ts',
    files: ['dist', 'opentabs-plugin.json'],
    scripts: {
      build: 'tsc && opentabs build',
      dev: 'bun run build --watch',
    },
    peerDependencies: {
      zod: '^3.0.0',
    },
    dependencies: {
      '@opentabs/plugin-sdk': 'file:../../platform/plugin-sdk',
    },
    devDependencies: {
      zod: '3',
      typescript: '^5.9.3',
    },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

const generateTsconfig = (): string => {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ES2022',
      moduleResolution: 'bundler',
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      composite: true,
    },
    include: ['src'],
  }
  return JSON.stringify(config, null, 2) + '\n'
}

const generatePluginIndex = (args: CliArgs): string => {
  const domain = args.domain ?? '.example.com'
  const displayName = args.display ?? args.name.charAt(0).toUpperCase() + args.name.slice(1)
  const desc = args.description ?? `OpenTabs plugin for ${displayName}`
  // Build url pattern from domain: e.g., ".slack.com" → "*://*.slack.com/*"
  const urlPattern = domain.startsWith('.')
    ? `*://*${domain}/*`
    : `*://${domain}/*`

  return `import { OpenTabsPlugin, type ToolDefinition } from '@opentabs/plugin-sdk'
import { exampleTool } from './tools/example.js'

class ${capitalize(args.name)}Plugin extends OpenTabsPlugin {
  readonly name = ${JSON.stringify(args.name)}
  readonly version = '0.0.1'
  readonly description = ${JSON.stringify(desc)}
  readonly displayName = ${JSON.stringify(displayName)}
  readonly urlPatterns = [${JSON.stringify(urlPattern)}]
  readonly tools: ToolDefinition[] = [exampleTool]

  async isReady(): Promise<boolean> {
    return true
  }
}

export default new ${capitalize(args.name)}Plugin()
`
}

const generateExampleTool = (args: CliArgs): string => {
  const displayName = args.display ?? args.name.charAt(0).toUpperCase() + args.name.slice(1)

  return `import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const exampleTool = defineTool({
  name: 'example',
  description: \`An example tool for ${displayName} — replace with your own implementation\`,
  input: z.object({
    message: z.string().describe('A sample input message'),
  }),
  output: z.object({
    result: z.string().describe('The result of the example operation'),
  }),
  handle: async (params) => {
    return { result: \`Hello from ${displayName}: \${params.message}\` }
  },
})
`
}

/** Capitalize a hyphenated name into PascalCase: "my-plugin" → "MyPlugin" */
const capitalize = (name: string): string =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

// --- Helpers ---

const printUsageAndExit = (): never => {
  console.error('Usage: create-opentabs-plugin <name> [options]')
  console.error('')
  console.error('Arguments:')
  console.error('  name                Plugin name (lowercase alphanumeric + hyphens)')
  console.error('')
  console.error('Options:')
  console.error('  --domain <domain>   Target domain (e.g., .slack.com)')
  console.error('  --display <name>    Display name (e.g., Slack)')
  console.error('  --description <desc> Plugin description')
  console.error('  --help, -h          Show this help message')
  return process.exit(1) as never
}

const errorAndExit = (message: string): never => {
  console.error(`Error: ${message}`)
  return process.exit(1) as never
}

// --- Main ---

const main = () => {
  const args = parseArgs(process.argv)
  if (!args) return printUsageAndExit()

  // Validate name
  const nameError = validatePluginName(args.name)
  if (nameError) return errorAndExit(nameError)

  // Create project directory
  const projectDir = resolve(process.cwd(), args.name)
  if (existsSync(projectDir)) return errorAndExit(`Directory "${args.name}" already exists`)

  console.log(`Creating opentabs-plugin-${args.name}...`)

  mkdirSync(projectDir, { recursive: true })
  mkdirSync(join(projectDir, 'src', 'tools'), { recursive: true })

  // Write files
  writeFileSync(join(projectDir, 'package.json'), generatePackageJson(args))
  console.log('  Created: package.json')

  writeFileSync(join(projectDir, 'tsconfig.json'), generateTsconfig())
  console.log('  Created: tsconfig.json')

  writeFileSync(join(projectDir, 'src', 'index.ts'), generatePluginIndex(args))
  console.log('  Created: src/index.ts')

  writeFileSync(join(projectDir, 'src', 'tools', 'example.ts'), generateExampleTool(args))
  console.log('  Created: src/tools/example.ts')

  console.log('')
  console.log(`Plugin scaffolded in ./${args.name}/`)
  console.log('')
  console.log('Next steps:')
  console.log(`  cd ${args.name}`)
  console.log('  bun install')
  console.log('  bun run build')
}

main()
