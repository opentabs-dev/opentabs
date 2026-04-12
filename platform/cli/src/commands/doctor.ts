/**
 * `opentabs doctor` command — diagnoses the entire OpenTabs setup.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ADAPTER_FILENAME, DEFAULT_HOST, TOOLS_FILENAME } from '@opentabs-dev/shared';
import type { Command } from 'commander';
import pc from 'picocolors';
import {
  getConfigPath,
  getExtensionDir,
  getLocalPluginsFromConfig,
  getPidFilePath,
  parsePidFile,
  readAuthSecret,
  readConfig,
  resolvePluginPath,
} from '../config.js';
import { parsePort, resolvePort } from '../parse-port.js';
import { getCliVersion, getMcpServerVersion } from '../version-info.js';

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

const checkRuntime = (): CheckResult => pass('Runtime', `Node.js ${process.version}`);

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
  const url = `http://${DEFAULT_HOST}:${port}/health`;
  try {
    const headers: Record<string, string> = {};
    if (secret) headers.Authorization = `Bearer ${secret}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(3_000) });
    if (!res.ok) {
      return {
        result: fail('MCP server', `HTTP ${res.status}`, 'Check server logs for errors'),
        data: null,
      };
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.version !== 'string' || typeof data.toolCount !== 'number') {
      const hint = `Stop the other service on port ${port}, or use a different port: opentabs start --port <number>`;
      return {
        result: warn('MCP server', `another service is running on port ${port} (not OpenTabs)`, hint),
        data: null,
      };
    }
    return { result: pass('MCP server', `running (v${data.version}) on port ${port}`), data };
  } catch {
    const portSuffix = port !== 9515 ? ` --port ${port}` : '';
    const hint = `Start it with: opentabs start${portSuffix}`;
    return {
      result: warn('MCP server', 'not reachable', hint),
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
  const versionFile = (await access(versionPath).then(
    () => true,
    () => false,
  ))
    ? await readFile(versionPath, 'utf-8')
    : null;
  return {
    result: pass('Extension installed', extensionDir),
    versionFile: versionFile?.trim() ?? null,
  };
};

const checkExtensionVersion = async (installedVersion: string | null): Promise<CheckResult> => {
  let cliVersion: string;
  try {
    cliVersion = await getCliVersion();
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

const checkMcpServerVersion = async (): Promise<CheckResult> => {
  const cliVersion = await getCliVersion();
  const serverVersion = await getMcpServerVersion();
  if (!serverVersion) {
    return warn('MCP server version', 'could not read version', 'Ensure @opentabs-dev/mcp-server is installed');
  }
  if (serverVersion === cliVersion) {
    return pass('MCP server version', `v${serverVersion} (matches CLI)`);
  }
  return warn(
    'MCP server version',
    `v${serverVersion} (CLI is v${cliVersion})`,
    'Run: npm install -g @opentabs-dev/cli@latest',
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

/**
 * Returns true when the current working directory appears to be a project directory.
 * CWD-relative MCP config paths (e.g. `.cursor/mcp.json`) are only meaningful inside
 * a project, not when CWD is the filesystem root (common in containers).
 */
const isCwdProjectDirectory = (): boolean => {
  const cwd = process.cwd();
  if (cwd === '/') return false;
  return existsSync(join(cwd, 'package.json')) || existsSync(join(cwd, '.git'));
};

const defaultMcpClientLocations = (): McpClientLocation[] => {
  const home = homedir();
  const cwd = process.cwd();
  const cwdIsProject = isCwdProjectDirectory();
  return [
    { name: 'Claude Code', path: join(home, '.claude.json') },
    { name: 'Cursor', path: join(home, '.cursor', 'mcp.json') },
    ...(cwdIsProject ? [{ name: 'Cursor', path: join(cwd, '.cursor', 'mcp.json') }] : []),
    { name: 'OpenCode', path: join(home, '.config', 'opencode', 'opencode.json') },
    ...(cwdIsProject ? [{ name: 'OpenCode', path: join(cwd, 'opencode.json') }] : []),
    { name: 'Windsurf', path: join(home, '.codeium', 'windsurf', 'mcp_config.json') },
  ];
};

const checkMcpClientConfig = async (
  clients: McpClientLocation[] = defaultMcpClientLocations(),
): Promise<CheckResult> => {
  for (const client of clients) {
    if (!existsSync(client.path)) continue;
    try {
      const content = await readFile(client.path, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (parsed !== null && typeof parsed === 'object') {
        const hasMcpServersOpentabs =
          'mcpServers' in parsed &&
          parsed.mcpServers !== null &&
          typeof parsed.mcpServers === 'object' &&
          'opentabs' in parsed.mcpServers;

        const hasMcpOpentabs =
          'mcp' in parsed && parsed.mcp !== null && typeof parsed.mcp === 'object' && 'opentabs' in parsed.mcp;

        if (hasMcpServersOpentabs || hasMcpOpentabs) {
          return pass('MCP client config', `${client.name} (${client.path})`);
        }
      }
    } catch {
      // File exists but isn't valid JSON — skip to next client
    }
  }

  const home = homedir();
  const checkedPaths = clients
    .map(c => {
      const displayPath = c.path.startsWith(home) ? c.path.replace(home, '~') : c.path;
      return `${displayPath} (${c.name})`;
    })
    .join(', ');
  return warn(
    'MCP client config',
    'no MCP client configured for OpenTabs',
    `Add an "opentabs" entry to one of: ${checkedPaths}`,
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
      const pkgData: unknown = JSON.parse(await readFile(join(resolvedPath, 'package.json'), 'utf-8'));
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

const MACOS_BROWSER_PATHS = [
  '/Applications/Google Chrome.app',
  '/Applications/Chromium.app',
  '/Applications/Microsoft Edge.app',
  '/Applications/Brave Browser.app',
];

const LINUX_BROWSER_COMMANDS = ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'];

const checkBrowser = (): CheckResult => {
  const platform = process.platform;

  if (platform === 'darwin') {
    for (const appPath of MACOS_BROWSER_PATHS) {
      if (existsSync(appPath)) {
        const name = appPath.replace('/Applications/', '').replace('.app', '');
        return pass('Browser', name);
      }
    }
    return warn(
      'Browser',
      'no Chromium-based browser found',
      'Install Google Chrome, Microsoft Edge, or Brave from their official websites',
    );
  }

  if (platform === 'linux') {
    for (const cmd of LINUX_BROWSER_COMMANDS) {
      try {
        const result = spawnSync('which', [cmd], { stdio: 'ignore' });
        if (result.status === 0) {
          return pass('Browser', cmd);
        }
      } catch {
        // which failed — try next
      }
    }
    return warn(
      'Browser',
      'no Chromium-based browser found',
      'Install google-chrome, chromium, or microsoft-edge via your package manager',
    );
  }

  if (platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const winPaths = [
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ];
    for (const exePath of winPaths) {
      if (existsSync(exePath)) {
        const name = exePath.includes('Chrome')
          ? 'Google Chrome'
          : exePath.includes('Edge')
            ? 'Microsoft Edge'
            : 'Brave';
        return pass('Browser', name);
      }
    }
    return warn(
      'Browser',
      'no Chromium-based browser found',
      'Install Google Chrome, Microsoft Edge, or Brave from their official websites',
    );
  }

  return warn('Browser', `unsupported platform: ${platform}`, 'Ensure a Chromium-based browser is installed');
};

const checkAuthSecret = async (): Promise<{ result: CheckResult; secret: string | null }> => {
  const secret = await readAuthSecret();
  if (secret) {
    return { result: pass('Auth secret', 'valid'), secret };
  }
  const authPath = join(getExtensionDir(), 'auth.json');
  return {
    result: warn('Auth secret', `missing or invalid at ${authPath}`, 'Run opentabs start to generate auth.json'),
    secret: null,
  };
};

const handleDoctor = async (options: DoctorOptions): Promise<void> => {
  const port = resolvePort(options);
  const results: CheckResult[] = [];

  // 1. Runtime version
  results.push(checkRuntime());

  // 2. Browser
  results.push(checkBrowser());

  // 3. Config file
  const { result: configResult, config } = await checkConfigFile();
  results.push(configResult);

  // 4. Auth secret
  const { result: authResult, secret } = await checkAuthSecret();
  results.push(authResult);

  // 5. MCP server health
  const { result: serverResult, data: healthData } = await checkServerHealth(port, secret);
  let augmentedServerResult = serverResult;
  if (serverResult.ok) {
    const pidPath = getPidFilePath();
    try {
      const pidFileData = parsePidFile(await readFile(pidPath, 'utf-8'));
      if (pidFileData !== null) {
        try {
          process.kill(pidFileData.pid, 0);
          augmentedServerResult = {
            ...serverResult,
            detail: `${serverResult.detail} (background, PID ${pidFileData.pid})`,
          };
        } catch {
          // Stale PID file — clean up silently
          await unlink(pidPath).catch(() => {});
        }
      }
    } catch {
      // No PID file — foreground mode, skip
    }
  }
  results.push(augmentedServerResult);

  // 6. MCP server package version
  results.push(await checkMcpServerVersion());

  // 7. Extension connected
  results.push(checkExtensionConnected(healthData));

  // 8. Extension installed
  const { result: installedResult, versionFile } = await checkExtensionInstalled();
  results.push(installedResult);

  // 9. Extension version matches CLI
  results.push(await checkExtensionVersion(versionFile));

  // 10. MCP client config
  results.push(await checkMcpClientConfig());

  // 11. Local plugin checks
  const pluginResults = await checkPlugins(config);
  results.push(...pluginResults);

  // 12. npm plugin health (from server /health data)
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

export type { CheckResult, McpClientLocation };
export {
  checkAuthSecret,
  checkBrowser,
  checkConfigFile,
  checkExtensionConnected,
  checkMcpClientConfig,
  checkMcpServerVersion,
  checkNpmPlugins,
  checkPlugins,
  checkRuntime,
  checkServerHealth,
  defaultMcpClientLocations,
  isCwdProjectDirectory,
  registerDoctorCommand,
};
