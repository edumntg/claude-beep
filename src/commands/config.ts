import fs from 'node:fs';
import readline from 'node:readline/promises';
import YAML from 'yaml';
import { CONFIG_FILE, ROOT } from '../config/paths.js';
import { DEFAULT_CONFIG_YAML } from '../config/defaults.js';
import { upsertEnvVar, ENV_FILE, readEnvFile } from '../config/env-file.js';

type Transport = 'telegram' | 'discord' | 'slack';

export interface ConfigCommandOptions {
  transport?: Transport;
  botToken?: string;
  appToken?: string;
  chatId?: string;
  channelId?: string;
  allowedSenders?: string;
  show?: boolean;
  pastebinEnable?: boolean;
  pastebinDisable?: boolean;
  pastebinProvider?: 'dpaste' | 'gist';
  githubToken?: string;
}

export async function configCommand(opts: ConfigCommandOptions): Promise<void> {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });

  if (opts.show) {
    return showCurrentConfig();
  }

  // Pastebin-only operation (no transport flags provided)
  const pastebinOnly =
    !opts.transport &&
    !opts.botToken &&
    !opts.appToken &&
    !opts.chatId &&
    !opts.channelId &&
    !opts.allowedSenders &&
    (opts.pastebinEnable ||
      opts.pastebinDisable ||
      opts.pastebinProvider ||
      opts.githubToken);

  if (pastebinOnly) {
    applyPastebinUpdate(opts);
    if (opts.githubToken) upsertEnvVar('GITHUB_TOKEN', opts.githubToken);
    return;
  }

  const filled = await collectInputs(opts);
  applyConfig(filled);
  applyTokens(filled);
  applyPastebinUpdate(opts);
  if (opts.githubToken) upsertEnvVar('GITHUB_TOKEN', opts.githubToken);
  await validateAndReport(filled);

  console.log('');
  console.log('Next:');
  console.log('  claude-beep daemon --foreground   # try it now');
  console.log('  claude-beep service install       # or install as a background service');
}

function applyPastebinUpdate(opts: ConfigCommandOptions): void {
  if (
    opts.pastebinEnable === undefined &&
    opts.pastebinDisable === undefined &&
    opts.pastebinProvider === undefined
  ) {
    return;
  }
  const text = fs.existsSync(CONFIG_FILE)
    ? fs.readFileSync(CONFIG_FILE, 'utf8')
    : DEFAULT_CONFIG_YAML;
  const doc = YAML.parseDocument(text);
  if (opts.pastebinEnable) doc.setIn(['pastebin', 'enabled'], true);
  if (opts.pastebinDisable) doc.setIn(['pastebin', 'enabled'], false);
  if (opts.pastebinProvider) doc.setIn(['pastebin', 'provider'], opts.pastebinProvider);
  fs.writeFileSync(CONFIG_FILE, doc.toString());
  const state = [];
  if (opts.pastebinEnable) state.push('enabled');
  if (opts.pastebinDisable) state.push('disabled');
  if (opts.pastebinProvider) state.push(`provider=${opts.pastebinProvider}`);
  console.log(`✓ updated pastebin: ${state.join(', ')}`);
}

interface FilledInputs {
  transport: Transport;
  botToken?: string;
  appToken?: string;
  targetId: string;
  allowedSenders: string[];
}

async function collectInputs(opts: ConfigCommandOptions): Promise<FilledInputs> {
  const cliMode = !!(opts.transport || opts.botToken || opts.chatId || opts.channelId);

  if (cliMode) {
    return collectFromFlags(opts);
  }
  return collectInteractive();
}

function collectFromFlags(opts: ConfigCommandOptions): FilledInputs {
  const transport = (opts.transport ?? 'telegram') as Transport;
  const targetId =
    transport === 'telegram'
      ? opts.chatId
      : opts.channelId;
  if (!targetId) {
    throw new Error(
      transport === 'telegram'
        ? '--chat-id is required for telegram (or use `claude-beep config` for interactive mode)'
        : '--channel-id is required for discord/slack',
    );
  }
  const allowedSenders = parseAllowedSenders(opts.allowedSenders, targetId);
  return {
    transport,
    botToken: opts.botToken,
    appToken: opts.appToken,
    targetId,
    allowedSenders,
  };
}

async function collectInteractive(): Promise<FilledInputs> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('claude-beep config wizard');
    console.log('Press Ctrl-C to cancel at any time.');
    console.log('');

    const transportAns = (await rl.question('Transport [telegram/discord/slack] (telegram): ')).trim().toLowerCase();
    const transport = (transportAns || 'telegram') as Transport;
    if (!['telegram', 'discord', 'slack'].includes(transport)) {
      throw new Error(`unknown transport: ${transport}`);
    }

    if (transport === 'telegram') {
      console.log('');
      console.log('Get a bot token from @BotFather in Telegram. See TELEGRAM.md for details.');
      const botToken = (await rl.question('Bot token: ')).trim();
      const chatId = (await rl.question('Chat ID (where notifications post): ')).trim();
      if (!chatId) throw new Error('chat ID is required');
      const sendersAns = (
        await rl.question(`Allowed sender IDs (Enter = same as chat ID, comma-separated for multiple): `)
      ).trim();
      const allowedSenders = parseAllowedSenders(sendersAns, chatId);
      return { transport, botToken: botToken || undefined, targetId: chatId, allowedSenders };
    }

    if (transport === 'discord') {
      console.log('');
      console.log('Get a bot token from the Discord developer portal. See README.md.');
      const botToken = (await rl.question('Bot token: ')).trim();
      const channelId = (await rl.question('Channel ID (where notifications post): ')).trim();
      if (!channelId) throw new Error('channel ID is required');
      const sendersAns = (await rl.question(`Allowed user IDs (comma-separated): `)).trim();
      const allowedSenders = parseAllowedSenders(sendersAns, '');
      return { transport, botToken: botToken || undefined, targetId: channelId, allowedSenders };
    }

    // slack
    console.log('');
    console.log('Get app+bot tokens from your Slack app. See README.md.');
    const appToken = (await rl.question('App token (xapp-...): ')).trim();
    const botToken = (await rl.question('Bot token (xoxb-...): ')).trim();
    const channelId = (await rl.question('Channel ID (where notifications post): ')).trim();
    if (!channelId) throw new Error('channel ID is required');
    const sendersAns = (await rl.question(`Allowed user IDs (comma-separated, format U...): `)).trim();
    const allowedSenders = parseAllowedSenders(sendersAns, '');
    return {
      transport: 'slack',
      botToken: botToken || undefined,
      appToken: appToken || undefined,
      targetId: channelId,
      allowedSenders,
    };
  } finally {
    rl.close();
  }
}

function parseAllowedSenders(raw: string | undefined, fallback: string): string[] {
  if (!raw || !raw.trim()) {
    return fallback ? [fallback] : [];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function applyConfig(input: FilledInputs): void {
  const text = fs.existsSync(CONFIG_FILE)
    ? fs.readFileSync(CONFIG_FILE, 'utf8')
    : DEFAULT_CONFIG_YAML;
  const doc = YAML.parseDocument(text);

  doc.setIn(['default_transport'], input.transport);

  if (input.transport === 'telegram') {
    doc.setIn(['transports', 'telegram', 'bot_token_env'], 'TELEGRAM_BOT_TOKEN');
    doc.setIn(['transports', 'telegram', 'default_chat_id'], input.targetId);
    const senders = new YAML.YAMLSeq();
    for (const s of input.allowedSenders) senders.add(s);
    doc.setIn(['transports', 'telegram', 'allowed_senders'], senders);
  } else if (input.transport === 'discord') {
    doc.setIn(['transports', 'discord', 'bot_token_env'], 'DISCORD_BOT_TOKEN');
    doc.setIn(['transports', 'discord', 'default_channel_id'], input.targetId);
    const senders = new YAML.YAMLSeq();
    for (const s of input.allowedSenders) senders.add(s);
    doc.setIn(['transports', 'discord', 'allowed_senders'], senders);
  } else if (input.transport === 'slack') {
    doc.setIn(['transports', 'slack', 'app_token_env'], 'SLACK_APP_TOKEN');
    doc.setIn(['transports', 'slack', 'bot_token_env'], 'SLACK_BOT_TOKEN');
    doc.setIn(['transports', 'slack', 'default_channel_id'], input.targetId);
    const senders = new YAML.YAMLSeq();
    for (const s of input.allowedSenders) senders.add(s);
    doc.setIn(['transports', 'slack', 'allowed_senders'], senders);
  }

  ensureCatchAllRoute(doc, input.transport);

  fs.writeFileSync(CONFIG_FILE, doc.toString());
  console.log(`✓ wrote ${CONFIG_FILE}`);
}

function ensureCatchAllRoute(doc: YAML.Document, transport: Transport): void {
  const routing = doc.get('routing');
  if (!routing || !(routing as YAML.YAMLSeq).items || (routing as YAML.YAMLSeq).items.length === 0) {
    const seq = new YAML.YAMLSeq();
    const entry = new YAML.YAMLMap();
    const match = new YAML.YAMLMap();
    match.set('cwd', '**');
    entry.set('match', match);
    entry.set('transport', transport);
    seq.add(entry);
    doc.set('routing', seq);
  }
}

function applyTokens(input: FilledInputs): void {
  let saved = 0;
  if (input.transport === 'telegram' && input.botToken) {
    upsertEnvVar('TELEGRAM_BOT_TOKEN', input.botToken);
    saved += 1;
  }
  if (input.transport === 'discord' && input.botToken) {
    upsertEnvVar('DISCORD_BOT_TOKEN', input.botToken);
    saved += 1;
  }
  if (input.transport === 'slack') {
    if (input.appToken) {
      upsertEnvVar('SLACK_APP_TOKEN', input.appToken);
      saved += 1;
    }
    if (input.botToken) {
      upsertEnvVar('SLACK_BOT_TOKEN', input.botToken);
      saved += 1;
    }
  }
  if (saved > 0) {
    console.log(`✓ saved ${saved} token(s) to ${ENV_FILE} (perms 0600)`);
  } else {
    console.log(
      `(no token provided — set the relevant env var manually or rerun with --bot-token)`,
    );
  }
}

async function validateAndReport(input: FilledInputs): Promise<void> {
  if (input.transport !== 'telegram' || !input.botToken) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${input.botToken}/getMe`);
    const data = (await res.json()) as { ok: boolean; result?: { username: string }; description?: string };
    if (data.ok && data.result) {
      console.log(`✓ bot validated: @${data.result.username}`);
    } else {
      console.log(`✗ bot token did not validate: ${data.description ?? 'unknown error'}`);
    }
  } catch (err) {
    console.log(`(skipped validation: ${(err as Error).message})`);
  }
}

function showCurrentConfig(): void {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log(`no config at ${CONFIG_FILE}`);
    console.log(`run \`claude-beep config\` to set one up`);
    return;
  }

  const yaml = fs.readFileSync(CONFIG_FILE, 'utf8');
  const doc = YAML.parseDocument(yaml);
  const env = readEnvFile();

  printStatusSummary(doc, env);
  console.log('');
  console.log(`# ${CONFIG_FILE}`);
  console.log(yaml.trimEnd());
  console.log('');
  console.log(`# ${ENV_FILE}`);
  if (Object.keys(env).length === 0) {
    console.log('(empty — no tokens stored)');
  } else {
    for (const k of Object.keys(env)) {
      const v = env[k];
      const masked = v.length <= 6 ? '***' : v.slice(0, 6) + '…' + v.slice(-4);
      console.log(`${k}=${masked}`);
    }
  }
}

function printStatusSummary(doc: YAML.Document, env: Record<string, string>): void {
  const get = (path: string[]): unknown => doc.getIn(path);
  const transports: Array<{ name: 'telegram' | 'discord' | 'slack'; targetKey: string }> = [
    { name: 'telegram', targetKey: 'default_chat_id' },
    { name: 'discord', targetKey: 'default_channel_id' },
    { name: 'slack', targetKey: 'default_channel_id' },
  ];

  console.log('claude-beep config');
  console.log('==================');
  console.log('');
  console.log('Transports:');
  for (const t of transports) {
    const block = get(['transports', t.name]);
    if (!block) {
      console.log(`  ${pad(t.name, 9)}  not configured`);
      continue;
    }
    const target = String(get(['transports', t.name, t.targetKey]) ?? '');
    const sendersNode = doc.getIn(['transports', t.name, 'allowed_senders']) as
      | { items?: unknown[] }
      | undefined;
    const senderCount = Array.isArray(sendersNode?.items) ? sendersNode.items.length : 0;
    const tokenNames =
      t.name === 'slack'
        ? [String(get(['transports', 'slack', 'app_token_env']) ?? 'SLACK_APP_TOKEN'),
           String(get(['transports', 'slack', 'bot_token_env']) ?? 'SLACK_BOT_TOKEN')]
        : [String(get(['transports', t.name, 'bot_token_env']) ?? '')];
    const haveAllTokens = tokenNames.every(
      (n) => n && (env[n] !== undefined || (process.env[n] && process.env[n] !== '')),
    );
    const tokenStatus = haveAllTokens ? 'token saved' : 'token missing';
    const targetLabel = target
      ? `target=${target}`
      : `target=(empty — run \`claude-beep config\`)`;
    console.log(
      `  ${pad(t.name, 9)}  ${tokenStatus}, ${targetLabel}, allowed_senders=${senderCount}`,
    );
  }

  const pasteEnabled = doc.getIn(['pastebin', 'enabled']);
  const pasteProvider = doc.getIn(['pastebin', 'provider']) ?? 'dpaste';
  console.log('');
  console.log(`Pastebin: ${pasteEnabled ? `enabled (${pasteProvider})` : 'disabled'}`);

  console.log('');
  console.log('Files:');
  console.log(`  config: ${CONFIG_FILE}`);
  console.log(
    `  env:    ${ENV_FILE} ${Object.keys(env).length > 0 ? `(${Object.keys(env).length} token(s) saved, 0600)` : '(empty)'}`,
  );
  console.log('');
  console.log(
    'Tokens are read from the env file automatically by the daemon — no shell export needed.',
  );
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
