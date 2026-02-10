import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reserved plugin names that conflict with platform internals */
const RESERVED_NAMES = new Set(['browser', 'system', 'extension', 'plugin', 'opentabs']);

/** Valid plugin name pattern: lowercase alphanumeric with hyphens, starting with a letter */
const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface ScaffoldOptions {
  /** Plugin name (required, lowercase alphanumeric + hyphens) */
  readonly name: string;
  /** Primary domain the plugin operates on (e.g., "app.slack.com") */
  readonly domain?: string;
  /** Human-readable display name */
  readonly displayName?: string;
  /** Short description of the plugin */
  readonly description?: string;
  /** Plugin author name */
  readonly author?: string;
  /** Output directory (defaults to current working directory + plugin name) */
  readonly output?: string;
}

interface ScaffoldResult {
  readonly outputDir: string;
  readonly files: readonly string[];
}

// ---------------------------------------------------------------------------
// Name Validation
// ---------------------------------------------------------------------------

const validatePluginName = (name: string): string | undefined => {
  if (name.length === 0) {
    return 'Plugin name must not be empty';
  }
  if (name.length > 100) {
    return 'Plugin name must not exceed 100 characters';
  }
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    return 'Plugin name must be lowercase alphanumeric with hyphens, starting with a letter';
  }
  if (RESERVED_NAMES.has(name)) {
    return `Plugin name "${name}" is reserved. Reserved names: ${[...RESERVED_NAMES].join(', ')}`;
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Template Content Generators
// ---------------------------------------------------------------------------

const toDisplayName = (name: string): string =>
  name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const toDomain = (name: string): string => `${name}.example.com`;

interface TemplateVars {
  readonly name: string;
  readonly displayName: string;
  readonly domain: string;
  readonly description: string;
  readonly author: string;
}

const manifestTemplate = (vars: TemplateVars): string =>
  JSON.stringify(
    {
      $schema: 'https://raw.githubusercontent.com/nicepkg/opentabs/main/platform/schemas/plugin-v1.json',
      name: vars.name,
      displayName: vars.displayName,
      version: '0.1.0',
      description: vars.description,
      author: vars.author,
      icon: vars.name,
      adapter: {
        domains: [vars.domain],
        urlPatterns: [`https://${vars.domain}/*`],
        hostPermissions: [`https://${vars.domain}/*`],
        defaultUrl: `https://${vars.domain}`,
      },
      service: {
        timeout: 30000,
        environments: ['webapp'],
        healthCheck: {
          method: `${vars.name}.health`,
          params: {},
        },
        notConnectedMessage: `${vars.displayName} is not connected. Make sure the MCP server is running.`,
        tabNotFoundMessage: `No ${vars.displayName} tab found. Open https://${vars.domain} in your browser.`,
      },
      tools: {
        categories: [
          {
            name: 'General',
            tools: [`${vars.name}_get_status`],
          },
        ],
      },
      permissions: {
        network: [vars.domain],
      },
    },
    null,
    2,
  );

const packageJsonTemplate = (vars: TemplateVars): string =>
  JSON.stringify(
    {
      name: `opentabs-plugin-${vars.name}`,
      version: '0.1.0',
      description: vars.description,
      author: vars.author,
      type: 'module',
      main: 'dist/tools/index.js',
      types: 'dist/tools/index.d.ts',
      files: ['dist', 'opentabs-plugin.json'],
      keywords: ['opentabs-plugin'],
      scripts: {
        build: 'tsc --build tsconfig.build.json',
        clean: 'rimraf dist',
      },
      peerDependencies: {
        '@opentabs/plugin-sdk': '*',
        '@modelcontextprotocol/sdk': '*',
        zod: '*',
      },
    },
    null,
    2,
  );

const tsconfigTemplate = (): string =>
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2022'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        isolatedModules: true,
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        composite: true,
        verbatimModuleSyntax: true,
        outDir: 'dist',
        rootDir: 'src',
      },
      include: ['src'],
    },
    null,
    2,
  );

const tsconfigBuildTemplate = (): string =>
  JSON.stringify(
    {
      extends: './tsconfig.json',
    },
    null,
    2,
  );

const adapterTemplate = (vars: TemplateVars): string => `import {
  registerAdapter,
  ok,
  fail,
  parseAction,
  createScopedFetch,
  INTERNAL_ERROR,
  METHOD_NOT_FOUND,
} from '@opentabs/plugin-sdk/adapter';
import type { AdapterRequestHandler } from '@opentabs/plugin-sdk/adapter';

const scopedFetch = createScopedFetch(['${vars.domain}'], '${vars.name}');

const handleRequest: AdapterRequestHandler = async (request) => {
  const action = parseAction(request.method);

  switch (action) {
    case 'health': {
      return ok(request.id, { ok: true });
    }

    case 'api': {
      const { method, params } = request.params as { method: string; params?: Record<string, unknown> };
      try {
        const response = await scopedFetch(\`https://${vars.domain}/api/\${method}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params ?? {}),
        });
        const data: unknown = await response.json();
        return ok(request.id, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(request.id, INTERNAL_ERROR, message);
      }
    }

    default:
      return fail(request.id, METHOD_NOT_FOUND, \`Unknown action: \${action}\`);
  }
};

registerAdapter('${vars.name}', handleRequest);
`;

const toolsIndexTemplate = (): string => `import type { McpServerLike } from '@opentabs/plugin-sdk';
import { registerGeneralTools } from './general.js';

const registerTools = (server: McpServerLike): void => {
  registerGeneralTools(server);
};

export { registerTools };
`;

const toolsGeneralTemplate = (
  vars: TemplateVars,
): string => `import { createToolRegistrar, sendServiceRequest, success, error } from '@opentabs/plugin-sdk/server';
import type { McpServerLike } from '@opentabs/plugin-sdk';
import { z } from 'zod';

const registerGeneralTools = (server: McpServerLike): void => {
  const { define } = createToolRegistrar(server);

  define(
    '${vars.name}_get_status',
    'Get the current status of ${vars.displayName}',
    {},
    async () => {
      try {
        const result = await sendServiceRequest('${vars.name}', {}, 'health');
        return success(result);
      } catch (err) {
        return error(err);
      }
    },
  );
};

export { registerGeneralTools };
`;

// ---------------------------------------------------------------------------
// scaffoldPlugin — programmatic API
// ---------------------------------------------------------------------------

const scaffoldPlugin = (options: ScaffoldOptions): ScaffoldResult => {
  const nameError = validatePluginName(options.name);
  if (nameError !== undefined) {
    throw new Error(nameError);
  }

  const vars: TemplateVars = {
    name: options.name,
    displayName: options.displayName ?? toDisplayName(options.name),
    domain: options.domain ?? toDomain(options.name),
    description: options.description ?? `OpenTabs plugin for ${options.displayName ?? toDisplayName(options.name)}`,
    author: options.author ?? 'OpenTabs Community',
  };

  const outputDir = resolve(options.output ?? options.name);

  if (existsSync(outputDir)) {
    throw new Error(`Output directory already exists: ${outputDir}`);
  }

  // Create directory structure
  mkdirSync(join(outputDir, 'src', 'tools'), { recursive: true });

  // Generate files
  const files: string[] = [];

  const writeTemplate = (relativePath: string, content: string): void => {
    const filePath = join(outputDir, relativePath);
    writeFileSync(filePath, content + '\n', 'utf-8');
    files.push(relativePath);
  };

  writeTemplate('opentabs-plugin.json', manifestTemplate(vars));
  writeTemplate('package.json', packageJsonTemplate(vars));
  writeTemplate('tsconfig.json', tsconfigTemplate());
  writeTemplate('tsconfig.build.json', tsconfigBuildTemplate());
  writeTemplate('src/adapter.ts', adapterTemplate(vars));
  writeTemplate('src/tools/index.ts', toolsIndexTemplate());
  writeTemplate('src/tools/general.ts', toolsGeneralTemplate(vars));

  return { outputDir, files };
};

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

const parseArgs = (argv: readonly string[]): ScaffoldOptions => {
  const args = argv.slice(2);
  let name: string | undefined;
  let domain: string | undefined;
  let displayName: string | undefined;
  let description: string | undefined;
  let author: string | undefined;
  let output: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (arg === '--domain' && i + 1 < args.length) {
      domain = args[++i];
    } else if (arg === '--display' && i + 1 < args.length) {
      displayName = args[++i];
    } else if (arg === '--description' && i + 1 < args.length) {
      description = args[++i];
    } else if (arg === '--author' && i + 1 < args.length) {
      author = args[++i];
    } else if (arg === '--output' && i + 1 < args.length) {
      output = args[++i];
    } else if (!arg.startsWith('--') && name === undefined) {
      name = arg;
    }
  }

  if (name === undefined) {
    throw new Error(
      'Usage: create-opentabs-plugin <name> [--domain <domain>] [--display <displayName>] [--description <desc>] [--author <author>] [--output <dir>]',
    );
  }

  return { name, domain, displayName, description, author, output };
};

const runCli = (argv: readonly string[]): void => {
  const options = parseArgs(argv);
  const result = scaffoldPlugin(options);

  const log = console.log;
  log(`\nCreated plugin "${options.name}" at ${result.outputDir}\n`);
  log('Files:');
  for (const file of result.files) {
    log(`  ${file}`);
  }
  log('\nNext steps:');
  log(`  cd ${result.outputDir}`);
  log('  bun install');
  log('  bun run build');
  log('');
};

// ---------------------------------------------------------------------------
// Exports (all at bottom per ESLint exports-last rule)
// ---------------------------------------------------------------------------

export { scaffoldPlugin, runCli, validatePluginName, RESERVED_NAMES, type ScaffoldOptions, type ScaffoldResult };
