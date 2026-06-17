# TEST_PLAN.md — verifying claude-beep end to end

This is the manual test plan. Run it once before declaring the project ready, and again whenever a change touches the daemon, transports, or hook protocol. Estimated time **~45 minutes** if all three chat platforms are configured; **~15 minutes** for Telegram only.

> For the actual Telegram bot setup (creating the bot, getting the chat ID, configuring `claude-beep`), follow [`TELEGRAM.md`](./TELEGRAM.md). That guide is self-contained — finish it before running Phase 1 here.

---

## Table of contents

- [Conventions](#conventions)
- [Pre-flight](#pre-flight)
- [Phase 0 — Hooks, daemon, IPC](#phase-0--hooks-daemon-ipc)
- [Phase 1 — Telegram outbound](#phase-1--telegram-outbound)
- [Phase 2 — Discord + Slack outbound and routing](#phase-2--discord--slack-outbound-and-routing)
- [Phase 3 — Two-way (inbound replies)](#phase-3--two-way-inbound-replies)
- [Phase 4 — Operations](#phase-4--operations)
- [Phase 5 — Security hardening](#phase-5--security-hardening)
- [Regression checklist](#regression-checklist)
- [Cleanup](#cleanup)

---

## Conventions

- Lines starting with `$` are commands you type.
- Lines starting with `→` show expected output (paraphrased — timestamps and IDs will differ).
- **PASS** describes what to look for. If you don't see it, jump to the **Troubleshooting** notes at the end of each section.
- Set an isolated state directory so testing doesn't touch your real config:
  ```bash
  export CLAUDE_BEEP_HOME=$HOME/cb-testing
  mkdir -p "$CLAUDE_BEEP_HOME"
  ```
  Unset it (`unset CLAUDE_BEEP_HOME`) when you're done. Every command below assumes this variable is exported in the current shell.
- All commands assume `claude-beep` is on your `PATH`. If you haven't run `npm link` yet, see [Pre-flight](#pre-flight).

---

## Pre-flight

Run once before any of the phases below.

```bash
$ cd /Users/eduardo/Desktop/Repositories/claude-beep
$ npm install
$ npm run build
$ npm test
```

**PASS:** `npm test` reports **46 passed** with no failures.

Put the binary on your PATH for the rest of testing:

```bash
$ npm link
$ which claude-beep
→ /opt/homebrew/bin/claude-beep   # or similar
$ claude-beep --version
→ 0.1.0
```

> Prefer not to link? Replace every `claude-beep` below with `node /Users/eduardo/Desktop/Repositories/claude-beep/dist/cli.js`.

---

## Phase 0 — Hooks, daemon, IPC

**Goal:** confirm a hook event flows from stdin → local log → daemon over the Unix socket, with no chat platform involved.

```bash
$ rm -rf "$CLAUDE_BEEP_HOME" && mkdir -p "$CLAUDE_BEEP_HOME"
$ claude-beep daemon --foreground --dry-run &
$ sleep 0.8
$ echo '{"session_id":"smoke","hook_event_name":"Stop","cwd":"/tmp"}' | claude-beep hook stop
$ sleep 0.3
$ cat "$CLAUDE_BEEP_HOME/logs/events.jsonl"
$ cat "$CLAUDE_BEEP_HOME/logs/daemon.log"
```

**PASS:**
- `events.jsonl` has two lines for the smoke event: one from the hook (no `via`), one from the daemon (`"via":"daemon"`).
- `daemon.log` mentions `event received` and either `no route matched` (no transports configured yet) or `sent via ...`.
- `ls -l "$CLAUDE_BEEP_HOME/sock"` shows permissions `srw-------`.

Stop the daemon when done:

```bash
$ kill %1
```

**Troubleshooting:**
- Daemon never receives the event → check that `CLAUDE_BEEP_HOME` is exported in the same shell as both the daemon and the hook.
- Socket permissions wrong → the daemon couldn't `chmod`. Check that `$CLAUDE_BEEP_HOME` is writable.

---

## Phase 1 — Telegram outbound

**Prerequisites:**
1. Complete **steps 1–4** of [`TELEGRAM.md`](./TELEGRAM.md) — bot created, chat ID known, `claude-beep config` run.

No env var export is needed — the daemon reads tokens from `~/.claude-beep/env` automatically.

```bash
$ claude-beep daemon --foreground &
$ sleep 0.8
$ echo '{"session_id":"tg1","hook_event_name":"Stop","cwd":"/tmp/proj"}' | claude-beep hook stop
```

**PASS:**
- Within 2 seconds, a Telegram message appears titled **Claude finished · proj**, body includes `Project: /tmp/proj` and `Session: tg1`.
- `daemon.log` shows `sent via telegram -> <YOUR_CHAT_ID>`.

### Filter — short turn dropped

Edit the config: set `filters.min_turn_seconds: 30`. Restart the daemon (`kill %1`, then re-launch). Then:

```bash
$ echo '{"session_id":"short","hook_event_name":"UserPromptSubmit","cwd":"/tmp/proj"}' | claude-beep hook user-prompt-submit
$ sleep 0.3
$ echo '{"session_id":"short","hook_event_name":"Stop","cwd":"/tmp/proj"}' | claude-beep hook stop
```

**PASS:**
- No Telegram message arrives.
- `daemon.log` shows `filtered (stop): turn 0.3s < min_turn_seconds (30s)`.

Set `min_turn_seconds: 0` again before moving on.

**Troubleshooting:**
- Daemon prints `transports: (none)` → `TELEGRAM_BOT_TOKEN` was not visible to the daemon's process. Export it in the same shell, restart.
- `telegram send failed: 401` → wrong bot token.
- `telegram send failed: 400 ... chat not found` → wrong chat ID, or you haven't messaged the bot at least once (see [`TELEGRAM.md`](./TELEGRAM.md) step 4).

---

## Phase 2 — Discord + Slack outbound and routing

Skip subsections for platforms you don't intend to use.

### Discord outbound

**Prerequisites:**
- Discord application + bot at <https://discord.com/developers/applications>, **MESSAGE CONTENT INTENT** enabled.
- Bot invited to your server with `Send Messages` permission.
- `DISCORD_BOT_TOKEN` exported.
- Channel ID copied (Developer Mode → right-click channel → Copy Channel ID).

Add to `$CLAUDE_BEEP_HOME/config.yaml`:

```yaml
transports:
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    default_channel_id: "<CHANNEL_ID>"
    allowed_senders: []
```

Restart the daemon, then:

```bash
$ echo '{"session_id":"dc1","hook_event_name":"Stop","cwd":"/tmp/work/repo"}' | claude-beep hook stop
```

**PASS:** Message appears in the Discord channel, title `**Claude finished · repo**`.

### Slack outbound

**Prerequisites:**
- Slack app at <https://api.slack.com/apps>, Socket Mode enabled.
- Bot scopes: `chat:write`, `channels:history`, `im:history`, `app_mentions:read`.
- Event subscriptions: `message.channels`, `app_mention`.
- App installed; `SLACK_APP_TOKEN` (`xapp-…`) and `SLACK_BOT_TOKEN` (`xoxb-…`) both exported.
- Bot invited to the channel: `/invite @claude-beep`.

Add to `config.yaml`:

```yaml
transports:
  slack:
    app_token_env: SLACK_APP_TOKEN
    bot_token_env: SLACK_BOT_TOKEN
    default_channel_id: "<CHANNEL_ID>"
    allowed_senders: []
```

Restart the daemon, then:

```bash
$ echo '{"session_id":"sl1","hook_event_name":"Stop","cwd":"/tmp"}' | claude-beep hook stop
```

**PASS:** Slack message appears in the channel with a header block and a section block.

### Routing — cwd glob picks transport

```yaml
routing:
  - match: { cwd: "/tmp/work/**" }
    transport: discord
    channel_id: "<DISCORD_CHANNEL>"
  - match: { cwd: "**" }
    transport: telegram
```

Restart, then:

```bash
$ echo '{"session_id":"r1","hook_event_name":"Stop","cwd":"/tmp/work/proj"}' | claude-beep hook stop
$ echo '{"session_id":"r2","hook_event_name":"Stop","cwd":"/tmp/home/proj"}' | claude-beep hook stop
```

**PASS:**
- First event → Discord channel.
- Second event → Telegram.
- `daemon.log` shows two `sent via ...` lines, one per transport.

---

## Phase 3 — Two-way (inbound replies)

Two-way replies require:
1. Adding **your own user ID** to `allowed_senders` for that transport.
2. Launching Claude through `claude-beep run`.

### Finding your user ID

| Transport | How |
|---|---|
| Telegram | After messaging your bot, open `https://api.telegram.org/bot<TOKEN>/getUpdates` — `message.from.id` is your user ID. For personal 1:1 chats it equals the chat ID. |
| Discord | Enable Developer Mode → right-click your own avatar → **Copy User ID**. |
| Slack | Click your avatar → **Profile** → kebab menu → **Copy member ID** (starts with `U`). |

Add your ID(s) to `allowed_senders` in the relevant transport block, restart the daemon.

### Wrapper smoke test

```bash
$ claude-beep run -- bash -c 'echo wrapper_id=$CLAUDE_BEEP_WRAPPER_ID; sleep 2'
```

**PASS:**
- Output shows a UUID after `wrapper_id=`.
- `daemon.log` shows `session registered: <uuid>` followed by `session unregistered: <uuid>` two seconds later.

### Inbound — full path (Telegram example, repeat per transport)

```bash
$ claude-beep daemon --foreground &
$ sleep 0.5
$ claude-beep run -- claude
```

In the Claude session, ask it something slow (e.g., *"write a short poem about distributed systems then ask me what to do next"*). When the **Claude needs input** notification arrives in your Telegram chat, reply in the same chat with:

```
just one stanza, please
```

**PASS:**
- Within a second, the reply text appears as the next user input in your Claude Code TTY.
- Claude processes it as a normal turn.
- `daemon.log` shows `inbound telegram from <YOUR_USER_ID> -> session <uuid> (N chars)`.

**Repeat for Discord and Slack** if configured. Each transport routes inbound replies independently.

### Named sessions and `@name` routing

```bash
$ # daemon already running with a transport configured
$ claude-beep run --name api -- bash -c 'while read line; do echo "api got: $line"; done' > /tmp/api.out 2>&1 &
$ claude-beep run --name ui  -- bash -c 'while read line; do echo "ui got: $line"; done'  > /tmp/ui.out  2>&1 &
$ sleep 1
$ claude-beep status
```

**PASS:** `claude-beep status` shows two sessions with names `api` and `ui` (the daemon log line is `session registered: <uuid> name=api ...`).

Generate one outbound event from each session so each name has a notification to compare against:

```bash
$ WID_API=$(claude-beep status 2>&1 | awk '/name=api/{print $1}')   # or grep daemon.log
$ WID_UI=$( claude-beep status 2>&1 | awk '/name=ui/{print  $1}')
$ # (read the UUIDs from `claude-beep status` output)
$ echo '{"session_id":"a","cwd":"/tmp","hook_event_name":"Stop"}' | CLAUDE_BEEP_WRAPPER_ID=$WID_API CLAUDE_BEEP_SESSION_NAME=api claude-beep hook stop
$ echo '{"session_id":"b","cwd":"/tmp","hook_event_name":"Stop"}' | CLAUDE_BEEP_WRAPPER_ID=$WID_UI  CLAUDE_BEEP_SESSION_NAME=ui  claude-beep hook stop
```

**PASS:** Two chat notifications arrive, both with the 🔖 line set to the session name (`api` / `ui`).

From the chat (Telegram/Discord/Slack), send a `@mention` reply:

```
@api hello from api
@ui  hello from ui
```

**PASS:**
- `/tmp/api.out` contains `api got: hello from api`
- `/tmp/ui.out` contains `ui got: hello from ui`
- Daemon log lines: `inbound telegram from ... -> session <uuid> via mention (15 chars)` × 2

Type a mismatched name to verify it's dropped (not silently routed):

```
@nope hi
```

**PASS:** Nothing happens in either output file. Daemon log shows `inbound telegram: @nope did not match any active session`.

Clean up the test wrappers:

```bash
$ kill %1 %2
```

### Bot commands

In the chat where the bot is, send each of the following and check the reply:

```
/sessions      → "📋 N active sessions" with @name · cwd · pid per line
/status        → "🟢 Daemon status" with PID, uptime, transports, event count
/help          → "🤖 claude-beep commands" listing /sessions, /status, /help
/ls            → same output as /sessions (alias)
/s             → same output as /status (alias)
```

**PASS:**
- All five send a chat reply within ~2 seconds.
- Daemon log shows `bot command /sessions from <YOUR_ID> → replied` etc.
- No session receives the text (your wrapped Claude shows no injected input).

**Auth rejection (already covered):** if your user ID is not in `allowed_senders`, the command is ignored at the transport layer.

### Inbound auth — reject unknown sender

Set `allowed_senders: ["0"]` (or any ID that isn't yours) for the transport you're testing, restart the daemon, then reply from your account again.

**PASS:** Nothing is injected into the Claude session. `daemon.log` shows no `inbound …` line (the message was filtered at the transport adapter before reaching the daemon's routing).

**Troubleshooting:**
- Reply arrives but `daemon.log` says `no session bound` → no outbound event has populated the channel→session mapping yet. Generate one first (any hook event with `CLAUDE_BEEP_WRAPPER_ID` set — which is automatic for processes spawned by `claude-beep run`).
- Discord: messages don't arrive at all → confirm **MESSAGE CONTENT INTENT** is enabled in the Discord developer portal.
- Slack: Socket Mode never connects → confirm Socket Mode is enabled and `SLACK_APP_TOKEN` is the `xapp-` token (not the `xoxb-` bot token).

---

## Phase 4 — Operations

### `claude-beep status`

```bash
$ claude-beep daemon --foreground --dry-run &
$ sleep 0.5
$ claude-beep status
```

**PASS:** Prints `claude-beep daemon: running`, PID, uptime, started timestamp, outbound + inbound transport names, events seen count, and `sessions (0): (none — start one with: claude-beep run -- claude)`.

```bash
$ kill %1
$ claude-beep status
→ daemon not running
$ echo $?
→ 1
```

**PASS:** Exit code is non-zero when the daemon is down.

### `claude-beep tail`

In terminal A:

```bash
$ claude-beep daemon --foreground --dry-run &
$ sleep 0.5
$ claude-beep tail -n 5
```

In terminal B:

```bash
$ echo '{"session_id":"t","hook_event_name":"Stop","cwd":"/tmp"}' | claude-beep hook stop
```

**PASS:** Within a second, terminal A prints the new daemon-log line. Ctrl-C cleanly exits.

### Wrapper reconnect across daemon restart

```bash
$ claude-beep daemon --foreground --dry-run > /tmp/d1.out 2>&1 &
$ D1=$!
$ sleep 0.5
$ claude-beep run -- bash -c 'sleep 30' > /tmp/wrap.out 2>&1 &
$ W=$!
$ sleep 0.7
$ claude-beep status | grep sessions
→ sessions (1):
$ kill $D1
$ sleep 0.3
$ claude-beep daemon --foreground --dry-run > /tmp/d2.out 2>&1 &
$ sleep 2
$ claude-beep status | grep sessions -A1
```

**PASS:** Status after restart still shows `sessions (1)` with the **same session UUID** and **same wrapper PID**. `~/.claude-beep/logs/daemon.log` shows `session registered: <uuid>` twice — once per daemon process — with identical UUIDs.

### `claude-beep service` — macOS

```bash
$ cat > "$CLAUDE_BEEP_HOME/env" <<EOF
TELEGRAM_BOT_TOKEN=<your token>
EOF
$ claude-beep service install
$ ls ~/Library/LaunchAgents/com.claudebeep.daemon.plist
$ claude-beep service start
$ launchctl list | grep claudebeep
$ claude-beep status
```

**PASS:**
- Plist file exists at the expected path.
- `launchctl list` shows `com.claudebeep.daemon` with a numeric PID (not `-`).
- `claude-beep status` confirms `outbound: telegram` (because `env` was embedded in the plist).
- Optional: reboot, then `claude-beep status` — daemon comes back automatically.

Cleanup when done:

```bash
$ claude-beep service uninstall
```

### `claude-beep service` — Linux

```bash
$ cat > "$CLAUDE_BEEP_HOME/env" <<EOF
TELEGRAM_BOT_TOKEN=<your token>
EOF
$ claude-beep service install
$ claude-beep service start
$ systemctl --user status claude-beep
```

**PASS:** Unit reports `loaded`, `active (running)`. `claude-beep status` shows the daemon up with the right transports.

**Troubleshooting:**
- `service install` → `could not find claude-beep on PATH` → run `npm link` or `npm install -g claude-beep`.
- macOS: daemon up but `outbound: (none)` → env file wasn't read at install time. Edit `~/.claude-beep/env`, then re-run `claude-beep service install` so the plist is rewritten.
- Linux: same symptom → `systemctl --user restart claude-beep` after editing the env file.

---

## Phase 5 — Security hardening

### Sensitive-path denylist

Set the config to:

```yaml
default_transport: telegram
transports:
  telegram:
    bot_token_env: TELEGRAM_BOT_TOKEN
    default_chat_id: "111"
routing:
  - match: { cwd: "**" }
    transport: telegram
security:
  sensitive_paths:
    - "**/.env"
    - "**/.env.*"
    - "**/credentials/**"
```

Restart the daemon in dry-run, then:

```bash
$ echo '{"session_id":"a","cwd":"/proj/.env.production","hook_event_name":"Stop"}' | claude-beep hook stop
$ echo '{"session_id":"b","cwd":"/repo/credentials/aws","hook_event_name":"Stop"}' | claude-beep hook stop
$ echo '{"session_id":"c","cwd":"/repo/src/app","hook_event_name":"Stop"}' | claude-beep hook stop
$ sleep 0.3
$ grep -E "(skipped|sent via)" "$CLAUDE_BEEP_HOME/logs/daemon.log"
```

**PASS:**
- Two `skipped: sensitive cwd …` lines (for `.env.production` and `credentials/aws`).
- One `sent via telegram -> 111` line (the third event, normal cwd).

### Secret scrubber

Add `security.scrub_extra_patterns: ["MY_SECRET_[A-Z0-9]+"]` to the config, restart, then:

```bash
$ cat <<'PAYLOAD' | claude-beep hook notification
{"session_id":"x","cwd":"/proj","hook_event_name":"Notification","message":"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.aa.bb sk-1234567890abcdef1234567890abcdef ghp_abcdefghijklmnopqrstuvwxyz0123456789 AKIAIOSFODNN7EXAMPLE STRIPE_API_KEY=sk_live_abcdefghij MY_SECRET_ABC123 xoxb-12345-67890-aBcDeFgHiJkLmNoPqRs"}
PAYLOAD
$ sleep 0.3
$ tail -5 "$CLAUDE_BEEP_HOME/logs/daemon.log"
```

**PASS:** The dry-run body contains `[REDACTED]` in place of every secret. None of the raw secret values appear anywhere in `daemon.log`.

### Toggle test — scrubber off

Set `security.scrub_tokens: false`, restart, re-run the same hook command.

**PASS:** With the flag off, raw secrets appear verbatim in `daemon.log`. This confirms the toggle works. **Set it back to `true` before any real-platform testing.**

### Pastebin offload for long messages

```bash
$ claude-beep config --pastebin-enable --pastebin-provider dpaste
$ # restart daemon
$ # build a transcript that exceeds the 1000-char threshold
$ python3 -c "import json; print(json.dumps({'type':'assistant','message':{'content':[{'type':'text','text':'A'*1500}]}}))" > /tmp/long.jsonl
$ echo '{"session_id":"long","cwd":"/tmp","transcript_path":"/tmp/long.jsonl","hook_event_name":"Stop"}' | claude-beep hook stop
$ sleep 1
$ grep "pastebin" "$CLAUDE_BEEP_HOME/logs/daemon.log"
```

**PASS:**
- Daemon log shows `pastebin (dpaste): 1500 chars -> https://dpaste.com/...`.
- The actual chat message contains "See full response: https://dpaste.com/...".
- Visiting the URL shows the full transcript text.

Disable when done:

```bash
$ claude-beep config --pastebin-disable
```

### Hook retry under daemon startup race

```bash
$ # daemon NOT running
$ echo '{"session_id":"r","cwd":"/proj","hook_event_name":"Stop"}' | claude-beep hook stop &
$ sleep 0.05
$ claude-beep daemon --foreground --dry-run &
$ sleep 0.5
$ grep "session.*r" "$CLAUDE_BEEP_HOME/logs/daemon.log" || echo "not found"
```

**PASS:** Daemon log contains the dry-run line for session `r`. The hook retried until the daemon came up.

---

## Regression checklist

Run all of the following green before any release:

- [ ] `npm test` → 46 passed.
- [ ] `npm run build` → clean.
- [ ] Phase 0 smoke test passes (this file).
- [ ] At least one Phase 1 outbound test against the **real** Telegram API.
- [ ] At least one Phase 3 inbound test against the **real** Telegram API.
- [ ] Phase 4 wrapper-reconnect-across-daemon-restart test passes.
- [ ] Phase 5 sensitive-cwd skip and scrubber redaction both pass.

---

## Cleanup

```bash
$ claude-beep service uninstall                # if installed
$ unset CLAUDE_BEEP_HOME TELEGRAM_BOT_TOKEN DISCORD_BOT_TOKEN SLACK_APP_TOKEN SLACK_BOT_TOKEN
$ rm -rf "$HOME/cb-testing"
$ npm unlink -g claude-beep                    # if linked
```
