#!/usr/bin/env node

import {
  registerAuditCommand,
  registerConfigCommand,
  registerDoctorCommand,
  registerLogsCommand,
  registerPluginCommand,
  registerStartCommand,
  registerStatusCommand,
  registerUpdateCommand,
} from './commands/index.js';
import { parsePort } from './parse-port.js';
import { readFile } from '@opentabs-dev/shared';
import { Command } from 'commander';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = dirname(fileURLToPath(import.meta.url));
const pkgJson = JSON.parse(await readFile(join(cliDir, '..', 'package.json'))) as { version: string };

const program = new Command('opentabs')
  .version(pkgJson.version, '-V, --version')
  .description('OpenTabs — manage your MCP server and plugins')
  .option('--port <number>', 'MCP server port (env: OPENTABS_PORT, default: 9515)', parsePort)
  .addHelpText(
    'after',
    `\nEnvironment:
  OPENTABS_PORT         MCP server port (overridden by --port)
  OPENTABS_CONFIG_DIR   Config directory (default: ~/.opentabs)`,
  )
  .action(() => {
    program.help();
  });

registerStartCommand(program);
registerStatusCommand(program);
registerAuditCommand(program);
registerDoctorCommand(program);
registerLogsCommand(program);
registerPluginCommand(program);
registerConfigCommand(program);
registerUpdateCommand(program);

await program.parseAsync();
