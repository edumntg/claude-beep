# PRD — `claude-beep`

> Two-way notification + remote-control plugin for Claude Code.
> Owner: Eduardo Montilva · Status: Draft v0.1 · Last updated: 2026-06-17

---

## 1. Summary

`claude-beep` is a Claude Code plugin that bridges a local Claude Code session to a chat platform (Telegram, Discord, or Slack). Outbound: lifecycle events (turn complete, permission prompt, error) are pushed to the configured channel. Inbound: replies in that channel are routed back into the active Claude Code session as user input.

The user can leave a long-running task on their laptop, get pinged on their phone when Claude is done or stuck, and reply from the phone to keep the session moving — without returning to the terminal.

---

## 2. Problem

Claude Code sessions can run for minutes to hours (large refactors, multi-step research, agent loops). Today the user must remain at the terminal to:
- Know when a turn finishes
- Approve permission prompts that pause the session
- Redirect Claude when it goes off-track

This wastes attention or strands sessions waiting on a human who has stepped away.

---

## 3. Goals & Non-Goals

### Goals
- **G1.** Push outbound notifications for `Stop`, `Notification`, `SubagentStop`, and configurable error events.
- **G2.** Accept inbound replies from the chat channel and inject them as the next user turn into the originating Claude Code session.
- **G3.** Support **Telegram, Discord, and Slack** as first-class transports through a common interface.
- **G4.** Run entirely local — no third-party relay server.
- **G5.** Distribute as a single `npm install -g claude-beep` package plus a hook-config snippet.

### Non-Goals (v1)
- Hosted/multi-tenant SaaS
- Mobile-native apps (we ride existing chat clients)
- Voice / SMS transports
- Cross-machine session routing (one daemon = one machine)
- Persisting full conversation transcripts to chat (we link, not mirror)

---

## 4. Users & Primary Use Cases

| Persona | Use case |
|---|---|
| Solo dev running long agent loops | Get a phone ping when the loop finishes or hits an approval prompt; reply "yes, proceed" from the couch. |
| On-call engineer | Claude Code drives an incident workflow; team channel sees progress, anyone can redirect. |
| Researcher running `/autoresearch` overnight | Wakes up to a summary in Telegram, taps a reply to start the next topic. |

---

## 5. Architecture

### 5.1 High-level

```
┌──────────────────────┐        ┌───────────────────────┐        ┌─────────────────┐
│  Claude Code (TTY)   │◄──────►│  claude-beep daemon   │◄──────►│  Chat platform  │
│  + hook scripts      │  IPC   │  (long-running, local)│  API   │  (TG/Disc/Slack)│
└──────────────────────┘        └──────────┬────────────┘        └─────────────────┘
                                           │
                                           ▼
                                   ┌──────────────┐
                                   │   SQLite     │
                                   │ session/route│
                                   └──────────────┘
```

### 5.2 Components

1. **Hook scripts** (`claude-beep hook <event>`)
   - Lightweight CLI invoked by Claude Code's `Stop`, `Notification`, `SubagentStop`, `PostToolUse` hooks.
   - Reads JSON event payload from stdin, forwards to the daemon via local Unix socket.
   - **Zero network I/O in the hook itself** — keeps hook latency negligible so Claude isn't blocked.

2. **Daemon** (`claude-beep daemon`)
   - Long-running local process started by the user (or via `launchd` / `systemd --user`).
   - Listens on Unix socket `~/.claude-beep/sock` for hook events.
   - Holds persistent connections to each enabled transport (Telegram long-polling, Discord Gateway WS, Slack Socket Mode) — **no public webhook URL needed**.
   - Routes outbound events; correlates inbound replies back to the right Claude Code session.

3. **Session bridge** (the hard part of two-way)
   - To inject a reply into a running Claude Code session, the daemon needs a write-handle to that session's stdin.
   - **Approach A (v1, default): PTY wrapper.** User launches Claude via `claude-beep run` (or alias `cbcc`), which spawns Claude inside a PTY the daemon owns. Daemon can write to stdin at any time. Pros: works with the stock Claude Code CLI, no SDK dependency. Cons: requires launching Claude through the wrapper.
   - **Approach B (v2, opt-in): SDK-hosted session.** Use `@anthropic-ai/claude-agent-sdk` so the daemon IS the Claude host. Pros: cleaner programmatic input/output, structured streaming. Cons: diverges from the user's normal CLI workflow; some CLI features may differ.

4. **Transport adapters** (`/src/transports/*.ts`)
   - Common interface: `send(event)`, `onReply(handler)`, `start()`, `stop()`.
   - One file per platform; all conform to the same `Transport` interface.

### 5.3 Event flow — outbound

```
Claude finishes turn
  └─► Claude Code fires Stop hook
       └─► `claude-beep hook stop` reads JSON from stdin
            └─► UDS write → daemon
                 └─► daemon looks up route for session_id
                      └─► transport.send({title, body, session_id, transcript_excerpt})
                           └─► message appears in chat
```

### 5.4 Event flow — inbound (two-way)

```
User replies in Telegram/Discord/Slack
  └─► transport adapter receives message (long-poll / WS / Socket Mode)
       └─► daemon maps chat thread → session_id (via SQLite)
            └─► daemon writes reply to that session's PTY stdin (Approach A)
                 └─► Claude Code treats it as the next user turn
```

### 5.5 Why a daemon vs. doing it all in the hook

Hooks are short-lived and fire-and-forget. They cannot hold a WebSocket to Discord or long-poll Telegram. A daemon is required for any inbound path, so we centralize **all** transport I/O there and keep hooks as thin shims.

---

## 6. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | **TypeScript** (Node 20+) | Matches Claude Code's ecosystem; easy npm distribution; strong typing for event schemas. |
| Runtime | Node 20 LTS | Built-in `node:net` UDS, `node:child_process` PTY via `node-pty`. |
| CLI framework | `commander` or `clipanion` | Familiar, small. |
| Transport SDKs | `node-telegram-bot-api` · `discord.js` · `@slack/socket-mode` + `@slack/web-api` | Mature, well-maintained. |
| PTY | `node-pty` | Standard for terminal-multiplexer-style apps. |
| IPC | Unix domain socket (JSON lines) | Zero deps, low latency, OS-enforced perms. |
| Config | YAML (`~/.claude-beep/config.yaml`) | Human-editable; tokens via env var or OS keychain. |
| Secrets | `keytar` (macOS Keychain / libsecret / Credential Vault) | Avoid plaintext tokens on disk. |
| Storage | **SQLite** via `better-sqlite3` | Single-file, no daemon, fast for sub-MB workloads. |
| Logging | `pino` (JSON) → `~/.claude-beep/logs/` | Structured, rotatable. |
| Process supervision | macOS `launchd` plist / Linux `systemd --user` unit | Auto-start daemon on login. |
| Packaging | npm global package | `npm i -g claude-beep` then `claude-beep init`. |
| Tests | `vitest` + transport mocks | Fast, ESM-native. |

---

## 7. Storage

### 7.1 SQLite schema (sketch)

```sql
-- one row per active Claude Code session the daemon knows about
CREATE TABLE sessions (
  session_id   TEXT PRIMARY KEY,
  pid          INTEGER,
  cwd          TEXT,
  started_at   INTEGER,
  ended_at     INTEGER,
  pty_fd_ref   TEXT     -- in-memory handle key; not persisted across daemon restarts
);

-- routing: which chat channel a session reports to
CREATE TABLE routes (
  session_id   TEXT,
  transport    TEXT,    -- 'telegram' | 'discord' | 'slack'
  channel_id   TEXT,    -- chat id / channel id
  thread_id    TEXT,    -- optional Discord/Slack thread id
  PRIMARY KEY (session_id, transport)
);

-- correlation for inbound replies (which incoming chat message maps to which session)
CREATE TABLE inbound_map (
  transport    TEXT,
  channel_id   TEXT,
  thread_id    TEXT,
  session_id   TEXT,
  PRIMARY KEY (transport, channel_id, thread_id)
);

-- event log (audit + replay)
CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT,
  event_type   TEXT,    -- 'stop' | 'notification' | 'reply_in' | ...
  payload_json TEXT,
  created_at   INTEGER
);
```

### 7.2 Config file

```yaml
# ~/.claude-beep/config.yaml
default_transport: telegram

transports:
  telegram:
    bot_token_env: TELEGRAM_BOT_TOKEN      # OR: bot_token_keychain: claude-beep/telegram
    default_chat_id: "123456789"
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    default_channel_id: "987654321098765432"
  slack:
    app_token_env: SLACK_APP_TOKEN          # xapp-... for Socket Mode
    bot_token_env: SLACK_BOT_TOKEN          # xoxb-...
    default_channel_id: C0123456789

routing:
  # match by cwd glob → transport+channel
  - match: { cwd: "~/work/**" }
    transport: slack
    channel_id: C0123456789
  - match: { cwd: "**" }
    transport: telegram

filters:
  min_turn_seconds: 30        # ignore turns shorter than this
  notify_on_error: true
  quiet_hours: ["23:00", "07:00"]
```

---

## 8. Security

- **Tokens never in config** — referenced by env var name or keychain entry.
- **Unix socket perms** — `0600`, owned by `$USER`. Daemon refuses connections from other UIDs.
- **No outbound except to configured transport APIs.** Daemon has no inbound listener on a TCP port.
- **Permission-prompt notifications redact secrets** from tool args (regex-based scrubber: `*_TOKEN`, `*_KEY`, `Authorization:` headers).
- **Reply auth** — only senders on a per-route allowlist can inject input. Slack/Discord: user-id allowlist. Telegram: chat-id allowlist + optional shared-secret prefix (`/cb <secret> <message>`).
- **Org-policy awareness** — daemon refuses to forward content from paths matching a sensitive-data glob list (e.g., `**/credentials/**`, `**/.env*`).

---

## 9. Phased Roadmap

### Phase 0 — Foundations (week 1)
Goal: scaffolding, no transports yet.
- npm package skeleton, TS build, vitest setup
- `claude-beep init` writes default config + sample hook snippets to `~/.claude/settings.json`
- Hook CLI (`claude-beep hook <event>`) parses Claude Code's stdin JSON schema and dumps to a local log file
- Daemon stub: starts, listens on UDS, prints received events
- **Exit criteria:** `Stop` events from a real Claude Code session land in `~/.claude-beep/logs/events.jsonl`.

### Phase 1 — One-way Telegram (week 2)
Goal: outbound notifications working end-to-end.
- `Telegram` transport adapter (send only)
- Config loader + keychain integration
- Filtering (min turn duration, quiet hours)
- Permission-prompt notifications (via `Notification` hook)
- Smoke-test: 20 real sessions, every `Stop` posts to TG within 2s
- **Exit criteria:** user can finish a Claude turn and get a Telegram message with title, duration, and transcript link.

### Phase 2 — Multi-transport outbound (week 3)
Goal: Discord + Slack reach parity with Telegram.
- `Transport` interface + adapters for Discord (webhook + Gateway connection) and Slack (Socket Mode)
- Routing rules engine (cwd glob → transport)
- Per-transport message formatting (Telegram MarkdownV2, Discord embeds, Slack blocks)
- **Exit criteria:** routing config picks the right channel per project; all three transports send.

### Phase 3 — Two-way (PTY approach) (weeks 4–5)
Goal: inbound replies from chat reach the running Claude Code session.
- `claude-beep run -- claude ...` PTY wrapper
- Session registration: wrapper announces `{session_id, pid}` to daemon on start, deregisters on exit
- Inbound listeners on each transport
- Inbound auth (allowlists, shared secret)
- Reply → write to PTY stdin → Claude treats as next user turn
- Thread-per-session pattern on Discord/Slack so replies are unambiguous
- **Exit criteria:** finish a turn, get TG notification, reply "continue with X", session resumes with that input.

### Phase 4 — Reliability & UX (week 6)
- Reconnect/backoff for all transports
- Daemon supervision: launchd plist + systemd unit + `claude-beep service install`
- `claude-beep status` (sessions, queues, last events)
- `claude-beep tail` (live log)
- Reply UI sugar: inline buttons on Telegram/Discord for common replies ("approve", "cancel", "continue")
- Crash-recovery: replay unsent events from SQLite on daemon restart

### Phase 5 — Hardening & v1.0 release (week 7)
- Secret scrubber + sensitive-path denylist (org-policy aware)
- Telemetry opt-in (anonymous: event counts, transport mix)
- Docs site (mdBook or Docusaurus)
- Homebrew formula in addition to npm
- **Exit criteria:** v1.0.0 tag, public README, install in <2 minutes from cold.

### Phase 6 — SDK-hosted mode (post-v1, optional)
- Alternative session host built on `@anthropic-ai/claude-agent-sdk`
- Better structured output, programmatic tool-use events
- Coexists with PTY mode; user picks per session

### Phase 7 — Future / parked
- Web dashboard (read-only) — local-only Next.js
- Multi-machine routing via a self-hosted relay
- Additional transports (ntfy, Matrix, Pushover, SMS)
- Reply attachments (file uploads from phone → drop into session cwd)

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PTY wrapping breaks rich Claude Code TTY features (mouse, ANSI quirks) | Med | Med | Use `node-pty` (battle-tested by VS Code); ship `--no-wrap` opt-out; SDK mode as alt path. |
| Claude Code hook schema changes | Med | Low | Pin to documented hook events; integration test against latest Claude Code in CI. |
| Token leaks via notification payloads | Low | High | Mandatory scrubber, sensitive-path denylist, redact-by-default for tool args. |
| Daemon crashes silently | Med | Med | launchd/systemd auto-restart; `claude-beep status` exits non-zero if dead; optional self-ping on a configured channel. |
| User on locked-down corp network blocks long-polling | Low | Med | All three chosen transports work via outbound HTTPS only; document proxy support. |
| Org compliance forbids forwarding repo content to chat | Med | High | Per-repo opt-in (`.claude-beep.yaml` in repo root); sensitive-path denylist; redaction on by default. |

---

## 11. Success Metrics

- **Adoption:** weekly active daemons (telemetry opt-in)
- **Reliability:** % of `Stop` events delivered to chat within 5s (target: ≥99%)
- **Two-way utility:** % of notified sessions that receive at least one reply from chat (signal that two-way actually gets used)
- **Time-to-install:** median time from `npm i -g` to first delivered notification (target: <5 min)

---

## 12. Open Questions

1. Should sessions auto-create a fresh Discord/Slack thread per turn, or one thread per session? (Leaning: one thread per session.)
2. Do we want a built-in "summarize this turn in 2 lines" pass before posting, to keep notifications skimmable? Adds an LLM call — opt-in.
3. For Telegram, support inline keyboards for "approve/deny" on permission prompts in Phase 3 or Phase 4?
4. Bundled vs. external SQLite migrations tool?
5. Naming: `claude-beep` final, or revisit before v1.0 publish?

---

## 13. Appendix — Example hook snippet (Phase 0 output)

```json
// ~/.claude/settings.json
{
  "hooks": {
    "Stop":         [{ "command": "claude-beep hook stop" }],
    "Notification": [{ "command": "claude-beep hook notification" }],
    "SubagentStop": [{ "command": "claude-beep hook subagent-stop" }]
  }
}
```

The hook command reads the event JSON from stdin, writes it to the daemon socket, and exits in <50ms.
