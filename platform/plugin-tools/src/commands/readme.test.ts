import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ManifestTool } from '@opentabs-dev/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PluginMeta } from './readme.js';
import { classifyTool, extractDomain, extractShortName, generateReadme, groupTools, handleReadme } from './readme.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-readme-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const writeToolsJson = async (manifest: { tools: ManifestTool[] }): Promise<void> => {
  mkdirSync(join(tmpDir, 'dist'), { recursive: true });
  await writeFile(join(tmpDir, 'dist', 'tools.json'), JSON.stringify(manifest), 'utf-8');
};

const writePackageJson = async (pkg: Record<string, unknown>): Promise<void> => {
  await writeFile(join(tmpDir, 'package.json'), JSON.stringify(pkg), 'utf-8');
};

const makeTool = (overrides: Partial<ManifestTool> & { name: string }): ManifestTool => ({
  displayName: overrides.name,
  description: `Description for ${overrides.name}`,
  icon: 'wrench',
  input_schema: { type: 'object', properties: {} },
  output_schema: { type: 'object', properties: {} },
  ...overrides,
});

const validPackageJson = {
  name: '@opentabs-dev/opentabs-plugin-acme',
  version: '1.0.0',
  main: 'dist/adapter.iife.js',
  opentabs: {
    displayName: 'Acme',
    description: 'OpenTabs plugin for Acme',
    urlPatterns: ['*://*.acme.com/*'],
    homepage: 'https://app.acme.com',
  },
};

const sampleTools: ManifestTool[] = [
  makeTool({ name: 'list_items', group: 'Items', summary: 'List all items' }),
  makeTool({ name: 'get_item', group: 'Items', summary: 'Get item details' }),
  makeTool({ name: 'create_item', group: 'Items', summary: 'Create a new item' }),
  makeTool({ name: 'search_users', group: 'Users', summary: 'Search for users' }),
  makeTool({ name: 'send_message', group: 'Messages', summary: 'Send a message' }),
];

/**
 * Capture console output and intercept process.exit.
 */
const captureOutput = async (
  fn: () => Promise<void>,
): Promise<{ logs: string[]; errors: string[]; exitCode: number | null; stdout: string }> => {
  const logs: string[] = [];
  const errors: string[] = [];
  const stdoutChunks: string[] = [];
  let exitCode: number | null = null;

  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origExit = process.exit.bind(process);
  const origStdoutWrite = process.stdout.write.bind(process.stdout);

  console.log = vi.fn((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  console.error = vi.fn((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
  process.exit = vi.fn((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${String(code)})`);
  }) as never;
  process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await fn();
  } catch (e: unknown) {
    if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
    process.stdout.write = origStdoutWrite;
  }

  return { logs, errors, exitCode, stdout: stdoutChunks.join('') };
};

// ---------------------------------------------------------------------------
// classifyTool
// ---------------------------------------------------------------------------

describe('classifyTool', () => {
  test('classifies read tools by prefix', () => {
    expect(classifyTool('list_channels')).toBe('Read');
    expect(classifyTool('get_user')).toBe('Read');
    expect(classifyTool('search_messages')).toBe('Read');
    expect(classifyTool('read_messages')).toBe('Read');
    expect(classifyTool('query_database')).toBe('Read');
    expect(classifyTool('browse_catalog')).toBe('Read');
    expect(classifyTool('find_restaurants')).toBe('Read');
    expect(classifyTool('check_status')).toBe('Read');
  });

  test('classifies write tools', () => {
    expect(classifyTool('send_message')).toBe('Write');
    expect(classifyTool('create_channel')).toBe('Write');
    expect(classifyTool('delete_item')).toBe('Write');
    expect(classifyTool('update_profile')).toBe('Write');
    expect(classifyTool('archive_channel')).toBe('Write');
    expect(classifyTool('pin_message')).toBe('Write');
    expect(classifyTool('navigate_to_checkout')).toBe('Write');
  });
});

// ---------------------------------------------------------------------------
// extractDomain
// ---------------------------------------------------------------------------

describe('extractDomain', () => {
  test('extracts domain from wildcard subdomain pattern', () => {
    expect(extractDomain('*://*.slack.com/*')).toBe('slack.com');
  });

  test('extracts domain from exact domain pattern', () => {
    expect(extractDomain('*://discord.com/*')).toBe('discord.com');
  });

  test('extracts domain from https pattern', () => {
    expect(extractDomain('https://app.notion.so/*')).toBe('app.notion.so');
  });

  test('handles pattern without path', () => {
    expect(extractDomain('*://example.com')).toBe('example.com');
  });
});

// ---------------------------------------------------------------------------
// extractShortName
// ---------------------------------------------------------------------------

describe('extractShortName', () => {
  test('extracts from scoped package name', () => {
    expect(extractShortName('@opentabs-dev/opentabs-plugin-slack')).toBe('slack');
  });

  test('extracts from unscoped package name', () => {
    expect(extractShortName('opentabs-plugin-discord')).toBe('discord');
  });

  test('handles hyphenated plugin names', () => {
    expect(extractShortName('@opentabs-dev/opentabs-plugin-aws-console')).toBe('aws-console');
  });
});

// ---------------------------------------------------------------------------
// groupTools
// ---------------------------------------------------------------------------

describe('groupTools', () => {
  test('groups tools by group field', () => {
    const groups = groupTools(sampleTools);
    expect(groups.map(g => ({ name: g.name, count: g.tools.length }))).toEqual([
      { name: 'Items', count: 3 },
      { name: 'Users', count: 1 },
      { name: 'Messages', count: 1 },
    ]);
  });

  test('uses "General" for tools without a group', () => {
    const tools = [makeTool({ name: 'do_thing' })];
    const groups = groupTools(tools);
    expect(groups).toHaveLength(1);
    expect(groups.map(g => g.name)).toEqual(['General']);
  });

  test('preserves first-appearance order of groups', () => {
    const tools = [
      makeTool({ name: 'b_tool', group: 'Beta' }),
      makeTool({ name: 'a_tool', group: 'Alpha' }),
      makeTool({ name: 'b_tool2', group: 'Beta' }),
    ];
    const groups = groupTools(tools);
    expect(groups.map(g => g.name)).toEqual(['Beta', 'Alpha']);
  });

  test('uses summary when available, falls back to description', () => {
    const tools = [makeTool({ name: 'with_summary', summary: 'Short summary' }), makeTool({ name: 'without_summary' })];
    const groups = groupTools(tools);
    const toolSummaries = groups.flatMap(g => g.tools.map(t => t.summary));
    expect(toolSummaries).toEqual(['Short summary', 'Description for without_summary']);
  });

  test('classifies tools as Read or Write', () => {
    const groups = groupTools(sampleTools);
    const itemTools = groups.find(g => g.name === 'Items')?.tools ?? [];
    expect(itemTools.map(t => t.type)).toEqual(['Read', 'Read', 'Write']);
  });
});

// ---------------------------------------------------------------------------
// generateReadme
// ---------------------------------------------------------------------------

describe('generateReadme', () => {
  const meta: PluginMeta = {
    packageName: '@opentabs-dev/opentabs-plugin-acme',
    displayName: 'Acme',
    description: 'OpenTabs plugin for Acme',
    domain: 'acme.com',
    homepage: 'https://app.acme.com',
    shortName: 'acme',
  };

  test('generates heading with display name', () => {
    const readme = generateReadme(meta, sampleTools);
    expect(readme).toContain('# Acme\n');
  });

  test('generates one-line description', () => {
    const readme = generateReadme(meta, sampleTools);
    expect(readme).toContain(
      'OpenTabs plugin for Acme — gives AI agents access to Acme through your authenticated browser session.',
    );
  });

  test('generates install section with short name and npm package', () => {
    const readme = generateReadme(meta, sampleTools);
    expect(readme).toContain('opentabs plugin install acme');
    expect(readme).toContain('npm install -g @opentabs-dev/opentabs-plugin-acme');
  });

  test('generates setup section with domain and homepage', () => {
    const readme = generateReadme(meta, sampleTools);
    expect(readme).toContain('[acme.com](https://app.acme.com)');
    expect(readme).toContain('the Acme plugin should appear as **ready**');
  });

  test('generates tools section with correct total count', () => {
    const readme = generateReadme(meta, sampleTools);
    expect(readme).toContain('## Tools (5)');
  });

  test('generates grouped tool tables with counts', () => {
    const readme = generateReadme(meta, sampleTools);
    expect(readme).toContain('### Items (3)');
    expect(readme).toContain('### Users (1)');
    expect(readme).toContain('### Messages (1)');
  });

  test('generates tool table rows with name, summary, and type', () => {
    const readme = generateReadme(meta, sampleTools);
    expect(readme).toContain('| `list_items` | List all items | Read |');
    expect(readme).toContain('| `create_item` | Create a new item | Write |');
    expect(readme).toContain('| `send_message` | Send a message | Write |');
  });

  test('generates How It Works section', () => {
    const readme = generateReadme(meta, sampleTools);
    expect(readme).toContain('## How It Works');
    expect(readme).toContain('runs inside your Acme tab through the [OpenTabs](https://opentabs.dev)');
  });

  test('generates License section', () => {
    const readme = generateReadme(meta, sampleTools);
    expect(readme).toContain('## License\n\nMIT\n');
  });

  test('ends with a trailing newline', () => {
    const readme = generateReadme(meta, sampleTools);
    expect(readme.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleReadme — error cases
// ---------------------------------------------------------------------------

describe('handleReadme — error cases', () => {
  test('exits with error when dist/tools.json is missing', async () => {
    const { errors, exitCode } = await captureOutput(() => handleReadme({}, tmpDir));
    expect(exitCode).toBe(1);
    expect(errors.some(e => e.includes('No manifest found'))).toBe(true);
  });

  test('exits with error when dist/tools.json is invalid', async () => {
    mkdirSync(join(tmpDir, 'dist'), { recursive: true });
    await writeFile(join(tmpDir, 'dist', 'tools.json'), '{bad json', 'utf-8');
    const { errors, exitCode } = await captureOutput(() => handleReadme({}, tmpDir));
    expect(exitCode).toBe(1);
    expect(errors.some(e => e.includes('Failed to parse'))).toBe(true);
  });

  test('exits with error when package.json is missing', async () => {
    await writeToolsJson({ tools: sampleTools });
    const { errors, exitCode } = await captureOutput(() => handleReadme({}, tmpDir));
    expect(exitCode).toBe(1);
    expect(errors.some(e => e.includes('No package.json found'))).toBe(true);
  });

  test('exits with error when package.json is invalid', async () => {
    await writeToolsJson({ tools: sampleTools });
    await writePackageJson({ name: 'bad-name', version: '1.0.0' });
    const { errors, exitCode } = await captureOutput(() => handleReadme({}, tmpDir));
    expect(exitCode).toBe(1);
    expect(errors.some(e => e.includes('Invalid package.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleReadme — dry-run mode
// ---------------------------------------------------------------------------

describe('handleReadme — dry-run mode', () => {
  test('prints readme to stdout without writing file', async () => {
    await writeToolsJson({ tools: sampleTools });
    await writePackageJson(validPackageJson);
    const { stdout, exitCode } = await captureOutput(() => handleReadme({ dryRun: true }, tmpDir));
    expect(exitCode).toBeNull();
    expect(stdout).toContain('# Acme');
    expect(stdout).toContain('## Tools (5)');
    // File should not exist
    expect(() => readFileSync(join(tmpDir, 'README.md'))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleReadme — write mode
// ---------------------------------------------------------------------------

describe('handleReadme — write mode', () => {
  test('writes README.md file', async () => {
    await writeToolsJson({ tools: sampleTools });
    await writePackageJson(validPackageJson);
    const { logs, exitCode } = await captureOutput(() => handleReadme({}, tmpDir));
    expect(exitCode).toBeNull();
    expect(logs.some(l => l.includes('README.md generated'))).toBe(true);
    const content = readFileSync(join(tmpDir, 'README.md'), 'utf-8');
    expect(content).toContain('# Acme');
    expect(content).toContain('## Tools (5)');
  });

  test('uses homepage from opentabs field', async () => {
    await writeToolsJson({ tools: sampleTools });
    await writePackageJson(validPackageJson);
    const { stdout } = await captureOutput(() => handleReadme({ dryRun: true }, tmpDir));
    expect(stdout).toContain('https://app.acme.com');
  });

  test('falls back to https://domain when homepage is not set', async () => {
    await writeToolsJson({ tools: sampleTools });
    const pkgWithoutHomepage = {
      ...validPackageJson,
      opentabs: {
        displayName: 'Acme',
        description: 'OpenTabs plugin for Acme',
        urlPatterns: ['*://*.acme.com/*'],
      },
    };
    await writePackageJson(pkgWithoutHomepage);
    const { stdout } = await captureOutput(() => handleReadme({ dryRun: true }, tmpDir));
    expect(stdout).toContain('[acme.com](https://acme.com)');
  });
});

// ---------------------------------------------------------------------------
// handleReadme — check mode
// ---------------------------------------------------------------------------

describe('handleReadme — check mode', () => {
  test('exits 0 when README.md matches generated output', async () => {
    await writeToolsJson({ tools: sampleTools });
    await writePackageJson(validPackageJson);
    // First generate the readme
    await captureOutput(() => handleReadme({}, tmpDir));
    // Then check it
    const { logs, exitCode } = await captureOutput(() => handleReadme({ check: true }, tmpDir));
    expect(exitCode).toBeNull();
    expect(logs.some(l => l.includes('up to date'))).toBe(true);
  });

  test('exits 1 when README.md differs from generated output', async () => {
    await writeToolsJson({ tools: sampleTools });
    await writePackageJson(validPackageJson);
    await writeFile(join(tmpDir, 'README.md'), 'old content', 'utf-8');
    const { errors, exitCode } = await captureOutput(() => handleReadme({ check: true }, tmpDir));
    expect(exitCode).toBe(1);
    expect(errors.some(e => e.includes('out of date'))).toBe(true);
  });

  test('exits 1 when README.md does not exist', async () => {
    await writeToolsJson({ tools: sampleTools });
    await writePackageJson(validPackageJson);
    const { errors, exitCode } = await captureOutput(() => handleReadme({ check: true }, tmpDir));
    expect(exitCode).toBe(1);
    expect(errors.some(e => e.includes('out of date'))).toBe(true);
  });
});
