/**
 * Shared scaffolding logic for creating new OpenTabs plugin projects.
 * Used by both `opentabs plugin create` and `create-opentabs-plugin`.
 *
 * Plugins are always standalone projects that depend on published
 * `@opentabs-dev/*` npm packages. There is no monorepo special-casing.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { validatePluginName, validateUrlPattern } from '@opentabs-dev/plugin-sdk';
import { platformExec } from '@opentabs-dev/shared';
import pc from 'picocolors';

// --- Errors ---

class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScaffoldError';
  }
}

// --- Types ---

interface ScaffoldArgs {
  name: string;
  domain: string;
  display?: string;
  description?: string;
}

// --- Helpers ---

/** Convert a hyphenated name to PascalCase: "my-plugin" → "MyPlugin" */
const toPascalCase = (name: string): string =>
  name
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

/** Convert a hyphenated name to title case: "my-cool-plugin" → "My Cool Plugin" */
const toTitleCase = (name: string): string =>
  name
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

/** Wrap a string value in a single-quoted TypeScript string literal with proper escaping. */
const singleQuote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// --- Version resolution ---

interface ResolvedVersions {
  openTabsVersion: string;
  zodVersion: string;
  source: 'registry' | 'local';
}

/**
 * Query the npm registry for the latest published @opentabs-dev/plugin-sdk version.
 * Uses `npm view` which respects the user's ~/.npmrc auth token (required for
 * private @opentabs-dev packages). Returns the version string or null on failure.
 */
const queryNpmRegistryVersion = (): Promise<string | null> =>
  new Promise(resolve => {
    execFile(
      platformExec('npm'),
      ['view', '@opentabs-dev/plugin-sdk', 'version'],
      { timeout: 5000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const version = stdout.trim();
        resolve(version || null);
      },
    );
  });

/**
 * Read version strings from the locally installed @opentabs-dev/plugin-sdk.
 *
 * The SDK is a direct dependency of the CLI, so `import.meta.resolve` reliably
 * finds it even in global installs. Returns the @opentabs-dev version and the
 * zod peer dependency version, or null if resolution fails.
 */
const readLocalSdkVersions = async (): Promise<{ version: string; zodVersion: string } | null> => {
  try {
    const entryUrl = import.meta.resolve('@opentabs-dev/plugin-sdk');
    const entryDir = dirname(new URL(entryUrl).pathname);
    const pkg: unknown = JSON.parse(await readFile(join(entryDir, '..', 'package.json'), 'utf-8'));
    if (pkg === null || typeof pkg !== 'object') return null;
    const version = 'version' in pkg && typeof pkg.version === 'string' ? pkg.version : null;
    if (!version) return null;
    const peerDeps =
      'peerDependencies' in pkg && pkg.peerDependencies !== null && typeof pkg.peerDependencies === 'object'
        ? (pkg.peerDependencies as Record<string, unknown>)
        : {};
    const zodVersion = typeof peerDeps.zod === 'string' ? peerDeps.zod : '*';
    return { version, zodVersion };
  } catch {
    return null;
  }
};

/**
 * Resolve @opentabs-dev package versions for the scaffolded plugin.
 *
 * Primary source: npm registry (via `npm view`), which always returns the
 * latest published version regardless of which CLI version is installed.
 * Fallback: the locally bundled SDK version (for offline/auth-failure scenarios).
 * The zod peer dependency version always comes from the local SDK since it
 * tracks SDK API compatibility.
 */
const resolvePluginSdkVersions = async (): Promise<ResolvedVersions> => {
  const local = await readLocalSdkVersions();
  const zodVersion = local?.zodVersion ?? '*';

  const registryVersion = await queryNpmRegistryVersion();
  if (registryVersion) {
    return { openTabsVersion: `^${registryVersion}`, zodVersion, source: 'registry' };
  }

  if (local) {
    return { openTabsVersion: `^${local.version}`, zodVersion, source: 'local' };
  }

  return { openTabsVersion: '*', zodVersion: '*', source: 'local' };
};

// --- Template generation ---

const generatePackageJson = (
  args: ScaffoldArgs,
  urlPattern: string,
  versions: { openTabsVersion: string; zodVersion: string },
): string => {
  const displayName = args.display ?? toTitleCase(args.name);
  const desc = args.description ?? `OpenTabs plugin for ${displayName}`;

  const { openTabsVersion, zodVersion } = versions;

  const pkg = {
    name: `opentabs-plugin-${args.name}`,
    description: desc,
    version: '0.1.0',
    type: 'module',
    main: 'dist/adapter.iife.js',
    keywords: ['opentabs-plugin'],
    opentabs: {
      displayName,
      description: desc,
      urlPatterns: [urlPattern],
    },
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
    },
    types: './dist/index.d.ts',
    files: ['dist'],
    scripts: {
      build: 'tsc && opentabs-plugin build',
      dev: 'tsc --watch --preserveWatchOutput & opentabs-plugin build --watch',
      'type-check': 'tsc --noEmit',
      lint: 'biome lint src/',
      'lint:fix': 'biome lint --fix src/',
      'format:check': 'biome format src/',
      format: 'biome format --write src/',
      check: 'npm run build && npm run type-check && npm run lint && npm run format:check',
    },
    peerDependencies: {
      zod: '^4.0.0',
    },
    dependencies: {
      '@opentabs-dev/plugin-sdk': openTabsVersion,
    },
    devDependencies: {
      '@biomejs/biome': '2.4.5',
      '@opentabs-dev/plugin-tools': openTabsVersion,
      jiti: '^2.6.1',
      typescript: '^5.9.3',
      zod: zodVersion,
    },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
};

const TSCONFIG_CONTENT = `${JSON.stringify(
  {
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
      noUncheckedIndexedAccess: true,
      noFallthroughCasesInSwitch: true,
      noImplicitReturns: true,
      noImplicitOverride: true,
      forceConsistentCasingInFileNames: true,
      esModuleInterop: true,
      skipLibCheck: true,
      composite: true,
    },
    include: ['src'],
  },
  null,
  2,
)}\n`;

const BIOME_CONFIG_CONTENT = `${JSON.stringify(
  {
    $schema: 'https://biomejs.dev/schemas/2.4.5/schema.json',
    files: {
      includes: ['**', '!**/dist', '!**/*.tsbuildinfo'],
    },
    formatter: {
      indentStyle: 'space',
      indentWidth: 2,
      lineWidth: 120,
    },
    javascript: {
      formatter: {
        trailingCommas: 'all',
        semicolons: 'always',
        quoteStyle: 'single',
        arrowParentheses: 'asNeeded',
        bracketSameLine: true,
      },
    },
    json: {
      formatter: {
        trailingCommas: 'none',
      },
    },
    linter: {
      rules: {
        recommended: true,
        style: {
          useConst: 'error',
          useImportType: 'error',
          useExportType: 'error',
        },
        correctness: {
          noUnusedVariables: 'error',
          noUnusedImports: 'error',
          noUnusedFunctionParameters: 'error',
        },
      },
    },
    assist: {
      actions: {
        source: {
          organizeImports: {
            level: 'on',
          },
        },
      },
    },
  },
  null,
  2,
)}\n`;

const GITIGNORE_CONTENT = `dist/
node_modules/
*.tsbuildinfo
`;

const generateReadme = (args: ScaffoldArgs, urlPattern: string): string => {
  const displayName = args.display ?? toTitleCase(args.name);
  const desc = args.description ?? `OpenTabs plugin for ${displayName}`;
  const domain = urlPattern.replace(/^\*:\/\/\*?\.?/, '').replace(/\/\*$/, '');

  return `# ${displayName}

${desc} — gives AI agents access to ${displayName} through your authenticated browser session.

## Install

\`\`\`bash
opentabs plugin install ${args.name}
\`\`\`

Or install globally via npm:

\`\`\`bash
npm install -g @opentabs-dev/opentabs-plugin-${args.name}
\`\`\`

## Setup

1. Open [${domain}](https://${domain}) in Chrome and log in
2. Open the OpenTabs side panel — the ${displayName} plugin should appear as **ready**

## Tools

<!-- TODO: Replace this section with the actual tool table after implementation.
Use this format — one table per group, with Read/Write classification:

### Group Name (count)

| Tool | Description | Type |
|---|---|---|
| \`tool_name\` | What the tool does | Read or Write |

-->

_No tools implemented yet._

## How It Works

This plugin runs inside your ${displayName} tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
`;
};

const generatePluginIndex = (args: ScaffoldArgs, urlPattern: string): string => {
  const displayName = args.display ?? toTitleCase(args.name);
  const desc = args.description ?? `OpenTabs plugin for ${displayName}`;

  return `import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import { exampleTool } from './tools/example.js';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';

class ${toPascalCase(args.name)}Plugin extends OpenTabsPlugin {
  readonly name = ${singleQuote(args.name)};
  readonly description = ${singleQuote(desc)};
  override readonly displayName = ${singleQuote(displayName)};
  readonly urlPatterns = [${singleQuote(urlPattern)}];
  readonly tools: ToolDefinition[] = [exampleTool];

  // IMPORTANT: Implement this method to check if the user is authenticated.
  // The plugin reports 'unavailable' until this returns true.
  //
  // Simple examples (synchronous checks):
  //   return document.cookie.includes('session=');
  //   return document.querySelector('[data-user-id]') !== null;
  //   return getPageGlobal('APP.currentUser') !== undefined;
  //   return localStorage.getItem('token') !== null;
  //
  // For SPAs that hydrate auth asynchronously, poll for readiness:
  //   const waitForAuth = () => new Promise<boolean>(resolve => {
  //     let elapsed = 0;
  //     const timer = setInterval(() => {
  //       elapsed += 500;
  //       if (getPageGlobal('APP.currentUser') !== undefined) { clearInterval(timer); resolve(true); return; }
  //       if (elapsed >= 5000) { clearInterval(timer); resolve(false); }
  //     }, 500);
  //   });
  //   return waitForAuth();
  //
  // Some apps (e.g. Discord) delete window.localStorage. Use an iframe fallback:
  //   const iframe = document.createElement('iframe');
  //   iframe.style.display = 'none';
  //   document.body.appendChild(iframe);
  //   const token = iframe.contentWindow?.localStorage.getItem('token') ?? null;
  //   document.body.removeChild(iframe);
  //   return token !== null;
  //
  // For apps with HttpOnly cookie auth (e.g. Notion), detect via a non-HttpOnly indicator cookie:
  //   return document.cookie.includes('user_id=');
  //   // HttpOnly session cookies are sent automatically with credentials: 'include'
  async isReady(): Promise<boolean> {
    return false;
  }
}

export default new ${toPascalCase(args.name)}Plugin();
`;
};

const generateExampleTool = (args: ScaffoldArgs): string => {
  const displayName = args.display ?? toTitleCase(args.name);

  const escapedForTemplate = displayName.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

  return `import { z } from 'zod';
import { defineTool } from '@opentabs-dev/plugin-sdk';

export const exampleTool = defineTool({
  name: 'example',
  displayName: 'Example',
  description: \`An example tool for ${escapedForTemplate} — replace with your own implementation\`,
  icon: 'sparkles',
  input: z.object({
    message: z.string().describe('A sample input message'),
  }),
  output: z.object({
    result: z.string().describe('The result of the example operation'),
  }),
  handle: async params => {
    return { result: \`Hello from ${escapedForTemplate}: \${params.message}\` };
  },
});
`;
};

// --- Interactive prompting ---

interface PartialScaffoldArgs {
  name?: string;
  domain?: string;
  display?: string;
  description?: string;
}

/**
 * Prompt the user for any missing required scaffold arguments.
 * If both name and domain are already provided, returns immediately.
 * In non-interactive environments (piped stdin), throws instead of prompting.
 */
const promptForMissingArgs = async (partial: PartialScaffoldArgs): Promise<ScaffoldArgs> => {
  let { name, domain } = partial;
  const { display, description } = partial;

  if (name && domain) {
    return { name, domain, display, description };
  }

  if (!process.stdin.isTTY) {
    const missing = [!name && 'name', !domain && '--domain'].filter(Boolean);
    throw new ScaffoldError(
      `Missing required arguments: ${missing.join(', ')}.\n\nUsage: opentabs plugin create <name> --domain <domain>\nExample: opentabs plugin create my-app --domain .example.com --display "My App"`,
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    if (!name) {
      const answer = await rl.question(`Plugin name ${pc.dim('(lowercase, hyphens ok)')}: `);
      name = answer.trim();
      if (!name) {
        throw new ScaffoldError('Plugin name is required.');
      }
    }

    if (!domain) {
      const answer = await rl.question(`Target domain ${pc.dim('(e.g., .slack.com or github.com)')}: `);
      domain = answer.trim();
      if (!domain) {
        throw new ScaffoldError('Target domain is required.');
      }
    }
  } finally {
    rl.close();
  }

  return { name, domain, display, description };
};

// --- Scaffolding ---

/**
 * Scaffold a new OpenTabs plugin project.
 * Returns the absolute path to the created project directory.
 */
const scaffoldPlugin = async (args: ScaffoldArgs): Promise<string> => {
  const nameError = validatePluginName(args.name);
  if (nameError) {
    throw new ScaffoldError(nameError);
  }

  const urlPattern = args.domain.includes('.') ? `*://*.${args.domain.replace(/^\./, '')}/*` : `*://${args.domain}/*`;
  const patternError = validateUrlPattern(urlPattern);
  if (patternError) {
    throw new ScaffoldError(patternError);
  }

  const projectDir = resolve(process.cwd(), args.name);
  if (existsSync(projectDir)) {
    throw new ScaffoldError(`Directory "${args.name}" already exists`);
  }

  const versions = await resolvePluginSdkVersions();
  const sourceLabel =
    versions.source === 'registry' ? 'from npm registry' : 'from local CLI — npm registry unreachable';
  console.log(`Using @opentabs-dev packages ${pc.bold(versions.openTabsVersion)} (${sourceLabel})`);
  console.log(`Creating ${pc.bold(`opentabs-plugin-${args.name}`)}...`);

  try {
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, 'src', 'tools'), { recursive: true });

    await writeFile(join(projectDir, 'package.json'), generatePackageJson(args, urlPattern, versions), 'utf-8');
    console.log(`  ${pc.dim('Created:')} ${pc.bold('package.json')}`);

    await writeFile(join(projectDir, 'tsconfig.json'), TSCONFIG_CONTENT, 'utf-8');
    console.log(`  ${pc.dim('Created:')} ${pc.bold('tsconfig.json')}`);

    await writeFile(join(projectDir, 'biome.json'), BIOME_CONFIG_CONTENT, 'utf-8');
    console.log(`  ${pc.dim('Created:')} ${pc.bold('biome.json')}`);

    await writeFile(join(projectDir, '.gitignore'), GITIGNORE_CONTENT, 'utf-8');
    console.log(`  ${pc.dim('Created:')} ${pc.bold('.gitignore')}`);

    await writeFile(join(projectDir, 'src', 'index.ts'), generatePluginIndex(args, urlPattern), 'utf-8');
    console.log(`  ${pc.dim('Created:')} ${pc.bold('src/index.ts')}`);

    await writeFile(join(projectDir, 'src', 'tools', 'example.ts'), generateExampleTool(args), 'utf-8');
    console.log(`  ${pc.dim('Created:')} ${pc.bold('src/tools/example.ts')}`);

    await writeFile(join(projectDir, 'README.md'), generateReadme(args, urlPattern), 'utf-8');
    console.log(`  ${pc.dim('Created:')} ${pc.bold('README.md')}`);
  } catch (error) {
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
    throw error;
  }

  console.log('');
  console.log(pc.green(`Plugin scaffolded in ./${args.name}/`));
  console.log('');
  console.log('Next steps:');
  console.log(`  ${pc.cyan(`cd ${args.name}`)}`);
  console.log(`  ${pc.cyan('npm install')}`);
  console.log(`  ${pc.cyan('npm run build')}       ${pc.dim('# compile once')}`);
  console.log(`  ${pc.cyan('npm run dev')}         ${pc.dim('# watch mode — auto-rebuild on changes')}`);

  return projectDir;
};

export { scaffoldPlugin, promptForMissingArgs, resolvePluginSdkVersions, ScaffoldError, toPascalCase, toTitleCase };
export type { ScaffoldArgs, PartialScaffoldArgs, ResolvedVersions };
