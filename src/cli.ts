#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { hookCommand } from './commands/hook.js';
import { daemonCommand } from './commands/daemon.js';
import { runCommand } from './commands/run.js';
import { statusCommand } from './commands/status.js';
import { tailCommand } from './commands/tail.js';
import { serviceCommand } from './commands/service.js';
import { configCommand } from './commands/config.js';

const argv = process.argv.slice(2);
const runIdx = argv.indexOf('run');
const beforeRunIsClean = runIdx >= 0 && argv.slice(0, runIdx).every((a) => !a.startsWith('-'));

if (runIdx >= 0 && beforeRunIsClean) {
  const after = argv.slice(runIdx + 1);
  let name: string | undefined;
  for (let i = 0; i < after.length; ) {
    const a = after[i];
    if (a === '--') break;
    if (a === '--name' && i + 1 < after.length) {
      name = after[i + 1];
      after.splice(i, 2);
      continue;
    }
    if (a.startsWith('--name=')) {
      name = a.slice('--name='.length);
      after.splice(i, 1);
      continue;
    }
    i += 1;
  }
  const sep = after.indexOf('--');
  const passthrough = sep >= 0 ? after.slice(sep + 1) : after;
  runCommand(passthrough, { name });
} else {
  const program = new Command();

  program
    .name('claude-beep')
    .description('Two-way notifications for Claude Code via Telegram, Discord, and Slack')
    .version('1.0.0');

  program
    .command('init')
    .description('Interactive onboarding wizard — picks a transport, walks through bot creation, registers hooks, optionally installs the service')
    .option('--hooks-only', 'skip the wizard and only register Claude Code hooks (advanced)')
    .option('--force', 'overwrite existing config in --hooks-only mode')
    .action(initCommand);

  program
    .command('config')
    .description('Configure a transport or pastebin (interactive wizard if no flags)')
    .option('--transport <name>', 'telegram | discord | slack')
    .option('--bot-token <token>', 'bot token (saved to ~/.claude-beep/env)')
    .option('--app-token <token>', 'app-level token (slack only)')
    .option('--chat-id <id>', 'Telegram chat ID')
    .option('--channel-id <id>', 'Discord/Slack channel ID')
    .option('--allowed-senders <ids>', 'comma-separated list of allowed sender IDs')
    .option('--pastebin-enable', 'enable pastebin uploads for long excerpts')
    .option('--pastebin-disable', 'disable pastebin uploads')
    .option('--pastebin-provider <name>', 'dpaste | gist')
    .option('--github-token <token>', 'GitHub PAT (gist scope) — saved to env, used by gist provider')
    .option('--show', 'print current config and saved env (tokens masked)')
    .action(configCommand);

  program
    .command('hook <event>')
    .description('Hook entry point invoked by Claude Code (reads JSON event from stdin)')
    .action(hookCommand);

  program
    .command('daemon')
    .description('Run the long-running claude-beep daemon')
    .option('--foreground', 'run in foreground (do not detach)')
    .option('--dry-run', 'log messages instead of calling chat APIs')
    .action(daemonCommand);

  program
    .command('run')
    .description('Spawn a child in a PTY and bridge it to the daemon (usage: claude-beep run -- <cmd> [args...])')
    .action(() => {
      console.error('usage: claude-beep run -- <command> [args...]');
      process.exit(2);
    });

  program
    .command('status')
    .description('Print live daemon state (pid, uptime, sessions, transports)')
    .action(statusCommand);

  program
    .command('tail')
    .description('Follow the daemon log (Ctrl-C to exit)')
    .option('-n, --lines <count>', 'number of lines of history to print first', '20')
    .action(tailCommand);

  program
    .command('service <action>')
    .description('Install, start, stop, or uninstall a launchd/systemd unit (action: install|start|stop|uninstall|status)')
    .action(serviceCommand);

  program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
