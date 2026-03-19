/**
 * Configure npm trusted publishers for all plugin packages.
 *
 * Sets up OIDC trusted publishing so the GitHub Actions workflow
 * (publish-plugins.yml) can publish plugins without an npm token.
 *
 * Requirements:
 *   - npm CLI authenticated (`npm whoami` must succeed)
 *   - 2FA enabled on the npm account
 *   - A valid 2FA OTP code (TOTP rotates every 30s, so the script
 *     processes packages as fast as possible)
 *
 * Usage:
 *   npx tsx scripts/setup-trusted-publishers.ts --otp=123456
 *   npx tsx scripts/setup-trusted-publishers.ts --dry-run
 *
 * The --otp flag is required for the real run (skipped for --dry-run).
 * If the OTP expires mid-batch, the script prompts for a new one.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = resolve(import.meta.dirname, '..');
const REPO = 'opentabs-dev/opentabs';
const WORKFLOW_FILE = 'publish-plugins.yml';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const capture = (cmd: string[]): string => {
  const [bin = '', ...args] = cmd;
  const result = spawnSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if ((result.status ?? 0) !== 0) {
    throw new Error(`Command failed: ${cmd.join(' ')}\n${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
};

const prompt = (question: string): Promise<string> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    rl.question(question, answer => {
      rl.close();
      res(answer.trim());
    });
  });
};

/** Discover all plugin package names under plugins/. */
const discoverPluginPackageNames = (): string[] => {
  const pluginsDir = resolve(ROOT, 'plugins');
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const pkgPath = resolve(pluginsDir, d.name, 'package.json');
      if (!existsSync(pkgPath)) return null;
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string; opentabs?: unknown };
      if (!pkg.opentabs) return null;
      return pkg.name ?? null;
    })
    .filter((name): name is string => name !== null);
};

// ---------------------------------------------------------------------------
// npm registry API
// ---------------------------------------------------------------------------

/** Get the npm auth token from the environment or .npmrc. */
const getNpmToken = (): string => {
  // Try environment variable first (set by `npm login` or CI)
  if (process.env.NPM_TOKEN) return process.env.NPM_TOKEN;

  // Read from ~/.npmrc
  const npmrcPath = resolve(process.env.HOME ?? '~', '.npmrc');
  if (existsSync(npmrcPath)) {
    const content = readFileSync(npmrcPath, 'utf-8');
    const match = /\/\/registry\.npmjs\.org\/:_authToken=(.+)/.exec(content);
    if (match?.[1]) return match[1];
  }

  throw new Error('No npm auth token found. Run `npm login` or set NPM_TOKEN.');
};

interface TrustConfig {
  id?: string;
  type: string;
  claims: Record<string, unknown>;
}

/** Check existing trusted publisher config for a package. */
const getTrustedPublishers = async (packageName: string, token: string, otp: string): Promise<TrustConfig[]> => {
  const encoded = encodeURIComponent(packageName);
  const response = await fetch(`https://registry.npmjs.org/-/package/${encoded}/trust`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'npm-otp': otp,
    },
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GET trust for ${packageName}: HTTP ${response.status} — ${body.substring(0, 200)}`);
  }
  return (await response.json()) as TrustConfig[];
};

/** Add trusted publisher config for a package. */
const addTrustedPublisher = async (packageName: string, token: string, otp: string): Promise<void> => {
  const encoded = encodeURIComponent(packageName);
  const body: TrustConfig[] = [
    {
      type: 'github',
      claims: {
        repository: REPO,
        workflow_ref: { file: WORKFLOW_FILE },
      },
    },
  ];

  const response = await fetch(`https://registry.npmjs.org/-/package/${encoded}/trust`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'npm-otp': otp,
    },
    body: JSON.stringify(body),
  });

  if (response.status === 409) {
    // Already configured
    return;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`POST trust for ${packageName}: HTTP ${response.status} — ${text.substring(0, 200)}`);
  }
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');

  // Verify npm auth
  console.log('Verifying npm authentication...');
  const npmUser = capture(['npm', 'whoami']);
  console.log(`  Authenticated as: ${npmUser}`);

  // Discover plugins
  const packageNames = discoverPluginPackageNames();
  console.log(`\nFound ${packageNames.length} plugin packages.\n`);

  if (dryRun) {
    console.log('Dry run — would configure trusted publishing for:');
    for (const name of packageNames) {
      console.log(`  ${name}`);
    }
    console.log(`\nTrusted publisher: GitHub Actions`);
    console.log(`  Repository: ${REPO}`);
    console.log(`  Workflow:   ${WORKFLOW_FILE}`);
    return;
  }

  const token = getNpmToken();

  // 2FA OTP — accept via --otp=XXXXXX flag or interactive prompt.
  // TOTP codes last 30 seconds, and each API call takes ~200ms,
  // so we can process ~100+ packages per OTP code.
  const otpArg = process.argv.find(a => a.startsWith('--otp='));
  let otp = otpArg ? (otpArg.split('=')[1] ?? '') : '';
  if (!otp) {
    otp = await prompt('Enter your npm 2FA OTP code: ');
  }
  if (!otp) {
    console.error('OTP is required. Pass --otp=XXXXXX or enter interactively.');
    process.exit(1);
  }

  let configured = 0;
  let skipped = 0;
  let failed = 0;

  for (const name of packageNames) {
    try {
      // Check if already configured
      const existing = await getTrustedPublishers(name, token, otp);
      const alreadyConfigured = existing.some(
        c => c.type === 'github' && (c.claims as { repository?: string }).repository === REPO,
      );

      if (alreadyConfigured) {
        console.log(`  ✓ ${name} — already configured`);
        skipped++;
        continue;
      }

      await addTrustedPublisher(name, token, otp);
      console.log(`  ✓ ${name} — configured`);
      configured++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // If OTP expired, prompt for a new one and retry this package
      if (msg.includes('401') || msg.includes('otp') || msg.includes('OTP')) {
        console.log(`\n  OTP expired. Enter a new 2FA OTP code to continue.`);
        otp = await prompt('New OTP: ');
        if (!otp) {
          console.error('OTP is required. Stopping.');
          break;
        }
        // Retry this package
        try {
          await addTrustedPublisher(name, token, otp);
          console.log(`  ✓ ${name} — configured (after OTP refresh)`);
          configured++;
        } catch (retryErr) {
          console.error(`  ✗ ${name} — ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
          failed++;
        }
        continue;
      }

      console.error(`  ✗ ${name} — ${msg}`);
      failed++;
    }
  }

  console.log(`\nDone: ${configured} configured, ${skipped} already set up, ${failed} failed.`);
};

await main();
