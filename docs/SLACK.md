# SLACK.md — Slack setup and end-to-end testing

This guide walks you from "I've never installed a Slack app" to "Claude Code notifies me in Slack and I can reply from any device." Allow **~20 minutes** (Slack's setup screen has more steps than Telegram or Discord).

---

## First — what does the bot see and where do messages go?

A Slack **app** is a workspace-scoped integration with its own bot user. The model:

1. You create an **app** at <https://api.slack.com/apps>. It belongs to a single Slack workspace.
2. You install the app to that workspace — your admin may need to approve. After install you get two tokens:
   - **App-level token** (`xapp-…`) — opens a WebSocket to Slack so the bot doesn't need a public URL.
   - **Bot token** (`xoxb-…`) — used by the bot to post messages.
3. You **invite the bot to a channel** (`/invite @YourBot`). Notifications post there.
4. When you reply, claude-beep reads the message via the WebSocket and injects it into the matching session.

So:
- The bot **only sees channels it's been invited to**, plus DMs sent to it. It cannot read other channels.
- Slack uses **Socket Mode** (outbound WebSocket from your machine), so no public webhook URL or port-forwarding is needed.
- Two-way reply routing uses Slack **threads**: replying in a thread on the original bot message routes your reply to the exact session that produced it.

---

## What you need before starting

- A Slack workspace where you can install apps (own workspace, or your admin allows custom apps).
- A working `claude-beep` install:
  ```bash
  $ claude-beep --version
  → 0.2.0
  ```

---

## Step 1 — Create the Slack app

1. Go to <https://api.slack.com/apps>, sign in, and click **Create New App** → **From scratch**.
2. **App Name**: anything (e.g. `Claude Beep`). **Workspace**: pick your workspace. → **Create App**.

You're now on the app's **Basic Information** page.

---

## Step 2 — Enable Socket Mode and generate the app-level token

1. Left sidebar → **Socket Mode** → toggle **Enable Socket Mode** on.
2. A dialog appears asking you to generate an **App-Level Token**:
   - **Token Name**: anything (e.g. `socket-mode`).
   - **Scopes**: add `connections:write`.
   - Click **Generate**.
3. Copy the token (starts with `xapp-`). **Save it** — Slack shows it only once.

---

## Step 3 — Add bot scopes

1. Left sidebar → **OAuth & Permissions**.
2. Scroll to **Scopes** → **Bot Token Scopes** → **Add an OAuth Scope**. Add each:
   - `chat:write` — post messages
   - `channels:history` — read messages in public channels the bot is in
   - `groups:history` — read messages in private channels the bot is in (optional)
   - `im:history` — read DMs sent to the bot
   - `app_mentions:read` — receive `@your-bot` mentions

---

## Step 4 — Subscribe to events

1. Left sidebar → **Event Subscriptions** → toggle **Enable Events** on.
2. Under **Subscribe to bot events**, add:
   - `message.channels` — public channel messages
   - `message.im` — DMs
   - `app_mention` — when someone @-mentions the bot

The "Request URL" field is **not used** with Socket Mode; ignore it.

---

## Step 5 — Install the app and get the bot token

1. Left sidebar → **Install App** → **Install to Workspace** → approve the prompt.
2. Slack returns you to the same page with a **Bot User OAuth Token** (`xoxb-…`). Copy it. **Save it.**

> If you change scopes later, return to **Install App** and click **Reinstall to Workspace** — the bot token does not auto-rotate, but new scopes require a reinstall.

---

## Step 6 — Get your channel ID and user ID

**Channel ID:**

1. In Slack, click the channel name at the top of the channel view → **About** tab.
2. At the very bottom of the About panel, you'll see `Channel ID: C0123456789` with a copy button.

**Your user ID:**

1. Click your own avatar (top right) → **Profile**.
2. Click the kebab menu (`⋮`) below your name → **Copy member ID**.
3. The ID looks like `U01ABCDEF1234`.

---

## Step 7 — Invite the bot to the channel

In the channel where you want notifications:

```
/invite @claude-beep
```

(Use the bot's actual display name — whatever you set in step 1.)

You should see *"You added @Claude Beep to this channel."*

---

## Step 8 — Configure claude-beep

**Option A — Interactive wizard:**

```bash
$ claude-beep config
```

Pick `slack` when prompted. Paste the app token (xapp-…), bot token (xoxb-…), channel ID (C…), and your user ID (U…).

**Option B — Single command:**

```bash
$ claude-beep config \
    --transport slack \
    --app-token "xapp-1-..." \
    --bot-token "xoxb-..." \
    --channel-id "C0123456789" \
    --allowed-senders "U01ABCDEF1234"
```

You should see:

```
✓ wrote /Users/eduardo/.claude-beep/config.yaml
✓ saved 2 token(s) to /Users/eduardo/.claude-beep/env (perms 0600)
```

Inspect (tokens masked):

```bash
$ claude-beep config --show
```

---

## Step 9 — Verify outbound: get your first message

```bash
$ claude-beep daemon --foreground &
$ sleep 1
$ claude-beep status
```

**Expected:**

```
claude-beep daemon: running
  outbound:   slack
  inbound:    slack
  ...
```

If `inbound:` is empty, Socket Mode couldn't connect. Common causes:
- Wrong `SLACK_APP_TOKEN` (must start with `xapp-`).
- Socket Mode never enabled (step 2).
- App-level token missing the `connections:write` scope.

Fire a test event:

```bash
$ echo '{"session_id":"hello","hook_event_name":"Stop","cwd":"/tmp/test"}' | claude-beep hook stop
```

**PASS:** Within 2 seconds, your Slack channel shows a formatted message with a header block:

```
✅ Claude finished · test

📁 Project        🔖 Session
   /tmp/test         test-hell

Reply to this message to route your response to this session.
```

---

## Step 10 — Verify inbound: reply from Slack

This is the two-way path. Replies need:
1. Your user ID in `allowed_senders` (done in step 8).
2. Claude launched through the `claude-beep run` wrapper.

### Routing your reply to a specific session

Three ways to target a specific session — in priority order:

#### 1. `@mention` a named session

Launch each Claude session with a short name:

```bash
$ claude-beep run --name api -- claude
$ claude-beep run --name ui  -- claude
```

From Slack, send a message in the channel (or thread):

```
@api what does the auth middleware do?
@ui  the lint warnings on Button.tsx
```

The `@name` prefix is stripped before injection. Name rules: letters, digits, `_`, `-`; starts with letter or digit; ≤ 32 chars.

(Slack's "smart" autocomplete may try to convert `@api` into a real user mention — just keep typing the bot's session name and ignore the popup. The session name lives in claude-beep, not Slack.)

#### 2. Slack threads

Slack's idiom for "reply to a specific message" is **threads**.

| Platform | How to start a thread reply |
|---|---|
| Desktop | Hover over the bot's message → click the **💬 Reply in thread** icon |
| Mobile | **Tap** the bot's message → **Reply in thread** |
| Web | Same as desktop |

A thread opens on the right. Type your reply there and send. claude-beep matches `thread_ts` against the original message's timestamp.

#### 3. Plain message — falls back to the most recent session

If you just post a new message in the channel (no `@`, no thread), claude-beep injects it into the most-recent session in that channel.

### Bot commands

Send any of these in the channel where the bot is — replies post inline without injecting into any session:

| Command | Aliases | What it does |
|---|---|---|
| `/sessions` | `/ls`, `/sess` | List active Claude sessions with their `@name`, cwd, and PID |
| `/status` | `/s`, `/info` | Daemon health |
| `/help` | — | List commands and reply patterns |

Commands respect `allowed_senders`. These are plain text starting with `/` — they are **not** registered as Slack slash commands (no app-side setup required).

Daemon log shows which path was used:

```
inbound slack from U01ABCDEF... -> session abc... via reply (15 chars)
inbound slack from U01ABCDEF... -> session def... via last  (8 chars)
```

### Step-by-step test

```bash
$ claude-beep run -- claude
```

Inside Claude, ask something slow:

> Write a short poem about distributed systems, then ask me what to do next.

When the **`Claude needs input · …`** notification arrives in Slack, click **💬 Reply in thread** on that message and type:

```
make it shorter
```

**PASS:**
- "make it shorter" appears as the next user input in the Claude terminal.
- Claude responds normally.
- `claude-beep tail` shows `inbound slack from <YOUR_ID> -> session <uuid> via reply`.

---

## Step 11 — Verify auth: rejected sender

```bash
$ claude-beep config --transport slack --channel-id "<KEEP_SAME>" --allowed-senders "U0000000000"
```

Restart the daemon. Reply again from Slack.

**PASS:** Nothing happens. Daemon log shows no `inbound …` line. Restore:

```bash
$ claude-beep config --transport slack --channel-id "<KEEP_SAME>" --allowed-senders "<YOUR_USER_ID>"
```

> Note: `claude-beep config --transport slack` without passing `--app-token` and `--bot-token` updates only the chat/sender fields and leaves your existing tokens in `~/.claude-beep/env` intact.

---

## Step 12 — Register the hooks with Claude Code (one-time)

```bash
$ claude-beep init
```

After this, `claude-beep run -- claude` is all you need.

---

## Optional: pastebin for long messages

Slack caps the text in a block at ~3000 characters. If Claude's response is longer, claude-beep can upload the full text to a pastebin (default **dpaste**, 30-day expiry, no account) and replace the excerpt with a preview + link.

Off by default. Enable:

```bash
$ claude-beep config --pastebin-enable
```

For developer-friendly GitHub Gist (markdown rendering, secret URLs — needs a PAT with `gist` scope from <https://github.com/settings/tokens>):

```bash
$ claude-beep config --pastebin-provider gist --github-token "ghp_..."
```

Restart the daemon. The scrubber redacts secrets **before** the upload. See README for the full list of `pastebin:` YAML options.

---

## Optional: install as a background service

```bash
$ claude-beep service install
$ claude-beep service start
$ claude-beep status
```

The daemon reads `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN` from `~/.claude-beep/env`, populated by `claude-beep config`. On macOS, re-run `claude-beep service install` after rotating tokens (launchd embeds env vars at install time).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Daemon shows `inbound: (none)` | `SLACK_APP_TOKEN` missing, wrong, or wrong scope | Check `claude-beep config --show`. Token must start with `xapp-` and have `connections:write`. |
| `outbound: (none)` | `SLACK_BOT_TOKEN` missing or wrong | Bot token must start with `xoxb-`. Reinstall the app and rerun `claude-beep config`. |
| `slack send failed: error=channel_not_found` | Wrong channel ID, or bot isn't a member | Confirm the ID from the channel's **About** panel; run `/invite @your-bot` in that channel. |
| `slack send failed: error=not_in_channel` | Bot not invited | `/invite @your-bot` in the target channel. |
| `slack send failed: error=invalid_auth` | Wrong bot token, or app uninstalled | Reinstall the app from the dev portal, copy the new `xoxb-` token, rerun `claude-beep config`. |
| `slack send failed: error=missing_scope` | Forgot `chat:write` or another scope | Add it under OAuth & Permissions → **Reinstall to Workspace**. |
| Outbound works but replies do nothing | Replied in the channel instead of a thread, **and** another session is more recent → reply went elsewhere | Use **Reply in thread** explicitly on the message you want to target. |
| Reply ignored, no daemon log | Your user ID isn't in `allowed_senders` | Verify via Profile → kebab → **Copy member ID**; rerun `claude-beep config --allowed-senders "U..."`. |
| Socket Mode disconnects repeatedly | Workspace restricts custom apps, or token revoked | Check Slack workspace admin settings. Generate a fresh app-level token and rerun config. |

Capture `claude-beep tail` output while reproducing — every routing decision is logged.

---

## Quick reference

```bash
# Useful commands
claude-beep config                       # interactive setup wizard
claude-beep config --show                # print current config (tokens masked)
claude-beep daemon --foreground          # run daemon in this terminal
claude-beep daemon --foreground --dry-run   # don't actually call Slack API
claude-beep status                       # query daemon state
claude-beep tail                         # follow daemon.log
claude-beep run -- claude                # launch claude with two-way replies
claude-beep service install              # install launchd/systemd unit
```

## Cleaning up

1. **Slack side**: workspace settings → **Manage apps** → find your app → **Remove**. Or in the dev portal → app → **Settings** → **Basic Information** → bottom → **Delete App**.
2. **Local**: `claude-beep service uninstall`, then optionally `rm -rf ~/.claude-beep`.
