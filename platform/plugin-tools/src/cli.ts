#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerBuildCommand, registerInspectCommand, registerReadmeCommand } from './commands/index.js';

const cliDir = dirname(fileURLToPath(import.meta.url));
const pkgJson = JSON.parse(await readFile(join(cliDir, '..', 'package.json'), 'utf-8')) as { version: string };

const program = new Command('opentabs-plugin')
  .version(pkgJson.version, '-V, --version')
  .description('OpenTabs plugin tools — build and validate plugins')
  .action(() => {
    program.help();
  });

registerBuildCommand(program);
registerInspectCommand(program);
registerReadmeCommand(program);

await program.parseAsync();
