/**
 * `opentabs doctor` command — diagnoses the entire OpenTabs setup.
 */

import { getConfigPath, getExtensionDir, getLocalPluginsFromConfig, readConfig, resolvePluginPath } from '../config.js';
import { parsePort, resolvePort } from '../parse-port.js';
import {
  ADAPTER_FILENAME,
  TOOLS_FILENAME,
  fileExists as runtimeFileExists,
  isBun,
  readFile,
  readJsonFile,
} from '@opentabs-dev/shared';
import pc from 'picocolors';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';

interface DoctorOptions {
  port?: number;
}

interface CheckResult {
  label: string;
  ok: boolean;
  detail: string;
  hint?: string;
  fatal: boolean;
}

const pass = (label: string, detail: string): CheckResult => ({ label, ok: true, detail, fatal: false });
const warn = (label: string, detail: string, hint: string): CheckResult => ({
  label,
  ok: false,
  detail,
  hint,
  fatal: false,
});
const fail = (label: string, detail: string, hint: string): CheckResult => ({
  label,
  ok: false,
  detail,
  hint,
  fatal: true,
});

const checkBunVersion = (): CheckResult => {
  if (isBun) {
    return pass('Runtime', `Bun v${Bun.version}`);
  }
  return pass('Runtime', `Node.js ${process.version}`);
};

const checkConfigFile = async (): Promise<{ result: CheckResult; config: Record<string, unknown> | null }> => {
  const configPath = getConfigPath();
  const readResult = await readConfig(configPath);
  if (readResult.config) {
    return { result: pass('Config file', configPath), config: readResult.config };
  }
  if (readResult.error === 'invalid') {
    return {
      result: fail(
        'Config file',
        `invalid at ${configPath}: ${readResult.message}`,
        'Run opentabs config reset --confirm to delete and regenerate',
      ),
      config: null,
    };
  }
  return {
    result: warn('Config file', `not found at ${configPath}`, 'Run opentabs start to auto-create config'),
    config: null,
  };
};

const checkServerHealth = async (
  port: number,
  secret?: string | null,
): Promise<{ result: CheckResult; data: Record<string, unknown> | null }> => {
  const url = `http://localhost:${port}/health`;
  try {
    const headers: Record<string, string> = {};
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(3_000) });
    if (!res.ok) {
      return {
        result: fail('MCP server', `HTTP ${res.status}`, 'Check server logs for errors'),
        data: null,
      };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const version = typeof data.version === 'string' ? data.version : 'unknown';
    return { result: pass('MCP server', `running (v${version}) on port ${port}`), data };
  } catch {
    const portSuffix = port !== 9515 ? ` --port ${port}` : '';
    const hint = `Start it with: opentabs start${portSuffix}`;
    return {
      result: fail('MCP server', 'not reachable', hint),
      data: null,
    };
  }
};

const checkExtensionConnected = (data: Record<string, unknown> | null): CheckResult => {
  if (!data) {
    return warn('Extension connection', 'unknown (server not reachable)', 'Start the MCP server first');
  }
  if (data.extensionConnected === true) {
    return pass('Extension connection', 'connected');
  }
  return warn(
    'Extension connection',
    'not connected',
    'Open Chrome and ensure the OpenTabs extension is loaded and enabled',
  );
};

const checkExtensionInstalled = async (): Promise<{ result: CheckResult; versionFile: string | null }> => {
  const extensionDir = getExtensionDir();
  const manifestPath = join(extensionDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return {
      result: warn(
        'Extension installed',
        `not found at ${extensionDir}`,
        'Run opentabs start to auto-install the extension',
      ),
      versionFile: null,
    };
  }

  const versionPath = join(extensionDir, '.opentabs-version');
  const versionFile = (await runtimeFileExists(versionPath)) ? await readFile(versionPath) : null;
  return {
    result: pass('Extension installed', extensionDir),
    versionFile: versionFile?.trim() ?? null,
  };
};

const checkExtensionVersion = async (installedVersion: string | null): Promise<CheckResult> => {
  const cliDir = dirname(fileURLToPath(import.meta.url));
  let cliVersion = 'unknown';
  try {
    const pkgJson = JSON.parse(await readFile(join(cliDir, '..', '..', 'package.json'))) as { version: string };
    cliVersion = pkgJson.version;
  } catch {
    return warn(
      'Extension version',
      'could not read CLI version',
      'Ensure @opentabs-dev/cli package.json is accessible',
    );
  }

  if (!installedVersion) {
    return warn('Extension version', 'no version marker found', 'Run opentabs start to install a versioned extension');
  }

  if (installedVersion === cliVersion) {
    return pass('Extension version', `v${cliVersion} (matches CLI)`);
  }

  return warn(
    'Extension version',
    `v${installedVersion} (CLI is v${cliVersion})`,
    'Restart opentabs start to update the extension',
  );
};

interface HealthPluginDetail {
  name: string;
  displayName: string;
  toolCount: number;
  tabState: string;
  source: string;
}

interface HealthFailedPlugin {
  path: string;
  error: string;
}

const checkNpmPlugins = (data: Record<string, unknown> | null): CheckResult[] => {
  if (!data) {
    return [warn('npm plugins', 'requires running server to check', 'Start the MCP server first')];
  }

  const pluginDetails = Array.isArray(data.pluginDetails) ? (data.pluginDetails as HealthPluginDetail[]) : [];
  const failedPlugins = Array.isArray(data.failedPlugins) ? (data.failedPlugins as HealthFailedPlugin[]) : [];

  const npmPlugins = pluginDetails.filter(p => p.source === 'npm');

  const results: CheckResult[] = [];

  if (npmPlugins.length === 0 && failedPlugins.length === 0) {
    results.push(pass('npm plugins', 'none discovered'));
    return results;
  }

  for (const p of npmPlugins) {
    const detail = `${p.displayName} — ${p.toolCount} tool${p.toolCount === 1 ? '' : 's'}, tab ${p.tabState}`;
    results.push(pass(`npm plugin ${p.name}`, detail));
  }

  for (const f of failedPlugins) {
    results.push(
      warn(
        `npm plugin ${f.path}`,
        `failed: ${f.error}`,
        'Check plugin installation or rebuild with opentabs-plugin build',
      ),
    );
  }

  return results;
};

interface McpClientLocation {
  name: string;
  path: string;
}

const defaultMcpClientLocations = (): McpClientLocation[] => [
  { name: 'Claude Code', path: join(homedir(), '.claude', 'settings', 'mcp.json') },
  { name: 'Cursor', path: join(process.cwd(), '.cursor', 'mcp.json') },
];

const checkMcpClientConfig = async (
  clients: McpClientLocation[] = defaultMcpClientLocations(),
): Promise<CheckResult> => {
  for (const client of clients) {
    if (!existsSync(client.path)) continue;
    try {
      const content = await readFile(client.path);
      const parsed: unknown = JSON.parse(content);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'mcpServers' in parsed &&
        parsed.mcpServers !== null &&
        typeof parsed.mcpServers === 'object' &&
        'opentabs' in parsed.mcpServers
      ) {
        return pass('MCP client config', `${client.name} (${client.path})`);
      }
    } catch {
      // File exists but isn't valid JSON — skip to next client
    }
  }

  return warn(
    'MCP client config',
    'no MCP client configured for OpenTabs',
    'Add an "opentabs" entry to ~/.claude/settings/mcp.json (Claude Code) or .cursor/mcp.json (Cursor)',
  );
};

const checkPlugins = async (config: Record<string, unknown> | null): Promise<CheckResult[]> => {
  if (!config) {
    return [warn('Plugins', 'no config to check', 'Create a config file first')];
  }

  const configPath = getConfigPath();
  const pluginPaths = getLocalPluginsFromConfig(config);

  if (pluginPaths.length === 0) {
    return [pass('Local plugins', 'none configured (npm plugins are auto-discovered at startup)')];
  }

  const results: CheckResult[] = [];

  for (const pluginPath of pluginPaths) {
    const resolvedPath = resolvePluginPath(pluginPath, configPath);

    if (!existsSync(resolvedPath)) {
      results.push(fail(`Plugin ${pluginPath}`, 'directory not found', `Check path: ${resolvedPath}`));
      continue;
    }

    const toolsJsonPath = join(resolvedPath, 'dist', TOOLS_FILENAME);
    if (!existsSync(toolsJsonPath)) {
      results.push(
        warn(
          `Plugin ${pluginPath}`,
          `dist/${TOOLS_FILENAME} not found`,
          'Run opentabs-plugin build in the plugin directory',
        ),
      );
      continue;
    }

    const iifePath = join(resolvedPath, 'dist', ADAPTER_FILENAME);
    if (!existsSync(iifePath)) {
      results.push(
        warn(`Plugin ${pluginPath}`, 'adapter IIFE not found', 'Run opentabs-plugin build in the plugin directory'),
      );
      continue;
    }

    let pluginName = pluginPath;
    try {
      const pkgData: unknown = await readJsonFile(join(resolvedPath, 'package.json'));
      if (pkgData !== null && typeof pkgData === 'object' && 'name' in pkgData) {
        const d = pkgData as { name: string };
        pluginName = d.name;
      }
    } catch {
      // package.json unreadable — fall back to path
    }
    results.push(pass(`Plugin ${pluginName}`, `${TOOLS_FILENAME} + IIFE present`));
  }

  return results;
};

const handleDoctor = async (options: DoctorOptions): Promise<void> => {
  const port = resolvePort(options);
  const results: CheckResult[] = [];

  // 1. Bun version
  results.push(checkBunVersion());

  // 2. Config file
  const { result: configResult, config } = await checkConfigFile();
  results.push(configResult);

  // 3. MCP server health
  const secret = config && typeof config.secret === 'string' ? config.secret : null;
  const { result: serverResult, data: healthData } = await checkServerHealth(port, secret);
  results.push(serverResult);

  // 4. Extension connected
  results.push(checkExtensionConnected(healthData));

  // 5. Extension installed
  const { result: installedResult, versionFile } = await checkExtensionInstalled();
  results.push(installedResult);

  // 6. Extension version matches CLI
  results.push(await checkExtensionVersion(versionFile));

  // 7. MCP client config
  results.push(await checkMcpClientConfig());

  // 8. Local plugin checks
  const pluginResults = await checkPlugins(config);
  results.push(...pluginResults);

  // 9. npm plugin health (from server /health data)
  results.push(...checkNpmPlugins(healthData));

  // Print results
  console.log(pc.bold('OpenTabs Doctor'));
  console.log('');

  let hasFatal = false;

  for (const r of results) {
    const icon = r.ok ? pc.green('\u2713') : r.fatal ? pc.red('\u2717') : pc.yellow('!');
    const label = r.ok ? r.label : r.fatal ? pc.red(r.label) : pc.yellow(r.label);
    console.log(`  ${icon} ${label}: ${r.detail}`);
    if (!r.ok && r.hint) {
      console.log(`    ${pc.dim(r.hint)}`);
    }
    if (r.fatal) hasFatal = true;
  }

  console.log('');

  const passed = results.filter(r => r.ok).length;
  const total = results.length;

  if (hasFatal) {
    console.log(pc.red(`${passed}/${total} checks passed. Fix the errors above to proceed.`));
    process.exit(1);
  } else if (passed < total) {
    console.log(pc.yellow(`${passed}/${total} checks passed. Some warnings above may need attention.`));
  } else {
    console.log(pc.green(`All ${total} checks passed. Your OpenTabs setup looks good!`));
  }
};

const registerDoctorCommand = (program: Command): void => {
  program
    .command('doctor')
    .description('Diagnose your OpenTabs setup')
    .option('--port <number>', 'MCP server port to check (default: 9515)', parsePort)
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs doctor
  $ opentabs doctor --port 3000`,
    )
    .action((_options: DoctorOptions, command: Command) => handleDoctor(command.optsWithGlobals()));
};

export {
  checkBunVersion,
  checkConfigFile,
  checkExtensionConnected,
  checkMcpClientConfig,
  checkNpmPlugins,
  checkPlugins,
  checkServerHealth,
  registerDoctorCommand,
};
export type { CheckResult };
