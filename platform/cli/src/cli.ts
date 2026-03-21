#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import {
  handleStatus,
  registerAuditCommand,
  registerConfigCommand,
  registerDoctorCommand,
  registerLogsCommand,
  registerPluginCommand,
  registerStartCommand,
  registerStatusCommand,
  registerStopCommand,
  registerToolCommand,
  registerUpdateCommand,
} from './commands/index.js';
import { parsePort } from './parse-port.js';

const cliDir = dirname(fileURLToPath(import.meta.url));
const pkgJson = JSON.parse(await readFile(join(cliDir, '..', 'package.json'), 'utf-8')) as { version: string };

const program = new Command('opentabs')
  .version(pkgJson.version, '-V, --version')
  .description('OpenTabs — manage your MCP server and plugins')
  .option('--port <number>', 'MCP server port (env: OPENTABS_PORT, default: 9515)', parsePort)
  .showSuggestionAfterError()
  .showHelpAfterError()
  .allowExcessArguments(true)
  .addHelpText(
    'after',
    `\nEnvironment:
  OPENTABS_PORT         MCP server port (overridden by --port)
  OPENTABS_CONFIG_DIR   Config directory (default: ~/.opentabs)`,
  )
  .action((_options, command: Command) => {
    if (command.args.length > 0) {
      // Unknown subcommand typed (e.g. opentabs typo) — delegate to Commander's
      // unknownCommand() to get proper error formatting and did-you-mean suggestion.
      (command as unknown as { unknownCommand: () => never }).unknownCommand();
    }
    return handleStatus(command.optsWithGlobals());
  });

registerStartCommand(program);
registerStopCommand(program);
registerStatusCommand(program);
registerAuditCommand(program);
registerDoctorCommand(program);
registerLogsCommand(program);
registerPluginCommand(program);
registerToolCommand(program);
registerConfigCommand(program);
registerUpdateCommand(program);

await program.parseAsync().catch((err: unknown) => {
  if (!(err instanceof CommanderError)) {
    // Unexpected error — action handlers didn't get a chance to print it.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
  }
  // Action handlers print their own errors and call process.exit(1), which
  // Commander wraps in a CommanderError. Swallow those to avoid double output.
  process.exitCode ??= 1;
});
