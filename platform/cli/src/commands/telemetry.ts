/**
 * `opentabs telemetry` command group — manage anonymous usage telemetry.
 *
 * Subcommands: status (default), enable, disable.
 */

import { readFile } from 'node:fs/promises';
import { getConfigPath, getTelemetryIdPath } from '@opentabs-dev/shared';
import type { Command } from 'commander';
import pc from 'picocolors';
import { atomicWriteConfig, readConfig } from '../config.js';

/**
 * Determine telemetry status: enabled/disabled and the reason.
 * Returns { enabled, reason } where reason describes why telemetry is in that state.
 */
const getTelemetryStatus = async (): Promise<{ enabled: boolean; reason: string }> => {
  if (process.env.OPENTABS_TELEMETRY_DISABLED === '1') {
    return { enabled: false, reason: 'Disabled via OPENTABS_TELEMETRY_DISABLED environment variable' };
  }
  if (process.env.DO_NOT_TRACK === '1') {
    return { enabled: false, reason: 'Disabled via DO_NOT_TRACK environment variable' };
  }

  const configPath = getConfigPath();
  const result = await readConfig(configPath);
  if (result.config && result.config.telemetry === false) {
    return { enabled: false, reason: 'Disabled via config' };
  }

  return { enabled: true, reason: 'Enabled' };
};

const readAnonymousId = async (): Promise<string | null> => {
  try {
    const id = (await readFile(getTelemetryIdPath(), 'utf-8')).trim();
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
};

const handleTelemetryStatus = async (): Promise<void> => {
  const { enabled, reason } = await getTelemetryStatus();
  const anonymousId = await readAnonymousId();

  console.log(`  ${pc.bold('Telemetry:')}  ${enabled ? pc.green('Enabled') : pc.red('Disabled')}`);
  if (!enabled) {
    console.log(`  ${pc.bold('Reason:')}     ${reason}`);
  }
  if (anonymousId) {
    console.log(`  ${pc.bold('Anonymous ID:')} ${pc.dim(anonymousId)}`);
  }
  console.log('');
  console.log(pc.dim('  Learn more: https://docs.opentabs.dev/telemetry'));
  if (enabled) {
    console.log(pc.dim('  Run `opentabs telemetry disable` to opt out.'));
  } else {
    console.log(pc.dim('  Run `opentabs telemetry enable` to opt in.'));
  }
};

const handleTelemetryEnable = async (): Promise<void> => {
  const configPath = getConfigPath();
  const result = await readConfig(configPath);
  const config = result.config ?? {};
  delete config.telemetry;
  await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(pc.green('Telemetry enabled.'));
  console.log(pc.dim('Anonymous usage data will be collected to help improve OpenTabs.'));
};

const handleTelemetryDisable = async (): Promise<void> => {
  const configPath = getConfigPath();
  const result = await readConfig(configPath);
  const config = result.config ?? {};
  config.telemetry = false;
  await atomicWriteConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(pc.green('Telemetry disabled.'));
  console.log(pc.dim('No telemetry data will be collected.'));
};

const registerTelemetryCommand = (program: Command): void => {
  const telemetry = program
    .command('telemetry')
    .description('Manage anonymous usage telemetry')
    .action(() => handleTelemetryStatus());

  telemetry
    .command('status')
    .description('Show telemetry status')
    .action(() => handleTelemetryStatus());

  telemetry
    .command('enable')
    .description('Enable anonymous telemetry')
    .action(() => handleTelemetryEnable());

  telemetry
    .command('disable')
    .description('Disable anonymous telemetry')
    .action(() => handleTelemetryDisable());
};

export { registerTelemetryCommand };
