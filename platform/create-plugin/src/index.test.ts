import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const CLI_PATH = resolve(import.meta.dirname, '..', 'dist', 'index.js');

/** Spawn the create-opentabs-plugin CLI binary synchronously. */
const runCli = (
  args: string[],
  opts: { cwd: string; configDir: string },
): { exitCode: number; stdout: string; stderr: string } => {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, OPENTABS_CONFIG_DIR: opts.configDir },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

// Temp directories must live on the same filesystem as the project root so
// that npm's `file:` dep resolution can work correctly. In Docker,
// os.tmpdir() returns /tmp (a container tmpfs) which is a different filesystem
// from the bind-mounted worktree, causing potential resolution issues.
const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const TEMP_BASE = join(PROJECT_ROOT, '.tmp', 'create-plugin-test');

describe('create-opentabs-plugin CLI', () => {
  let tmpDir: string;
  let configDir: string;

  beforeEach(() => {
    mkdirSync(TEMP_BASE, { recursive: true });
    tmpDir = mkdtempSync(join(TEMP_BASE, 'run-'));
    configDir = join(tmpDir, '.opentabs');
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  }, 30_000);

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
      expect(existsSync(join(projectDir, 'biome.json'))).toBe(true);
      expect(existsSync(join(projectDir, '.gitignore'))).toBe(true);
      expect(existsSync(join(projectDir, 'src', 'index.ts'))).toBe(true);
      expect(existsSync(join(projectDir, 'src', 'tools', 'example.ts'))).toBe(true);
      expect(existsSync(join(projectDir, 'README.md'))).toBe(true);
    });

    test('package.json has correct name and dependencies', async () => {
      runCli(['my-plugin', '--domain', 'example.com'], { cwd: tmpDir, configDir });

      const pkgJson = JSON.parse(await readFile(join(tmpDir, 'my-plugin', 'package.json'), 'utf-8')) as {
        name: string;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };

      expect(pkgJson.name).toBe('opentabs-plugin-my-plugin');
      expect(pkgJson.dependencies['@opentabs-dev/plugin-sdk']).toBeDefined();
      expect(pkgJson.devDependencies['@opentabs-dev/plugin-tools']).toBeDefined();
    });

    test('src/index.ts contains correct class name and URL pattern', async () => {
      runCli(['my-plugin', '--domain', 'example.com'], { cwd: tmpDir, configDir });

      const indexContent = await readFile(join(tmpDir, 'my-plugin', 'src', 'index.ts'), 'utf-8');
      expect(indexContent).toContain('class MyPluginPlugin');
      expect(indexContent).toContain("'*://*.example.com/*'");
      expect(indexContent).toContain('export default new MyPluginPlugin()');
    });

    test('README.md contains install instructions and tool section placeholder', async () => {
      runCli(['my-plugin', '--domain', 'example.com'], { cwd: tmpDir, configDir });

      const readme = await readFile(join(tmpDir, 'my-plugin', 'README.md'), 'utf-8');
      expect(readme).toContain('opentabs-plugin-my-plugin');
      expect(readme).toContain('## Install');
      expect(readme).toContain('## Setup');
      expect(readme).toContain('## Tools');
      expect(readme).toContain('example.com');
    });

    test('src/tools/example.ts contains a defineTool call with Zod schemas', async () => {
      runCli(['my-plugin', '--domain', 'example.com'], { cwd: tmpDir, configDir });

      const toolContent = await readFile(join(tmpDir, 'my-plugin', 'src', 'tools', 'example.ts'), 'utf-8');
      expect(toolContent).toContain('defineTool(');
      expect(toolContent).toContain('z.object(');
      expect(toolContent).toContain('z.string()');
    });

    test('scaffold does not auto-register in config (registration happens at build time)', () => {
      runCli(['my-plugin', '--domain', 'example.com'], { cwd: tmpDir, configDir });

      const configPath = join(configDir, 'config.json');
      expect(existsSync(configPath)).toBe(false);
    });
  });

  describe('--display and --description options', () => {
    test('--display is reflected in generated code', async () => {
      runCli(['my-app', '--domain', 'example.com', '--display', 'My App'], { cwd: tmpDir, configDir });

      const indexContent = await readFile(join(tmpDir, 'my-app', 'src', 'index.ts'), 'utf-8');
      expect(indexContent).toContain("'My App'");

      const toolContent = await readFile(join(tmpDir, 'my-app', 'src', 'tools', 'example.ts'), 'utf-8');
      expect(toolContent).toContain('My App');
    });

    test('--description is reflected in generated code', async () => {
      runCli(['my-app', '--domain', 'example.com', '--description', 'Custom description'], {
        cwd: tmpDir,
        configDir,
      });

      const indexContent = await readFile(join(tmpDir, 'my-app', 'src', 'index.ts'), 'utf-8');
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

    test('missing --domain in non-interactive mode exits with code 1', () => {
      const { exitCode, stderr } = runCli(['my-plugin'], { cwd: tmpDir, configDir });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('--domain');
    });
  });

  describe('domain URL pattern generation', () => {
    test("domain '.example.com' produces wildcard URL pattern '*://*.example.com/*'", async () => {
      runCli(['wildcard-test', '--domain', '.example.com'], { cwd: tmpDir, configDir });

      const indexContent = await readFile(join(tmpDir, 'wildcard-test', 'src', 'index.ts'), 'utf-8');
      expect(indexContent).toContain('*://*.example.com/*');
    });

    test("domain 'example.com' produces wildcard URL pattern '*://*.example.com/*'", async () => {
      runCli(['exact-test', '--domain', 'example.com'], { cwd: tmpDir, configDir });

      const indexContent = await readFile(join(tmpDir, 'exact-test', 'src', 'index.ts'), 'utf-8');
      expect(indexContent).toContain('*://*.example.com/*');
    });

    test("domain 'localhost' produces URL pattern '*://localhost/*' (no wildcard)", async () => {
      runCli(['local-test', '--domain', 'localhost'], { cwd: tmpDir, configDir });

      const indexContent = await readFile(join(tmpDir, 'local-test', 'src', 'index.ts'), 'utf-8');
      expect(indexContent).toContain('*://localhost/*');
      expect(indexContent).not.toContain('*://*.localhost/*');
    });
  });

  describe('scaffolded plugin install and build', () => {
    /** Absolute paths to local platform packages for file: overrides. */
    const PLATFORM_DIR = resolve(import.meta.dirname, '..', '..', '..');
    const localShared = `file:${join(PLATFORM_DIR, 'platform', 'shared')}`;
    const localSdk = `file:${join(PLATFORM_DIR, 'platform', 'plugin-sdk')}`;
    const localPluginTools = `file:${join(PLATFORM_DIR, 'platform', 'plugin-tools')}`;

    /**
     * Override the scaffolded plugin's package.json to use local file: references
     * instead of npm registry versions. This allows the test to run without
     * requiring npm authentication for private @opentabs-dev packages.
     */
    const overrideToLocalPackages = async (projectDir: string): Promise<void> => {
      const pkgPath = join(projectDir, 'package.json');
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as Record<string, unknown>;

      const deps = pkg.dependencies as Record<string, string> | undefined;
      const devDeps = pkg.devDependencies as Record<string, string> | undefined;

      if (deps?.['@opentabs-dev/plugin-sdk']) {
        deps['@opentabs-dev/plugin-sdk'] = localSdk;
      }
      if (devDeps?.['@opentabs-dev/plugin-tools']) {
        devDeps['@opentabs-dev/plugin-tools'] = localPluginTools;
      }

      // Ensure transitive workspace:* deps from file:-linked packages can resolve.
      // When plugin-sdk is linked via file:, its workspace:* dep on shared can't
      // resolve in a non-workspace context. Adding shared as a direct dependency
      // (plus overrides) ensures npm can find it.
      if (deps) {
        deps['@opentabs-dev/shared'] = localShared;
      }

      // npm overrides resolve transitive @opentabs-dev/* deps to local packages
      pkg.overrides = {
        '@opentabs-dev/shared': localShared,
        '@opentabs-dev/plugin-sdk': localSdk,
        '@opentabs-dev/plugin-tools': localPluginTools,
      };

      await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
    };

    test('scaffolded plugin can be installed and built, producing valid manifest and adapter', {
      timeout: 60_000,
    }, async () => {
      const { exitCode: scaffoldExit } = runCli(['build-test', '--domain', 'example.com'], {
        cwd: tmpDir,
        configDir,
      });
      expect(scaffoldExit).toBe(0);

      const projectDir = join(tmpDir, 'build-test');

      // Override deps to use local platform packages (avoids npm auth requirement)
      await overrideToLocalPackages(projectDir);

      // Use isolated config so the build doesn't register in the user's
      // real ~/.opentabs/config.json or notify a running MCP server.
      const buildEnv = { ...process.env, OPENTABS_CONFIG_DIR: configDir };

      // npm install
      const install = spawnSync('npm', ['install'], {
        cwd: projectDir,
        env: buildEnv,
        shell: true,
      });
      if ((install.status ?? 1) !== 0) {
        console.error('install stdout:', install.stdout.toString());
        console.error('install stderr:', install.stderr.toString());
      }
      expect(install.status ?? 1).toBe(0);

      // npm run build (tsc && opentabs-plugin build)
      const build = spawnSync('npm', ['run', 'build'], { cwd: projectDir, env: buildEnv, shell: true });
      if ((build.status ?? 1) !== 0) {
        console.error('build stdout:', build.stdout.toString());
        console.error('build stderr:', build.stderr.toString());
      }
      expect(build.status ?? 1).toBe(0);

      // npm run lint — scaffolded code must pass lint with zero errors out of the box
      const lint = spawnSync('npm', ['run', 'lint'], { cwd: projectDir, env: buildEnv, shell: true });
      if ((lint.status ?? 1) !== 0) {
        console.error('lint stdout:', lint.stdout.toString());
        console.error('lint stderr:', lint.stderr.toString());
      }
      expect(lint.status ?? 1).toBe(0);

      // npm run format:check — scaffolded code must match biome format config out of the box
      const formatCheck = spawnSync('npm', ['run', 'format:check'], { cwd: projectDir, env: buildEnv, shell: true });
      if ((formatCheck.status ?? 1) !== 0) {
        console.error('format:check stdout:', formatCheck.stdout.toString());
        console.error('format:check stderr:', formatCheck.stderr.toString());
      }
      expect(formatCheck.status ?? 1).toBe(0);

      // Verify dist/tools.json exists and is valid JSON
      const toolsJsonPath = join(projectDir, 'dist', 'tools.json');
      expect(existsSync(toolsJsonPath)).toBe(true);

      const manifest = JSON.parse(await readFile(toolsJsonPath, 'utf-8')) as {
        tools: Array<{
          name: string;
          description: string;
          input_schema: Record<string, unknown>;
          output_schema: Record<string, unknown>;
        }>;
      };

      // Verify manifest has top-level structure
      expect(Array.isArray(manifest.tools)).toBe(true);

      // Verify tools array has at least one tool with required fields
      expect(manifest.tools.length).toBeGreaterThan(0);
      const tool = manifest.tools[0];
      expect(tool).toBeDefined();
      expect(typeof tool?.name).toBe('string');
      expect(typeof tool?.description).toBe('string');
      expect(tool?.input_schema).toBeDefined();
      expect(tool?.output_schema).toBeDefined();

      // Verify package.json has opentabs field with metadata
      const pkgJson = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf-8')) as Record<string, unknown>;
      expect(pkgJson.name).toBe('opentabs-plugin-build-test');
      expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(pkgJson.main).toBe('dist/adapter.iife.js');
      const opentabs = pkgJson.opentabs as { urlPatterns: string[] };
      expect(Array.isArray(opentabs.urlPatterns)).toBe(true);
      expect(opentabs.urlPatterns).toContain('*://*.example.com/*');

      // Verify dist/adapter.iife.js exists and is non-empty
      const adapterPath = join(projectDir, 'dist', 'adapter.iife.js');
      expect(existsSync(adapterPath)).toBe(true);
      const adapterContent = await readFile(adapterPath, 'utf-8');
      expect(adapterContent.length).toBeGreaterThan(0);
    });
  });
});
