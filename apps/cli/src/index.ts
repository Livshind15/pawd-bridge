#!/usr/bin/env node
import { Command } from 'commander';
import { installCommand } from './commands/install.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { pairCommand } from './commands/pair.js';
import { devCommand } from './commands/dev.js';

const program = new Command();

program
  .name('pawd')
  .description('Pawd CLI — install, manage, and monitor the Pawd bridge')
  .version('1.0.0');

program.addCommand(installCommand());
program.addCommand(startCommand());
program.addCommand(stopCommand());
program.addCommand(statusCommand());
program.addCommand(logsCommand());
program.addCommand(pairCommand());
program.addCommand(devCommand());

program.parse();
