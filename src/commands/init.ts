import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { CONFIG_FILE, CLAUDE_SETTINGS, ROOT } from '../config/paths.js';
import { DEFAULT_CONFIG_YAML, HOOK_EVENTS } from '../config/defaults.js';
import { upsertEnvVar } from '../config/env-file.js';

type Transport = 'telegram' | 'discord' | 'slack';

export interface InitOptions {
  hooksOnly?: boolean;
  force?: boolean;
}

type HookEntry = {
  matcher?: string;
  command?: string;
  type?: string;
  hooks?: Array<{ command?: string; type?: string }>;
};

type SettingsShape = { hooks?: Record<string, HookEntry[]>;[k: string]: unknown };

const SEP = '\n────────────────────────────────────────────────────────────\n';
const TICK = '✓';
const CROSS = '✗';

export async function initCommand(opts: InitOptions): Promise<void> {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });

  if (opts.hooksOnly) {
    return registerHooksOnly();
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => {
    console.log('\n\nAborted. Nothing was saved.');
    process.exit(130);
  });

  try {
    printHeader();
    const transport = await pickTransport(rl);
    let token: string | undefined;
    let chatOrChannel: string | undefined;
    let userId: string | undefined;
    let appToken: string | undefined;

    if (transport === 'telegram') {
      const result = await telegramOnboarding(rl);
      token = result.botToken;
      chatOrChannel = result.chatId;
      userId = result.userId;
    } else if (transport === 'discord') {
      const result = await discordOnboarding(rl);
      token = result.botToken;
      chatOrChannel = result.channelId;
      userId = result.userId;
    } else {
      const result = await slackOnboarding(rl);
      appToken = result.appToken;
      token = result.botToken;
      chatOrChannel = result.channelId;
      userId = result.userId;
    }

    section('Step — Saving configuration');
    saveConfig(transport, chatOrChannel!, userId!);
    saveTokens(transport, token, appToken);
    console.log(`${TICK} wrote ${CONFIG_FILE}`);
    console.log(`${TICK} tokens saved to ${path.join(ROOT, 'env')} (perms 0600)`);

    section('Step — Registering hooks in Claude Code');
    await press(rl, 'This wires Stop/Notification/SubagentStop/UserPromptSubmit hooks in ~/.claude/settings.json. Existing hooks are preserved.');
    const registered = registerClaudeHooks();
    console.log(`${TICK} registered ${registered.added} hook(s) in ${CLAUDE_SETTINGS}`);
    if (registered.removed > 0) {
      console.log(`  (cleaned up ${registered.removed} stale claude-beep entry/ies)`);
    }

    section('Step — Start the daemon');
    const startChoice = await choose(rl, 'How do you want to run the daemon?', [
      { key: '1', label: 'Install as a background service (launchd/systemd) — recommended', value: 'service' },
      { key: '2', label: 'Start it now in this terminal (foreground)', value: 'foreground' },
      { key: '3', label: "Skip — I'll start it manually later", value: 'skip' },
    ], '1');

    if (startChoice === 'service') {
      try {
        execFileSync(process.execPath, [process.argv[1], 'service', 'install'], { stdio: 'inherit' });
        execFileSync(process.execPath, [process.argv[1], 'service', 'start'], { stdio: 'inherit' });
        console.log(`${TICK} daemon installed and started under your system supervisor`);
      } catch (err) {
        console.log(`${CROSS} service install failed: ${(err as Error).message}`);
        console.log('  You can run `claude-beep daemon --foreground` manually instead.');
      }
    } else if (startChoice === 'foreground') {
      console.log('Run this in a separate terminal:');
      console.log('  claude-beep daemon --foreground');
    }

    printSuccess(transport);
  } finally {
    rl.close();
  }
}

// ── Telegram ────────────────────────────────────────────────────────────────

async function telegramOnboarding(
  rl: readline.Interface,
): Promise<{ botToken: string; chatId: string; userId: string }> {
  section('Step — Do you already have a Telegram bot?');
  const hasBot = await choose(rl, 'Pick one:', [
    { key: '1', label: 'No, walk me through creating a new one', value: 'new' },
    { key: '2', label: 'Yes, I have a bot already', value: 'existing' },
  ], '1');

  if (hasBot === 'new') {
    section('Step — Create a Telegram bot via @BotFather');
    await press(rl, '1. Open Telegram (phone or desktop).');
    await press(rl, '2. Search for @BotFather. The official one has a blue verified checkmark. Open the chat.');
    await press(rl, '3. Send /start (if you have not before).');
    await press(rl, '4. Send /newbot to BotFather.');
    await press(rl, '5. BotFather asks for a display name — type anything (e.g. "Claude Beep").');
    await press(rl, '6. BotFather asks for a username — it must end in "bot" and be unique (e.g. "yourname_claudebeep_bot").');
    await press(rl, '7. BotFather replies with a token like 1234567890:ABC… Copy it.');
  } else {
    section('Step — Get your bot token from @BotFather');
    await press(rl, 'In @BotFather, send /mybots → pick your bot → API Token. Copy the token.');
  }

  let botToken = '';
  while (!botToken) {
    botToken = (await rl.question('\nPaste the bot token here: ')).trim();
    if (!botToken) continue;
    process.stdout.write('  validating with Telegram… ');
    const ok = await telegramValidate(botToken);
    if (!ok.ok) {
      console.log(`${CROSS} ${ok.error}`);
      botToken = '';
      continue;
    }
    console.log(`${TICK} bot is live: @${ok.username}`);
  }

  section('Step — Open a chat with your bot and send a message');
  await press(rl, '1. Open your bot in Telegram (BotFather gave you a t.me/<botname> link, or search for the username).');
  await press(rl, '2. Tap Start (or send /start).');
  await press(rl, '3. Send any plain message to it (e.g. "hello"). This is the only way Telegram lets us learn your chat ID.');

  let chatId = '';
  let userId = '';
  while (!chatId) {
    process.stdout.write('  looking up your chat ID… ');
    const found = await telegramFetchIds(botToken);
    if (found.error) {
      console.log(`${CROSS} ${found.error}`);
      await press(rl, 'No messages seen yet. Send another message to the bot, then press Enter to retry.');
      continue;
    }
    chatId = found.chatId!;
    userId = found.userId!;
    console.log(`${TICK} found chat_id=${chatId}, user_id=${userId}`);
  }

  section('Step — Send a test message');
  process.stdout.write('  sending test message… ');
  const sent = await telegramSendTest(botToken, chatId);
  if (sent.ok) {
    console.log(`${TICK} test message sent. Open Telegram to confirm you received it.`);
  } else {
    console.log(`${CROSS} ${sent.error}`);
    console.log('  (continuing — you can debug later with `claude-beep tail`)');
  }

  return { botToken, chatId, userId };
}

interface TelegramValidateResult { ok: boolean; username?: string; error?: string }

async function telegramValidate(token: string): Promise<TelegramValidateResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as { ok: boolean; result?: { username: string }; description?: string };
    if (data.ok && data.result) return { ok: true, username: data.result.username };
    return { ok: false, error: data.description ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

interface TelegramIdsResult { chatId?: string; userId?: string; error?: string }

async function telegramFetchIds(token: string): Promise<TelegramIdsResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=10`);
    const data = (await res.json()) as {
      ok: boolean;
      result?: Array<{ message?: { from?: { id: number }; chat?: { id: number } } }>;
    };
    if (!data.ok) return { error: 'Telegram getUpdates returned ok=false' };
    const updates = data.result ?? [];
    const latest = updates.reverse().find((u) => u.message?.chat?.id && u.message?.from?.id);
    if (!latest) return { error: 'no messages yet — send one to your bot first' };
    return {
      chatId: String(latest.message!.chat!.id),
      userId: String(latest.message!.from!.id),
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function telegramSendTest(token: string, chatId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '<b>🎉 claude-beep is connected</b>\n\nYou will see Claude Code notifications here.',
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Discord ────────────────────────────────────────────────────────────────

async function discordOnboarding(
  rl: readline.Interface,
): Promise<{ botToken: string; channelId: string; userId: string }> {
  section('Step — Do you already have a Discord bot?');
  const hasBot = await choose(rl, 'Pick one:', [
    { key: '1', label: 'No, walk me through creating one', value: 'new' },
    { key: '2', label: 'Yes, I already have a bot', value: 'existing' },
  ], '1');

  if (hasBot === 'new') {
    section('Step — Create the Discord application + bot');
    await press(rl, '1. Open https://discord.com/developers/applications and sign in.');
    await press(rl, '2. Click "New Application". Name it (e.g. "Claude Beep") and create.');
    await press(rl, '3. In the left sidebar, click the "Bot" tab.');
    await press(rl, '4. Under "Privileged Gateway Intents", enable MESSAGE CONTENT INTENT. Click "Save Changes".');
    await press(rl, '5. Click "Reset Token" → confirm. Copy the new token (shown only once).');

    section('Step — Invite the bot to your server');
    await press(rl, '1. In the dev portal, open "OAuth2 → URL Generator".');
    await press(rl, '2. Scopes: check "bot" and "applications.commands".');
    await press(rl, '3. Bot Permissions: check View Channels, Send Messages, Read Message History, Embed Links.');
    await press(rl, '4. Copy the generated URL at the bottom, open it in a browser.');
    await press(rl, '5. Pick your server → Authorize.');

    section('Step — Get channel + user IDs');
    await press(rl, '1. In the Discord app: User Settings → Advanced → enable Developer Mode.');
    await press(rl, '2. Right-click the channel where you want notifications → Copy Channel ID.');
    await press(rl, '3. Right-click your own name (in any message) → Copy User ID.');
  } else {
    section('Step — Have your token, channel ID, and user ID ready');
    await press(rl, 'You will need: the bot token (dev portal → Bot tab), the channel ID, and your Discord user ID.');
  }

  let botToken = '';
  while (!botToken) botToken = (await rl.question('\nPaste the Discord bot token: ')).trim();

  let channelId = '';
  while (!channelId) channelId = (await rl.question('Paste the channel ID: ')).trim();

  let userId = '';
  while (!userId) userId = (await rl.question('Paste your Discord user ID: ')).trim();

  return { botToken, channelId, userId };
}

// ── Slack ───────────────────────────────────────────────────────────────────

async function slackOnboarding(
  rl: readline.Interface,
): Promise<{ appToken: string; botToken: string; channelId: string; userId: string }> {
  section('Step — Do you already have a Slack app?');
  const hasBot = await choose(rl, 'Pick one:', [
    { key: '1', label: 'No, walk me through creating one', value: 'new' },
    { key: '2', label: 'Yes, I already have an app', value: 'existing' },
  ], '1');

  if (hasBot === 'new') {
    section('Step — Create the Slack app');
    await press(rl, '1. Open https://api.slack.com/apps → "Create New App" → "From scratch".');
    await press(rl, '2. Name it (e.g. "Claude Beep"). Pick your workspace. → Create App.');

    section('Step — Enable Socket Mode and get the app-level token');
    await press(rl, '1. In the left sidebar, click "Socket Mode" → toggle Enable Socket Mode on.');
    await press(rl, '2. When prompted, generate an App-Level Token with scope "connections:write".');
    await press(rl, '3. Copy the token (starts with xapp-).');

    section('Step — Add bot scopes');
    await press(rl, '1. Left sidebar → "OAuth & Permissions".');
    await press(rl, '2. Bot Token Scopes → add: chat:write, channels:history, im:history, app_mentions:read');

    section('Step — Subscribe to events');
    await press(rl, '1. Left sidebar → "Event Subscriptions" → toggle Enable Events on.');
    await press(rl, '2. Subscribe to bot events: message.channels, app_mention');

    section('Step — Install the app and get the bot token');
    await press(rl, '1. Left sidebar → "Install App" → "Install to Workspace" → Approve.');
    await press(rl, '2. Copy the Bot User OAuth Token (starts with xoxb-).');

    section('Step — Find channel + user IDs and invite the bot');
    await press(rl, '1. In Slack, click the channel name at the top → About tab → bottom shows Channel ID.');
    await press(rl, '2. Click your avatar → Profile → kebab menu → Copy member ID.');
    await press(rl, '3. In the channel, run: /invite @your-bot');
  } else {
    section('Step — Have your tokens and IDs ready');
    await press(rl, 'You will need: app token (xapp-), bot token (xoxb-), channel ID, your member ID.');
  }

  let appToken = '';
  while (!appToken) appToken = (await rl.question('\nPaste the app-level token (xapp-…): ')).trim();
  let botToken = '';
  while (!botToken) botToken = (await rl.question('Paste the bot token (xoxb-…): ')).trim();
  let channelId = '';
  while (!channelId) channelId = (await rl.question('Paste the channel ID: ')).trim();
  let userId = '';
  while (!userId) userId = (await rl.question('Paste your Slack member ID (U…): ')).trim();

  return { appToken, botToken, channelId, userId };
}

// ── Config / tokens / hooks ─────────────────────────────────────────────────

function saveConfig(transport: Transport, target: string, userId: string): void {
  const text = fs.existsSync(CONFIG_FILE)
    ? fs.readFileSync(CONFIG_FILE, 'utf8')
    : DEFAULT_CONFIG_YAML;
  const doc = YAML.parseDocument(text);
  doc.setIn(['default_transport'], transport);

  if (transport === 'telegram') {
    doc.setIn(['transports', 'telegram', 'bot_token_env'], 'TELEGRAM_BOT_TOKEN');
    doc.setIn(['transports', 'telegram', 'default_chat_id'], target);
    const senders = new YAML.YAMLSeq();
    senders.add(userId);
    doc.setIn(['transports', 'telegram', 'allowed_senders'], senders);
  } else if (transport === 'discord') {
    doc.setIn(['transports', 'discord', 'bot_token_env'], 'DISCORD_BOT_TOKEN');
    doc.setIn(['transports', 'discord', 'default_channel_id'], target);
    const senders = new YAML.YAMLSeq();
    senders.add(userId);
    doc.setIn(['transports', 'discord', 'allowed_senders'], senders);
  } else {
    doc.setIn(['transports', 'slack', 'app_token_env'], 'SLACK_APP_TOKEN');
    doc.setIn(['transports', 'slack', 'bot_token_env'], 'SLACK_BOT_TOKEN');
    doc.setIn(['transports', 'slack', 'default_channel_id'], target);
    const senders = new YAML.YAMLSeq();
    senders.add(userId);
    doc.setIn(['transports', 'slack', 'allowed_senders'], senders);
  }

  // Ensure a catch-all route exists.
  const routing = doc.get('routing');
  if (!routing || !(routing as YAML.YAMLSeq).items?.length) {
    const seq = new YAML.YAMLSeq();
    const entry = new YAML.YAMLMap();
    const match = new YAML.YAMLMap();
    match.set('cwd', '**');
    entry.set('match', match);
    entry.set('transport', transport);
    seq.add(entry);
    doc.set('routing', seq);
  }

  fs.writeFileSync(CONFIG_FILE, doc.toString());
}

function saveTokens(transport: Transport, token?: string, appToken?: string): void {
  if (transport === 'telegram' && token) upsertEnvVar('TELEGRAM_BOT_TOKEN', token);
  if (transport === 'discord' && token) upsertEnvVar('DISCORD_BOT_TOKEN', token);
  if (transport === 'slack') {
    if (appToken) upsertEnvVar('SLACK_APP_TOKEN', appToken);
    if (token) upsertEnvVar('SLACK_BOT_TOKEN', token);
  }
}

function isClaudeBeepEntry(entry: HookEntry | undefined): boolean {
  if (!entry) return false;
  if (typeof entry.command === 'string' && entry.command.startsWith('claude-beep hook ')) {
    return true;
  }
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some(
      (h) => typeof h?.command === 'string' && h.command.startsWith('claude-beep hook '),
    );
  }
  return false;
}

export function registerClaudeHooks(): { added: number; removed: number } {
  let settings: SettingsShape = {};
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    } catch {
      throw new Error(`could not parse ${CLAUDE_SETTINGS}`);
    }
  } else {
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  }

  settings.hooks = settings.hooks ?? {};
  let added = 0;
  let removed = 0;
  for (const event of HOOK_EVENTS) {
    const slug = event.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const cmd = `claude-beep hook ${slug}`;
    const existing = settings.hooks[event] ?? [];
    const filtered = existing.filter((entry) => !isClaudeBeepEntry(entry));
    removed += existing.length - filtered.length;
    settings.hooks[event] = [...filtered, { hooks: [{ type: 'command', command: cmd }] }];
    added += 1;
  }
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
  return { added, removed };
}

// Legacy non-wizard mode for scripts / power users.
function registerHooksOnly(): void {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, DEFAULT_CONFIG_YAML);
    console.log(`wrote config: ${CONFIG_FILE}`);
  }
  const result = registerClaudeHooks();
  console.log(`registered ${result.added} hook(s) in: ${CLAUDE_SETTINGS}`);
  if (result.removed > 0) console.log(`cleaned up ${result.removed} stale entry/ies`);
  console.log('\nNext: configure a transport with `claude-beep config` or run `claude-beep init` for the full wizard.');
}

// ── UI helpers ──────────────────────────────────────────────────────────────

function printHeader(): void {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║       claude-beep — onboarding wizard        ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('  This will set up Claude Code → chat notifications and replies.');
  console.log('  Press Ctrl-C any time to abort. Nothing is saved until the final step.');
  console.log('');
}

function section(title: string): void {
  console.log(SEP);
  console.log(`  ${title}`);
  console.log('');
}

async function press(rl: readline.Interface, instruction: string): Promise<void> {
  console.log(`  ${instruction}`);
  await rl.question('  [press Enter to continue] ');
}

async function pickTransport(rl: readline.Interface): Promise<Transport> {
  section('Step — Pick a chat platform');
  return (await choose(rl, 'Where do you want notifications to go?', [
    { key: '1', label: 'Telegram (easiest setup — recommended)', value: 'telegram' },
    { key: '2', label: 'Discord', value: 'discord' },
    { key: '3', label: 'Slack', value: 'slack' },
  ], '1')) as Transport;
}

async function choose<T extends string>(
  rl: readline.Interface,
  prompt: string,
  options: Array<{ key: string; label: string; value: T }>,
  defaultKey: string,
): Promise<T> {
  console.log(`  ${prompt}`);
  for (const o of options) {
    console.log(`    [${o.key}] ${o.label}${o.key === defaultKey ? '  (default)' : ''}`);
  }
  while (true) {
    const ans = (await rl.question(`  Your choice [${defaultKey}]: `)).trim() || defaultKey;
    const found = options.find((o) => o.key === ans);
    if (found) return found.value;
    console.log(`  '${ans}' is not a valid choice. Pick one of: ${options.map((o) => o.key).join(', ')}`);
  }
}

function printSuccess(transport: Transport): void {
  console.log(SEP);
  console.log('  🎉 Setup complete!');
  console.log('');
  console.log(`  Outbound + inbound transport: ${transport}`);
  console.log(`  Config:  ${CONFIG_FILE}`);
  console.log(`  Logs:    ~/.claude-beep/logs/daemon.log`);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Open a new terminal');
  console.log('    2. Launch Claude through the wrapper:');
  console.log('         claude-beep run --name myproj -- claude');
  console.log('    3. Use Claude normally. When a turn finishes, you get a chat notification.');
  console.log('    4. Reply in chat to inject input back into the session.');
  console.log('');
  console.log('  Bot commands you can send in chat:  /sessions  /status  /help');
  console.log('');
  console.log('  See ./docs/ for transport-specific guides and troubleshooting.');
  console.log('');
}
