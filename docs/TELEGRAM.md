# TELEGRAM.md — Telegram setup and end-to-end testing

This guide walks you from "I've never created a Telegram bot" to "Claude Code notifies me in Telegram and I can reply from my phone." Allow **~15 minutes**.

---

## First — does this send messages to my personal Telegram?

**No, not directly.** Telegram bots are **separate accounts** from your personal one. Here's the model:

1. You create a **bot account** through Telegram's official `@BotFather`. The bot has its own username (e.g. `@MyClaudeBeepBot`) and its own API token.
2. You **start a conversation** with that bot from your personal account (one tap on a link, or `/start`). This tells the bot what your `chat_id` is.
3. `claude-beep` talks to **Telegram's API as the bot**, posting messages to that chat. You see them in your normal Telegram app as messages from `@MyClaudeBeepBot`.
4. When you reply in that chat, `claude-beep` reads the reply (because the bot received it) and injects the text back into your Claude Code session.

So:
- Your **personal account is never used** as a sender or receiver of API calls.
- The bot **cannot message you out of nowhere** — you must start the conversation first (Telegram rule).
- The bot **only sees messages you send it** (or `@`-mention it in a group). It cannot read your other chats.
- You can also add the bot to a **group**, in which case notifications post to the group and any allow-listed member can reply.

The end result is that you get a new chat in your Telegram app called `MyClaudeBeepBot` (or whatever you named it), and that's where Claude pings you.

---

## What you need before starting

- The Telegram app installed and logged in on your phone, desktop, or both.
- A working `claude-beep` install. From the repo root:
  ```bash
  $ cd /Users/eduardo/Desktop/Repositories/claude-beep
  $ npm install
  $ npm run build
  $ npm link            # puts `claude-beep` on your PATH
  $ claude-beep --version
  → 0.1.0
  ```
- An isolated state directory for testing (recommended, so you don't disturb your real config):
  ```bash
  $ export CLAUDE_BEEP_HOME=$HOME/cb-testing
  $ mkdir -p "$CLAUDE_BEEP_HOME"
  ```

---

## Step 1 — Create the bot

1. Open Telegram and search for the user **`@BotFather`**. The official one has a blue verified checkmark next to its name. Open the chat.
2. Send `/start` if it's your first time talking to BotFather. It will reply with a menu of commands.
3. Send `/newbot`.
4. BotFather asks for a **display name**. Type whatever you want, e.g. `Claude Beep`. This is what you'll see in your chat list.
5. BotFather asks for a **username**. It must end in `bot` and be globally unique. Try something like `eduardo_claudebeep_bot`. If it's taken, try variations.
6. BotFather replies with a message that includes a line like:
   ```
   Use this token to access the HTTP API:
   1234567890:ABCdefGHIJklmNOPQRstuVWXyz123456789
   ```
   **This token is the password to your bot. Treat it like a private key.** Anyone with this token can post messages as your bot.
7. Copy the token. We'll use it in step 3.

Optional but recommended: in the same BotFather chat, send `/setdescription` to give the bot a description, and `/setuserpic` to set an avatar. Cosmetic; skip if you don't care.

---

## Step 2 — Start a conversation with your bot

The Telegram API rule: a bot can only message users who have messaged it first.

1. In BotFather's reply (step 1.6), BotFather also gives you a `t.me` link to your bot, like `https://t.me/eduardo_claudebeep_bot`. Open it.
2. Telegram opens the bot's chat. Tap **Start** at the bottom (or send `/start`).
3. Your bot won't reply yet (it has no code listening to it). That's fine — the goal here is just to register the chat with Telegram so the bot knows your `chat_id`.

---

## Step 3 — Find your chat ID and user ID

Both of these are numeric. For 1:1 chats with a bot, **they are the same number**, which simplifies things.

1. Open this URL in any browser, replacing `<TOKEN>` with the token from step 1.6:
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
   Tip: if the token contains `:` (it always does), the URL still works — just paste it as-is.
2. You'll see a JSON response. Find the most recent entry and look for a structure like:
   ```json
   {
     "update_id": 123456789,
     "message": {
       "message_id": 1,
       "from": {
         "id": 987654321,
         "first_name": "Eduardo",
         "username": "edumntg"
       },
       "chat": {
         "id": 987654321,
         "first_name": "Eduardo",
         "type": "private"
       },
       "text": "/start"
     }
   }
   ```
3. Note two numbers:
   - **`chat.id`** — the chat where messages will be posted. Write this down.
   - **`message.from.id`** — your personal user ID, used to authorize replies. Write this down.
   - In a 1:1 chat with the bot, these two are identical. In a group, they differ.

**If `getUpdates` returns an empty `result: []`** → you haven't actually sent a message to the bot yet. Go back to step 2 and send anything to it (a single letter is fine), then refresh the URL.

---

## Step 4 — Configure claude-beep

One command sets up everything: writes the config file, saves the token to `~/.claude-beep/env` (perms `0600`), and validates the token against Telegram's API.

**Option A — Interactive wizard** (easiest):

```bash
$ claude-beep config
```

You'll be prompted for:
1. Transport (press Enter for `telegram`)
2. Bot token (paste the token from Step 1)
3. Chat ID (paste the number from Step 3)
4. Allowed sender IDs (press Enter to use the same number as the chat ID, or type a comma-separated list)

**Option B — Single command** (good for scripts):

```bash
$ claude-beep config \
    --transport telegram \
    --bot-token "1234567890:ABCdefGHIJklmNOPQRstuVWXyz123456789" \
    --chat-id "344242056" \
    --allowed-senders "344242056"
```

Either way, you should see:

```
✓ wrote /Users/eduardo/.claude-beep/config.yaml
✓ saved 1 token(s) to /Users/eduardo/.claude-beep/env (perms 0600)
✓ bot validated: @your_claudebeep_bot
```

**The token does NOT need to be exported in your shell.** The daemon auto-loads `~/.claude-beep/env` at startup.

To inspect what was saved (token is masked):

```bash
$ claude-beep config --show
```

---

## Step 5 — Verify outbound: get your first message

In a terminal:

```bash
$ claude-beep daemon --foreground &
$ sleep 0.8
$ claude-beep status
```

**Expected:**
```
claude-beep daemon: running
  pid:        12345
  uptime:     0s
  outbound:   telegram
  inbound:    telegram
  events seen: 0
  sessions (0):
    (none — start one with: claude-beep run -- claude)
```

If `outbound:` doesn't list `telegram`, the token wasn't saved correctly. Re-run `claude-beep config --show` to verify, or just rerun `claude-beep config` and paste the token again.

Now fire a fake `Stop` event:

```bash
$ echo '{"session_id":"hello","hook_event_name":"Stop","cwd":"/tmp/test"}' | claude-beep hook stop
```

**PASS:**
- Within 2 seconds, your Telegram app shows a new message from your bot titled **`Claude finished · test`**.
- Body contains `Project: /tmp/test`, `Session: hello`.

If nothing arrives, see [Troubleshooting](#troubleshooting) at the end.

---

## Step 6 — Verify inbound: reply from Telegram

This is the two-way path. Replies need:
1. Your user ID in `allowed_senders` (done in step 4).
2. Claude launched through the `claude-beep run` wrapper, **not** directly.

### How notifications look

You'll see a structured message like this in Telegram:

```
✅ Claude finished · api · 12.5s

📁 ~/work/api
⏱ 12.5s
🔖 api-d2da

│ Refactor done. All 12 tests pass.
│ Migrated session storage from in-memory to Redis.

Reply to this message to route your response to this session.
```

The 🔖 label (`api-d2da`) is a per-session identifier — basename of the project plus the first 4 chars of the session UUID. That's how you tell sessions apart when you have several open.

### Routing your reply to a specific session

When you have **multiple Claude sessions** running, all notifications come to the same Telegram chat. There are three ways to target a specific session — listed in priority order:

#### 1. Name a session and `@mention` it (best for many sessions)

Launch each Claude session with a short name:

```bash
$ claude-beep run --name api -- claude
$ claude-beep run --name ui  -- claude
```

Then from Telegram, just send:

```
@api what does the auth middleware do?
@ui  the lint warnings on Button.tsx
```

The `@name` prefix is stripped, the rest is injected into that named session. The 🔖 field in every notification shows the name so you know what to mention. Name rules: letters, digits, `_`, `-`; must start with a letter or digit; up to 32 chars.

If two wrappers register the same name, the most recent one wins the mention mapping.

#### 2. Telegram "Reply to message" (best when scrolling back)

| Platform | How to reply to a specific message |
|---|---|
| iPhone / Android | **Swipe right** on the bot's message, or **long-press** → tap **Reply** |
| Desktop (macOS / Windows) | **Right-click** the message → **Reply**, or hover and click the reply arrow |
| Web | Same as desktop |

Then type your message and send. claude-beep matches `message.reply_to_message.message_id` against the original notification and routes to the session that produced it.

#### 3. Plain message — falls back to the most recent session

If you just type a message (no `@` prefix, not a reply), claude-beep injects it into the most-recent session that posted in this chat. Good for single-session workflows.

### Bot commands

Send any of these in the bot's chat — the bot replies directly without injecting into any session:

| Command | Aliases | What it does |
|---|---|---|
| `/sessions` | `/ls`, `/sess` | List active Claude sessions with their `@name`, cwd, and PID |
| `/status` | `/s`, `/info` | Daemon health: PID, uptime, outbound/inbound transports, events seen |
| `/help` | — | List the commands above plus the reply patterns |

Example: type `/sessions` and you'll get back something like:

```
📋 2 active sessions

│ @api   ·  ~/work/api   ·  pid 12345
│ @ui    ·  ~/work/ui    ·  pid 12346

Send "@<name> <message>" to target a specific session.
```

Commands respect `allowed_senders` — only authorized users can issue them.

**Optional polish**: register the commands with BotFather so Telegram shows them in the `/` autocomplete menu. In `@BotFather`, send `/setcommands`, pick your bot, then paste:

```
sessions - list active Claude sessions
status - daemon health
help - show all commands and reply patterns
```

### Daemon log

```
inbound telegram from 344242056 -> session abc... via mention (15 chars)
inbound telegram from 344242056 -> session def... via reply   (12 chars)
inbound telegram from 344242056 -> session ghi... via last    (8 chars)
bot command /sessions from 344242056 → replied
```

### Step-by-step test

Daemon should still be running from step 5. In another terminal:

```bash
$ claude-beep run -- claude
```

(If you don't have `claude` on your PATH yet, substitute any TTY app for testing — e.g., `claude-beep run -- bash`.)

Inside the Claude session, ask something that takes a few seconds:

> Write a short poem about distributed systems, then ask me what to do next.

When the **`Claude needs input · …`** notification arrives in Telegram (Claude pauses for input at the "what to do next?" question), reply in the same Telegram chat:

```
make it shorter
```

**PASS:**
- Within a second, **`make it shorter`** appears as the next user input in your Claude Code terminal.
- Claude responds to it as a normal user turn.
- In another terminal, `claude-beep status` shows `events seen: ≥ 2` and `last event: 1s ago`.
- The daemon log shows a line like `inbound telegram from <YOUR_USER_ID> -> session <uuid> via reply (15 chars)` (if you used Telegram's "Reply to" feature) or `… via last (…)` (if you sent a plain message).

To inspect the log:

```bash
$ claude-beep tail
```

---

## Step 7 — Verify auth: rejected sender

Override your `allowed_senders` to a wrong value:

```bash
$ claude-beep config --transport telegram --chat-id "344242056" --allowed-senders "0"
```

Restart the daemon. Then reply again from Telegram.

**PASS:** Nothing happens. Daemon log shows no `inbound …` line because your reply was filtered at the transport level before reaching the routing engine.

Restore your real ID:

```bash
$ claude-beep config --transport telegram --chat-id "344242056" --allowed-senders "344242056"
```

---

## Step 8 — Register the hooks with Claude Code (one-time)

Up to this point you've been firing hook events manually via `echo … | claude-beep hook stop`. To make Claude Code do this automatically when a turn finishes, register the hooks:

```bash
$ claude-beep init
```

This merges the four hook entries into `~/.claude/settings.json`:
- `Stop` — Claude finishes a turn
- `Notification` — Claude needs your input (permission prompt, etc.)
- `SubagentStop` — a subagent finishes
- `UserPromptSubmit` — you submit a prompt (used internally to measure turn duration)

Existing hooks in your settings are preserved. Running `init` twice is safe.

**Verify:** open `~/.claude/settings.json` and look for a `"hooks"` block containing four entries that each call `claude-beep hook <event>`.

From now on, just running `claude-beep run -- claude` is enough: outbound notifications and inbound replies both work, no manual `echo` needed.

---

## Optional: pastebin for long messages

Telegram caps messages at 4096 characters. If Claude's response is longer, claude-beep can upload the full text to a pastebin (default: **dpaste**, no account needed, 30-day expiry) and replace the excerpt with a preview + a `See full response: <url>` link.

Off by default. Enable:

```bash
$ claude-beep config --pastebin-enable
```

Or for GitHub Gist (markdown rendering, secret unlisted URLs — needs a Personal Access Token with `gist` scope from <https://github.com/settings/tokens>):

```bash
$ claude-beep config --pastebin-provider gist --github-token "ghp_..."
```

Then restart the daemon. What you'll see when an excerpt exceeds the 1000-char threshold:

```
│ Refactored the auth module. Migrated session storage from in-memory
│ to Redis. All 47 tests pass…
│ …
│
│ See full response: https://dpaste.com/AbCdEf123
```

Tap or click the link from your phone to read the full response in a browser.

Disable with `claude-beep config --pastebin-disable`. Full tuning knobs (preview length, threshold, expiry, etc.) live under `pastebin:` in `~/.claude-beep/config.yaml`.

The scrubber runs **before** the upload, so `*_TOKEN` / `*_KEY` / `Authorization:` headers in the excerpt are redacted before reaching the paste service.

---

## Optional: install as a background service

If you want the daemon to run on login (no need to launch it manually):

```bash
$ claude-beep service install
$ claude-beep service start
$ claude-beep status
```

The daemon is now under launchd (macOS) or systemd (Linux). It reads tokens from `~/.claude-beep/env`, which `claude-beep config` already populated. If your token rotates, run `claude-beep config` again — on macOS, you also need to re-run `claude-beep service install` so the plist picks up the new value (launchd embeds env vars at install time, not at start).

Remove:

```bash
$ claude-beep service uninstall
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `claude-beep status` shows `outbound: (none)` | Token wasn't saved to `~/.claude-beep/env` | Run `claude-beep config --show` to inspect, or `claude-beep config` again to redo. |
| Outbound message never arrives | Wrong `default_chat_id`, or you never `/start`ed the bot | Re-check `getUpdates` (step 3); the `chat.id` you see there must match the value in `config.yaml`. Or rerun `claude-beep config` with the right ID. |
| `telegram send failed: 401 Unauthorized` | Bot token is wrong | Rerun `claude-beep config` and paste the token from BotFather (tokens contain a colon). |
| `telegram send failed: 400 chat not found` | Chat ID is wrong, or you've never messaged the bot | Send the bot a message (or `/start` again), refresh `getUpdates`, copy the chat ID, rerun `claude-beep config --chat-id <new>`. |
| Outbound works but reply does nothing | Your user ID isn't in `allowed_senders`, or no outbound event has populated the session map yet | Check `allowed_senders` in config; trigger one outbound event (e.g. via `claude-beep run -- bash` then exit) before replying. |
| `daemon.log` says `no session bound` on inbound | No outbound event for this channel has happened yet | Outbound first, then inbound — the daemon learns the channel→session mapping from the outbound message. |
| Inline emojis/markdown look weird | Telegram uses HTML parse mode internally; raw `<`, `>`, `&` are escaped automatically. If you see literal `&lt;`, that's the escape — Telegram should still render it correctly. |
| Bot replies to itself / infinite loop | Won't happen: the inbound transport ignores messages with `bot_id`. |
| Two-way not working in groups | The bot needs to be allowed to read group messages. Talk to BotFather: `/setprivacy` → choose your bot → **Disable**. Then re-invite the bot to the group. |
| Sensitive info appearing in chat | The scrubber redacts common token formats by default, but not arbitrary secrets in tool args. Use `security.scrub_extra_patterns` to add your own regex. |

If something else is failing, capture `claude-beep tail` output while reproducing — almost every problem shows up as an explanatory line in the daemon log.

---

## Quick reference

```bash
# State directory (everything is here)
export CLAUDE_BEEP_HOME=$HOME/cb-testing

# Config file
$CLAUDE_BEEP_HOME/config.yaml

# Logs
$CLAUDE_BEEP_HOME/logs/daemon.log       # operational log
$CLAUDE_BEEP_HOME/logs/events.jsonl     # raw hook events

# IPC socket
$CLAUDE_BEEP_HOME/sock                  # 0600 perms

# Useful commands
claude-beep config                       # interactive setup wizard
claude-beep config --show                # print current config (token masked)
claude-beep daemon --foreground          # run daemon in this terminal
claude-beep daemon --foreground --dry-run   # don't actually call Telegram API
claude-beep status                       # query daemon state
claude-beep tail                         # follow daemon.log
claude-beep run -- claude                # launch claude with two-way replies
claude-beep service install              # install launchd/systemd unit
```
