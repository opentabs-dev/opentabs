import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI_PATH = resolve(import.meta.dirname, '..', 'dist', 'index.js');

/** Spawn the create-opentabs-plugin CLI binary synchronously. */
const runCli = (
  args: string[],
  opts: { cwd: string; configDir: string },
): { exitCode: number; stdout: string; stderr: string } => {
  const result = Bun.spawnSync(['bun', CLI_PATH, ...args], {
    cwd: opts.cwd,
    env: { ...Bun.env, OPENTABS_CONFIG_DIR: opts.configDir },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

describe('create-opentabs-plugin CLI', () => {
  let tmpDir: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-create-plugin-test-'));
    configDir = join(tmpDir, '.opentabs');
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('successful scaffolding', () => {
    test('scaffolds a valid plugin project with all expected files', () => {
      const { exitCode } = runCli(['test-plugin', '--domain', 'example.com'], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(0);

      const projectDir = join(tmpDir, 'test-plugin');
      expect(existsSync(join(projectDir, 'package.json'))).toBe(true);
      expect(existsSync(join(projectDir, 'tsconfig.json'))).toBe(true);
      expect(existsSync(join(projectDir, 'eslint.config.ts'))).toBe(true);
      expect(existsSync(join(projectDir, '.prettierrc'))).toBe(true);
      expect(existsSync(join(projectDir, '.gitignore'))).toBe(true);
      expect(existsSync(join(projectDir, 'src', 'index.ts'))).toBe(true);
      expect(existsSync(join(projectDir, 'src', 'tools', 'example.ts'))).toBe(true);
    });

    test('package.json has correct name and dependencies', async () => {
      runCli(['my-plugin', '--domain', 'example.com'], { cwd: tmpDir, configDir });

      const pkgJson = (await Bun.file(join(tmpDir, 'my-plugin', 'package.json')).json()) as {
        name: string;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };

      expect(pkgJson.name).toBe('opentabs-plugin-my-plugin');
      expect(pkgJson.dependencies['@opentabs-dev/plugin-sdk']).toBeDefined();
      expect(pkgJson.devDependencies['@opentabs-dev/cli']).toBeDefined();
    });

    test('src/index.ts contains correct class name and URL pattern', async () => {
      runCli(['my-plugin', '--domain', 'example.com'], { cwd: tmpDir, configDir });

      const indexContent = await Bun.file(join(tmpDir, 'my-plugin', 'src', 'index.ts')).text();
      expect(indexContent).toContain('class MyPluginPlugin');
      expect(indexContent).toContain('"*://example.com/*"');
      expect(indexContent).toContain('export default new MyPluginPlugin()');
    });

    test('src/tools/example.ts contains a defineTool call with Zod schemas', async () => {
      runCli(['my-plugin', '--domain', 'example.com'], { cwd: tmpDir, configDir });

      const toolContent = await Bun.file(join(tmpDir, 'my-plugin', 'src', 'tools', 'example.ts')).text();
      expect(toolContent).toContain('defineTool(');
      expect(toolContent).toContain('z.object(');
      expect(toolContent).toContain('z.string()');
    });

    test('plugin is auto-registered in isolated config.json', async () => {
      runCli(['my-plugin', '--domain', 'example.com'], { cwd: tmpDir, configDir });

      const configPath = join(configDir, 'config.json');
      expect(existsSync(configPath)).toBe(true);

      const config = (await Bun.file(configPath).json()) as { plugins: string[] };
      expect(Array.isArray(config.plugins)).toBe(true);
      expect(config.plugins.length).toBeGreaterThan(0);

      const hasPluginPath = config.plugins.some((p: string) => p.includes('my-plugin'));
      expect(hasPluginPath).toBe(true);
    });
  });

  describe('--display and --description options', () => {
    test('--display is reflected in generated code', async () => {
      runCli(['my-app', '--domain', 'example.com', '--display', 'My App'], { cwd: tmpDir, configDir });

      const indexContent = await Bun.file(join(tmpDir, 'my-app', 'src', 'index.ts')).text();
      expect(indexContent).toContain('"My App"');

      const toolContent = await Bun.file(join(tmpDir, 'my-app', 'src', 'tools', 'example.ts')).text();
      expect(toolContent).toContain('My App');
    });

    test('--description is reflected in generated code', async () => {
      runCli(['my-app', '--domain', 'example.com', '--description', 'Custom description'], {
        cwd: tmpDir,
        configDir,
      });

      const indexContent = await Bun.file(join(tmpDir, 'my-app', 'src', 'index.ts')).text();
      expect(indexContent).toContain('Custom description');
    });
  });

  describe('error handling', () => {
    test('invalid plugin name (uppercase) exits with code 1 and prints error', () => {
      const { exitCode, stderr } = runCli(['MyPlugin', '--domain', 'example.com'], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('must be lowercase alphanumeric with hyphens');
    });

    test('reserved plugin name exits with code 1 and prints error', () => {
      const { exitCode, stderr } = runCli(['system', '--domain', 'example.com'], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('reserved');
    });

    test('existing directory exits with code 1 and prints "already exists" error', () => {
      mkdirSync(join(tmpDir, 'existing-plugin'));

      const { exitCode, stderr } = runCli(['existing-plugin', '--domain', 'example.com'], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('already exists');
    });

    test('missing --domain flag exits with code 1 and prints usage error', () => {
      const { exitCode, stderr } = runCli(['my-plugin'], { cwd: tmpDir, configDir });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('--domain');
    });
  });

  describe('domain URL pattern generation', () => {
    test("domain '.example.com' produces wildcard URL pattern '*://*.example.com/*'", async () => {
      runCli(['wildcard-test', '--domain', '.example.com'], { cwd: tmpDir, configDir });

      const indexContent = await Bun.file(join(tmpDir, 'wildcard-test', 'src', 'index.ts')).text();
      expect(indexContent).toContain('*://*.example.com/*');
    });

    test("domain 'example.com' produces exact URL pattern '*://example.com/*'", async () => {
      runCli(['exact-test', '--domain', 'example.com'], { cwd: tmpDir, configDir });

      const indexContent = await Bun.file(join(tmpDir, 'exact-test', 'src', 'index.ts')).text();
      expect(indexContent).toContain('*://example.com/*');
      expect(indexContent).not.toContain('*://*.example.com/*');
    });
  });

  describe('scaffolded plugin install and build', () => {
    /** Absolute paths to local platform packages for file: overrides. */
    const PLATFORM_DIR = resolve(import.meta.dirname, '..', '..', '..');
    const localShared = `file:${join(PLATFORM_DIR, 'platform', 'shared')}`;
    const localSdk = `file:${join(PLATFORM_DIR, 'platform', 'plugin-sdk')}`;
    const localCli = `file:${join(PLATFORM_DIR, 'platform', 'cli')}`;

    /**
     * Override the scaffolded plugin's package.json to use local file: references
     * instead of npm registry versions. This allows the test to run without
     * requiring npm authentication for private @opentabs-dev packages.
     */
    const overrideToLocalPackages = async (projectDir: string): Promise<void> => {
      const pkgPath = join(projectDir, 'package.json');
      const pkg = (await Bun.file(pkgPath).json()) as Record<string, unknown>;

      const deps = pkg.dependencies as Record<string, string> | undefined;
      const devDeps = pkg.devDependencies as Record<string, string> | undefined;

      if (deps?.['@opentabs-dev/plugin-sdk']) {
        deps['@opentabs-dev/plugin-sdk'] = localSdk;
      }
      if (devDeps?.['@opentabs-dev/cli']) {
        devDeps['@opentabs-dev/cli'] = localCli;
      }

      // Bun overrides resolve transitive @opentabs-dev/* deps to local packages
      pkg.overrides = {
        '@opentabs-dev/shared': localShared,
        '@opentabs-dev/plugin-sdk': localSdk,
        '@opentabs-dev/cli': localCli,
      };

      await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    };

    test(
      'scaffolded plugin can be installed and built, producing valid manifest and adapter',
      async () => {
        const { exitCode: scaffoldExit } = runCli(['build-test', '--domain', 'example.com'], {
          cwd: tmpDir,
          configDir,
        });
        expect(scaffoldExit).toBe(0);

        const projectDir = join(tmpDir, 'build-test');

        // Override deps to use local platform packages (avoids npm auth requirement)
        await overrideToLocalPackages(projectDir);

        // bun install
        const install = Bun.spawnSync(['bun', 'install'], { cwd: projectDir });
        if (install.exitCode !== 0) {
          console.error('install stdout:', install.stdout.toString());
          console.error('install stderr:', install.stderr.toString());
        }
        expect(install.exitCode).toBe(0);

        // bun run build (tsc && opentabs build)
        const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: projectDir });
        if (build.exitCode !== 0) {
          console.error('build stdout:', build.stdout.toString());
          console.error('build stderr:', build.stderr.toString());
        }
        expect(build.exitCode).toBe(0);

        // Verify opentabs-plugin.json exists and is valid JSON
        const manifestPath = join(projectDir, 'opentabs-plugin.json');
        expect(existsSync(manifestPath)).toBe(true);

        const manifest = (await Bun.file(manifestPath).json()) as {
          name: string;
          version: string;
          tools: Array<{
            name: string;
            description: string;
            input_schema: Record<string, unknown>;
            output_schema: Record<string, unknown>;
          }>;
          adapterHash: string;
          url_patterns: string[];
        };

        expect(manifest.name).toBe('build-test');
        expect(manifest.version).toBe('0.0.1');
        expect(typeof manifest.adapterHash).toBe('string');
        expect(manifest.adapterHash.length).toBeGreaterThan(0);
        expect(Array.isArray(manifest.url_patterns)).toBe(true);
        expect(manifest.url_patterns).toContain('*://example.com/*');

        // Verify tools array has at least one tool with required fields
        expect(Array.isArray(manifest.tools)).toBe(true);
        expect(manifest.tools.length).toBeGreaterThan(0);
        const tool = manifest.tools[0];
        expect(tool).toBeDefined();
        expect(typeof tool?.name).toBe('string');
        expect(typeof tool?.description).toBe('string');
        expect(tool?.input_schema).toBeDefined();
        expect(tool?.output_schema).toBeDefined();

        // Verify dist/adapter.iife.js exists and is non-empty
        const adapterPath = join(projectDir, 'dist', 'adapter.iife.js');
        expect(existsSync(adapterPath)).toBe(true);
        const adapterContent = await Bun.file(adapterPath).text();
        expect(adapterContent.length).toBeGreaterThan(0);
      },
      { timeout: 60_000 },
    );
  });
});
