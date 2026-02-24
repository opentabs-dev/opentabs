/**
 * Shared scaffolding logic for creating new OpenTabs plugin projects.
 * Used by both `opentabs plugin create` and `create-opentabs-plugin`.
 *
 * Plugins are always standalone projects that depend on published
 * `@opentabs-dev/*` npm packages. There is no monorepo special-casing.
 */

import { validatePluginName, validateUrlPattern } from '@opentabs-dev/plugin-sdk';
import { readJsonFile, writeFile as runtimeWriteFile } from '@opentabs-dev/shared';
import pc from 'picocolors';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';

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

// --- Template generation ---

/**
 * Resolve the version of @opentabs-dev packages for scaffolded plugins.
 *
 * All @opentabs-dev packages are published at the same version. The SDK is a
 * direct dependency of the CLI, so `import.meta.resolve` reliably finds it
 * even in global installs. We read its version once and use it for all
 * @opentabs-dev dependencies in the scaffolded package.json.
 */
const resolveOpenTabsVersion = async (): Promise<string> => {
  try {
    const entryUrl = import.meta.resolve('@opentabs-dev/plugin-sdk');
    const entryDir = dirname(new URL(entryUrl).pathname);
    const pkg: unknown = await readJsonFile(join(entryDir, '..', 'package.json'));
    if (pkg !== null && typeof pkg === 'object' && 'version' in pkg && typeof pkg.version === 'string') {
      return `^${pkg.version}`;
    }
  } catch {
    // Resolution failed
  }
  return '*';
};

const generatePackageJson = async (args: ScaffoldArgs, urlPattern: string): Promise<string> => {
  const displayName = args.display ?? toTitleCase(args.name);
  const desc = args.description ?? `OpenTabs plugin for ${displayName}`;

  const openTabsVersion = await resolveOpenTabsVersion();

  const pkg = {
    name: `opentabs-plugin-${args.name}`,
    version: '0.0.1',
    type: 'module',
    main: 'dist/adapter.iife.js',
    keywords: ['opentabs-plugin'],
    opentabs: {
      '//': 'Optional: place icon.svg (and icon-inactive.svg) next to package.json for a custom side-panel icon',
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
      dev: 'concurrently --names tsc,build --prefix-colors blue,green "tsc --watch --preserveWatchOutput" "opentabs-plugin build --watch"',
      'type-check': 'tsc --noEmit',
      lint: 'eslint src/',
      'lint:fix': 'eslint src/ --fix',
      'format:check': 'prettier --check "src/**/*.ts"',
      format: 'prettier --write "src/**/*.ts"',
    },
    peerDependencies: {
      zod: '^4.0.0',
    },
    dependencies: {
      '@opentabs-dev/plugin-sdk': openTabsVersion,
    },
    devDependencies: {
      '@opentabs-dev/plugin-tools': openTabsVersion,
      concurrently: '^9.1.2',
      eslint: '^9.39.2',
      'eslint-config-prettier': '^10.1.8',
      'eslint-plugin-prettier': '^5.5.5',
      jiti: '^2.4.2',
      prettier: '^3.8.1',
      typescript: '^5.9.3',
      'typescript-eslint': '^8.55.0',
      zod: '^4.0.0',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
};

const TSCONFIG_CONTENT =
  JSON.stringify(
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
  ) + '\n';

const ESLINT_CONFIG_CONTENT = `import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.strict,
  eslintPluginPrettierRecommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
`;

const PRETTIERRC_CONTENT =
  JSON.stringify(
    {
      trailingComma: 'all',
      semi: true,
      singleQuote: true,
      arrowParens: 'avoid',
      printWidth: 120,
    },
    null,
    2,
  ) + '\n';

const GITIGNORE_CONTENT = `dist/
node_modules/
*.tsbuildinfo
bun.lock
package-lock.json
`;

const generateReadme = (args: ScaffoldArgs, urlPattern: string): string => {
  const displayName = args.display ?? toTitleCase(args.name);
  const desc = args.description ?? `OpenTabs plugin for ${displayName}`;

  return `# opentabs-plugin-${args.name}

${desc}

## Project Structure

\`\`\`
${args.name}/
├── package.json          # Plugin metadata (name, opentabs field, dependencies)
├── icon.svg              # Optional custom icon (square SVG, max 8KB)
├── icon-inactive.svg     # Optional manual inactive icon override
├── src/
│   ├── index.ts          # Plugin class (extends OpenTabsPlugin)
│   └── tools/            # One file per tool (using defineTool)
│       └── example.ts
└── dist/                 # Build output (generated)
    ├── adapter.iife.js   # Bundled adapter injected into matching tabs
    └── tools.json        # Tool schemas for MCP registration
\`\`\`

## Configuration

Plugin metadata is defined in \`package.json\` under the \`opentabs\` field:

\`\`\`json
{
  "name": "opentabs-plugin-${args.name}",
  "main": "dist/adapter.iife.js",
  "opentabs": {
    "displayName": "${displayName}",
    "description": "${desc}",
    "urlPatterns": ["${urlPattern}"]
  }
}
\`\`\`

- **\`main\`** — entry point for the bundled adapter IIFE
- **\`opentabs.displayName\`** — human-readable name shown in the side panel
- **\`opentabs.description\`** — short description of what the plugin does
- **\`opentabs.urlPatterns\`** — Chrome match patterns for tabs where the adapter is injected

## Custom Icons

By default, the side panel shows a colored letter avatar for your plugin. To use a custom icon, place an \`icon.svg\` file in the plugin root (next to \`package.json\`):

\`\`\`
${args.name}/
├── package.json
├── icon.svg              ← custom icon (optional)
├── icon-inactive.svg     ← manual inactive override (optional, requires icon.svg)
├── src/
│   └── ...
\`\`\`

**How it works:**

- \`opentabs-plugin build\` reads \`icon.svg\`, validates it, auto-generates a grayscale inactive variant, and embeds both in \`dist/tools.json\`
- To override the auto-generated inactive icon, provide \`icon-inactive.svg\` (must use only grayscale colors)
- If no \`icon.svg\` is provided, the letter avatar is used automatically

**Icon requirements:**

- Square SVG with a \`viewBox\` attribute (e.g., \`viewBox="0 0 32 32"\`)
- Maximum 8 KB file size
- No embedded \`<image>\`, \`<script>\`, or event handler attributes (\`onclick\`, etc.)
- Manual \`icon-inactive.svg\` must use only achromatic (grayscale) colors

## Development

\`\`\`bash
npm install
npm run build       # tsc && opentabs-plugin build
npm run dev         # watch mode (tsc --watch + opentabs-plugin build --watch)
npm run type-check  # tsc --noEmit
npm run lint        # eslint
\`\`\`

## Adding Tools

Create a new file in \`src/tools/\` using \`defineTool\`:

\`\`\`ts
import { z } from 'zod';
import { defineTool } from '@opentabs-dev/plugin-sdk';

export const myTool = defineTool({
  name: 'my_tool',
  displayName: 'My Tool',
  description: 'What this tool does',
  icon: 'wrench',
  input: z.object({ /* ... */ }),
  output: z.object({ /* ... */ }),
  handle: async (params) => {
    // Tool implementation runs in the browser tab context
    return { /* ... */ };
  },
});
\`\`\`

Then register it in \`src/index.ts\` by adding it to the \`tools\` array.

## Shared Schemas

When 3 or more tools share the same input or output shape, extract common Zod schemas into a shared file to avoid duplication:

\`\`\`ts
// src/schemas/channel.ts
import { z } from 'zod';

export const channelSchema = z.object({
  id: z.string().describe('Channel ID'),
  name: z.string().describe('Channel name'),
});

export type Channel = z.infer<typeof channelSchema>;
\`\`\`

Then import and reuse in your tools:

\`\`\`ts
// src/tools/list-channels.ts
import { channelSchema } from '../schemas/channel.js';

export const listChannels = defineTool({
  name: 'list_channels',
  displayName: 'List Channels',
  description: 'List all available channels',
  icon: 'list',
  input: z.object({}),
  output: z.object({ channels: z.array(channelSchema) }),
  handle: async () => {
    // ...
    return { channels: [] };
  },
});
\`\`\`

This keeps your tool schemas DRY and makes it easy to evolve shared types in one place.
`;
};

const generatePluginIndex = (args: ScaffoldArgs, urlPattern: string): string => {
  const displayName = args.display ?? toTitleCase(args.name);
  const desc = args.description ?? `OpenTabs plugin for ${displayName}`;

  return `import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import { exampleTool } from './tools/example.js';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';

class ${toPascalCase(args.name)}Plugin extends OpenTabsPlugin {
  readonly name = ${JSON.stringify(args.name)};
  readonly version = '0.0.1';
  readonly description = ${JSON.stringify(desc)};
  override readonly displayName = ${JSON.stringify(displayName)};
  readonly urlPatterns = [${JSON.stringify(urlPattern)}];
  readonly tools: ToolDefinition[] = [exampleTool];

  // IMPORTANT: Implement this method to check if the user is authenticated.
  // The plugin reports 'unavailable' until this returns true.
  // Examples:
  //   return document.cookie.includes('session=');
  //   return document.querySelector('[data-user-id]') !== null;
  //   return getPageGlobal('APP.currentUser') !== undefined;
  async isReady(): Promise<boolean> {
    return false;
  }
}

export default new ${toPascalCase(args.name)}Plugin();
`;
};

const generateExampleTool = (args: ScaffoldArgs): string => {
  const displayName = args.display ?? toTitleCase(args.name);

  const escaped = JSON.stringify(displayName);

  return `import { z } from 'zod';
import { defineTool } from '@opentabs-dev/plugin-sdk';

export const exampleTool = defineTool({
  name: 'example',
  displayName: 'Example',
  description: 'An example tool for ' + ${escaped} + ' — replace with your own implementation',
  icon: 'sparkles',
  input: z.object({
    message: z.string().describe('A sample input message'),
  }),
  output: z.object({
    result: z.string().describe('The result of the example operation'),
  }),
  handle: async (params) => {
    return { result: 'Hello from ' + ${escaped} + ': ' + params.message };
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
      `Missing required arguments: ${missing.join(', ')}. Provide them as flags or run interactively.`,
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

  const urlPattern = args.domain.startsWith('.') ? `*://*${args.domain}/*` : `*://${args.domain}/*`;
  const patternError = validateUrlPattern(urlPattern);
  if (patternError) {
    throw new ScaffoldError(patternError);
  }

  const projectDir = resolve(process.cwd(), args.name);
  if (existsSync(projectDir)) {
    throw new ScaffoldError(`Directory "${args.name}" already exists`);
  }

  console.log(`Creating ${pc.bold(`opentabs-plugin-${args.name}`)}...`);

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(projectDir, 'src', 'tools'), { recursive: true });

  await runtimeWriteFile(join(projectDir, 'package.json'), await generatePackageJson(args, urlPattern));
  console.log(`  ${pc.dim('Created:')} ${pc.bold('package.json')}`);

  await runtimeWriteFile(join(projectDir, 'tsconfig.json'), TSCONFIG_CONTENT);
  console.log(`  ${pc.dim('Created:')} ${pc.bold('tsconfig.json')}`);

  await runtimeWriteFile(join(projectDir, 'eslint.config.ts'), ESLINT_CONFIG_CONTENT);
  console.log(`  ${pc.dim('Created:')} ${pc.bold('eslint.config.ts')}`);

  await runtimeWriteFile(join(projectDir, '.prettierrc'), PRETTIERRC_CONTENT);
  console.log(`  ${pc.dim('Created:')} ${pc.bold('.prettierrc')}`);

  await runtimeWriteFile(join(projectDir, '.gitignore'), GITIGNORE_CONTENT);
  console.log(`  ${pc.dim('Created:')} ${pc.bold('.gitignore')}`);

  await runtimeWriteFile(join(projectDir, 'src', 'index.ts'), generatePluginIndex(args, urlPattern));
  console.log(`  ${pc.dim('Created:')} ${pc.bold('src/index.ts')}`);

  await runtimeWriteFile(join(projectDir, 'src', 'tools', 'example.ts'), generateExampleTool(args));
  console.log(`  ${pc.dim('Created:')} ${pc.bold('src/tools/example.ts')}`);

  await runtimeWriteFile(join(projectDir, 'README.md'), generateReadme(args, urlPattern));
  console.log(`  ${pc.dim('Created:')} ${pc.bold('README.md')}`);

  console.log('');
  console.log(pc.green(`Plugin scaffolded in ./${args.name}/`));
  console.log('');
  console.log('Next steps:');
  console.log(`  ${pc.cyan(`cd ${args.name}`)}`);
  console.log(`  ${pc.cyan('npm install')}`);
  console.log(`  ${pc.cyan('npm run build')}`);

  return projectDir;
};

export { scaffoldPlugin, promptForMissingArgs, ScaffoldError, toPascalCase, toTitleCase };
export type { ScaffoldArgs, PartialScaffoldArgs };
