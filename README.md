# claude-beep

> Two-way Claude Code notifications for Telegram, Discord, and Slack.
> Get pinged when Claude finishes a turn. Reply from your phone to keep it moving.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![Tests](https://img.shields.io/badge/tests-87%20passing-success)](#)
[![Status](https://img.shields.io/badge/status-1.0.0-orange)](#)

```
✅ Claude finished · api · 12.5s

📁 ~/work/api
⏱ 12.5s
🔖 api

│ Refactored the auth module. Migrated session storage from in-memory
│ to Redis. All 47 tests pass.

Reply to this message, or send "@api <message>", to target this session.
```

---

## Why

Claude Code sessions can take minutes. Sitting at the terminal waiting for them to finish (or to ask for permission) is a waste of attention. claude-beep:

- **Pings your phone** the moment Claude is done — with the last line of its response inline, plus a link to the full text if it's long.
- **Routes your reply back** into the running session as the next user turn. Type `@api what about the lockfile?` from Telegram and it lands in your terminal.
- **Handles many sessions in parallel.** Name them at launch (`claude-beep run --name api -- claude`) and mention them by name in chat.
- **Stays local.** Tokens never leave `~/.claude-beep/env` (perms `0600`). No SaaS, no relay server, no telemetry.

---

## Install

```bash
git clone https://github.com/edumntg/claude-beep.git
cd claude-beep
npm install
npm link            # puts `claude-beep` on your PATH
```

Requires Node 20+ and Claude Code (any version with `hooks` support).

> npm-published binary will land at `npm install -g claude-beep` once 1.0.0 ships to the registry.

---

## Quick start

The fastest path is the interactive wizard:

```bash
claude-beep init
```

It walks you through:
1. Picking a transport (Telegram / Discord / Slack)
2. Creating a bot (step-by-step, one instruction at a time, with `Enter`-to-continue)
3. Saving tokens to `~/.claude-beep/env` (perms `0600`)
4. Validating the bot, looking up your chat/channel/user IDs automatically (Telegram)
5. Sending a test message
6. Registering Claude Code hooks in `~/.claude/settings.json`
7. Installing the daemon as a background service (optional)

When the wizard finishes, you're one command away:

```bash
claude-beep run --name myproj -- claude
```

Use Claude normally. When a turn ends you'll get a chat ping. Reply from chat → injected into the session.

---

## Features

- **Outbound notifications** — every Claude turn ends with a structured message containing the project, duration, session label, and last assistant text.
- **Inbound replies** — type in chat, the daemon injects it into the originating PTY as if you typed it yourself.
- **Three transports** — Telegram (long-poll), Discord (Gateway), Slack (Socket Mode). All outbound + inbound.
- **Multi-session routing** — three ways to target a specific session:
  - `@<name> <message>` — mention a named session
  - Reply to a notification — uses your chat client's "reply to message" feature
  - Plain message — falls back to the most recently active session
- **Bot commands** — send `/sessions`, `/status`, `/help` in chat to query the daemon.
- **Long-message offload** — when Claude's response is longer than the chat's message cap, the full text is uploaded to a pastebin (dpaste or GitHub Gist, opt-in) and the chat shows a preview + link.
- **Secret scrubber** — outbound messages have common token patterns (`Bearer …`, `sk-…`, `ghp_…`, `*_TOKEN=…`, etc.) redacted before send.
- **Sensitive-path denylist** — events from `.env*`, `credentials/`, `secrets/`, `*.pem`, `*.key` paths are dropped before formatting.
- **Daemon supervision** — `claude-beep service install` writes a `launchd` plist (macOS) or `systemd --user` unit (Linux). Reads tokens from `~/.claude-beep/env`.
- **Wrapper auto-reconnect** — if the daemon restarts, the PTY wrapper reconnects with backoff and re-registers the same session.

---

## How it works

```
Terminal                              Daemon                    Chat
────────                              ──────                    ────

claude-beep run --name api          ┌──────────────┐
   |                                │              │            ┌──────────┐
   | hook fires on Stop  ──────────►│  claude-beep │  send  ──►│ Telegram │
   |                                │   daemon     │            │ Discord  │
   | inject reply (PTY stdin)  ◄────│              │  poll  ◄──│ Slack    │
   v                                └──────────────┘            └──────────┘
Claude Code (in PTY)
```

1. `claude-beep run` spawns Claude inside a PTY and registers a session with the daemon over a local Unix socket.
2. When a hook fires (Stop, Notification, etc.), a thin `claude-beep hook` command forwards the JSON payload to the daemon.
3. The daemon routes the event by `cwd` to a transport, formats it for the platform (HTML for Telegram, Markdown for Discord, blocks for Slack), and sends.
4. Inbound listeners on each transport receive your replies, filter by `allowed_senders`, and write to the matching session's PTY stdin.

Full design rationale and decision log: [docs/PRD.md](docs/PRD.md).

---

## Documentation

| Guide | What's inside |
|---|---|
| [docs/TELEGRAM.md](docs/TELEGRAM.md) | Telegram bot creation, two-way verification, troubleshooting |
| [docs/DISCORD.md](docs/DISCORD.md) | Discord application + bot setup, OAuth invite, reply-to routing |
| [docs/SLACK.md](docs/SLACK.md) | Slack app + Socket Mode, scopes, thread-based routing |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Manual verification plan for every phase |
| [docs/PRD.md](docs/PRD.md) | Original design doc with architecture rationale |

---

## CLI reference

| Command | What it does |
|---|---|
| `claude-beep init` | Interactive onboarding wizard (transport pick, bot creation, hooks, service install). |
| `claude-beep init --hooks-only` | Skip the wizard; only register Claude Code hooks. |
| `claude-beep config` | Interactive config tweaks (or pass flags: `--transport`, `--bot-token`, `--chat-id`, `--allowed-senders`, `--pastebin-enable`, ...). |
| `claude-beep config --show` | Print current config and saved env vars with tokens masked. |
| `claude-beep daemon --foreground` | Run the daemon in the current terminal. Use `--dry-run` to log messages instead of sending. |
| `claude-beep run [--name N] -- <cmd>` | Spawn a PTY-wrapped Claude session for two-way replies. |
| `claude-beep status` | Live daemon status: pid, uptime, active sessions, transports. |
| `claude-beep tail` | Follow `~/.claude-beep/logs/daemon.log` (Ctrl-C to exit). |
| `claude-beep service <action>` | `install`, `start`, `stop`, `uninstall`, `status` — launchd on macOS, systemd-user on Linux. |
| `claude-beep hook <event>` | Hook entry point. Invoked automatically by Claude Code via `~/.claude/settings.json`. |

---

## Config quick reference

`~/.claude-beep/config.yaml`:

```yaml
default_transport: telegram

transports:
  telegram:
    bot_token_env: TELEGRAM_BOT_TOKEN
    default_chat_id: "344242056"
    allowed_senders: ["344242056"]

routing:
  - match: { cwd: "**" }
    transport: telegram

filters:
  notify_event_types: ["stop", "subagent-stop"]   # suppress only Notification (permission prompts) by default
  min_turn_seconds: 0
  notify_on_error: true
  quiet_hours: []

security:
  scrub_tokens: true
  sensitive_paths: ["**/.env", "**/.env.*", "**/credentials/**", "**/secrets/**"]

pastebin:
  enabled: false               # opt-in for long-message offload
  provider: dpaste             # or "gist"
  threshold_chars: 1000
```

Tokens live in `~/.claude-beep/env` (auto-loaded by the daemon). Never put them in `config.yaml`.

---

## Multi-session example

```bash
# Terminal A
claude-beep run --name api -- claude

# Terminal B
claude-beep run --name ui -- claude

# Terminal C — see what's running
claude-beep status
# or, from Telegram:
/sessions
```

From your phone:
```
@api please rerun the failed test
@ui  the lint config is wrong, fix it
```

Each message is routed to its named session. Plain messages (no `@`) go to whichever session was most recently active.

---

## Security

- **Tokens** live in `~/.claude-beep/env`, `0600`. Not in `config.yaml`.
- **IPC socket** is `0600`. Only your UID can connect.
- **Inbound auth** — replies are accepted only from `allowed_senders`. Empty list disables inbound.
- **Daemon has no inbound network ports.** All transport I/O is outbound (long-poll / WebSocket / Socket Mode).
- **Scrubber** redacts token-shaped strings before send. Customise with `security.scrub_extra_patterns`.
- **Sensitive-path denylist** drops events from sensitive directories before formatting.

---

## Known limitations

- **Interactive Claude prompts** (multi-choice menus, permission popups inside Claude's TUI) are rendered with arrow-key navigation and don't translate into chat. You'll see Claude is waiting via the `/sessions` command or by checking the terminal; respond with a number/text answer if Claude is asking that style of question, otherwise navigate at the terminal.
- **Telegram has a 4096-char message cap; Discord 2000; Slack ~3000 per block.** Enable the pastebin layer (`claude-beep config --pastebin-enable`) to offload long responses.
- **Single-user model.** The current routing/auth model assumes one operator. Multi-user team usage is on the roadmap.

---

## Roadmap

- [ ] Inline reply buttons (Telegram inline keyboards, Discord components, Slack actions)
- [ ] Alternative session host built on `@anthropic-ai/claude-agent-sdk` (no PTY wrapper)
- [ ] Additional transports (ntfy, Matrix, Pushover, generic webhook)
- [ ] Web dashboard for live session view
- [ ] Multi-machine routing via a self-hosted relay
- [ ] Multi-user / team mode with per-user session permissions

---

## Development

```bash
git clone https://github.com/edumntg/claude-beep.git
cd claude-beep
npm install
npm test          # 87 tests
npm run build
npm run dev -- daemon --foreground   # run from source
```

The `prepare` lifecycle compiles TS to `dist/` on install. The `postinstall` step fixes the `node-pty` spawn-helper executable bit on macOS.

---

## Contributing

Issues and PRs welcome at <https://github.com/edumntg/claude-beep>. Before opening a feature PR, please open an issue first to discuss scope.

When reporting a bug, please include:
- `claude-beep --version`
- `claude-beep config --show` (tokens auto-masked)
- Last ~50 lines of `~/.claude-beep/logs/daemon.log`

---

## License

MIT — see [LICENSE](LICENSE).

Made by [@edumntg](https://github.com/edumntg).
