# DISCORD.md — Discord setup and end-to-end testing

This guide walks you from "I've never created a Discord bot" to "Claude Code notifies me in Discord and I can reply from any device." Allow **~15 minutes**.

---

## First — where do messages go and what does the bot see?

A Discord **bot** is a special user account that lives in a Discord application. The model:

1. You create an **application** at <https://discord.com/developers/applications>. The application has a bot user with its own token.
2. You **invite the bot** to one of your Discord servers (you must have **Manage Server** permission there). It can also DM users it shares a server with.
3. `claude-beep` posts notifications to a **channel** in that server (or to a DM with you).
4. When you reply in that channel, `claude-beep` reads the reply (the bot is a member of the channel) and injects it into the matching Claude Code session.

So:
- Your **personal account is not used** by the API; the bot account does the posting.
- The bot **only sees messages in channels it's been added to**, plus DMs from users sharing a server. It cannot read your other DMs.
- You can also **DM the bot directly** — claude-beep treats DMs the same as any other channel.
- The bot needs **MESSAGE CONTENT INTENT** enabled (a one-click toggle in the developer portal) so it can read the text of reply messages. Without it you'll get notifications but no two-way reply path.

---

## What you need before starting

- A Discord account, logged in to either the desktop or web client.
- A **server** where you have permission to invite bots (your own server is easiest — create one for free in 10 seconds: server list sidebar → `+` → **Create My Own**).
- A working `claude-beep` install:
  ```bash
  $ claude-beep --version
  → 0.2.0
  ```

---

## Step 1 — Create the application and bot

1. Open <https://discord.com/developers/applications> in a browser and sign in.
2. Click **New Application** (top right).
3. Give it a name (e.g. `Claude Beep`) → **Create**.
4. In the left sidebar, click **Bot**.
5. Under **Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT** (required to read your replies). The other intents are not needed. **Save Changes**.
6. Still on the Bot tab, click **Reset Token** → **Yes, do it**. Copy the token that appears.
   **Treat this token like a password** — anyone with it can post as your bot.

> Discord shows the token only once. If you lose it, hit **Reset Token** again — you'll get a new one and the old one becomes invalid.

---

## Step 2 — Invite the bot to your server

1. In the left sidebar, click **OAuth2** → **URL Generator**.
2. **Scopes** — check `bot` and `applications.commands`.
3. **Bot Permissions** — check:
   - `View Channels`
   - `Send Messages`
   - `Read Message History`
   - `Embed Links`
4. Copy the **Generated URL** at the bottom of the page.
5. Paste it into a new browser tab. Discord opens a confirmation dialog.
6. Choose the server (or pick yourself for DMs) → **Authorize** → solve the captcha.

The bot should now appear in the server's member list (offline by default until claude-beep starts).

---

## Step 3 — Get your channel ID and user ID

Discord hides numeric IDs by default. Turn on Developer Mode first.

1. In the Discord app: **User Settings** (cog icon next to your name) → **Advanced** → toggle **Developer Mode** on.
2. **Channel ID**: right-click the channel where you want notifications → **Copy Channel ID**. You get a big number like `1234567890123456789`.
3. **Your user ID**: right-click your own name in any message or member list → **Copy User ID**.

If you'd rather notifications come as DMs, right-click your own name → **Message** to open a DM, send anything, then right-click the DM channel → **Copy Channel ID**.

---

## Step 4 — Configure claude-beep

One command does everything: writes the config, saves the token to `~/.claude-beep/env` at `0600`, no shell export needed.

**Option A — Interactive wizard:**

```bash
$ claude-beep config
```

Pick `discord` when prompted. Then paste the bot token, the channel ID, and your user ID.

**Option B — Single command:**

```bash
$ claude-beep config \
    --transport discord \
    --bot-token "MTIzNDU2Nzg5..." \
    --channel-id "1234567890123456789" \
    --allowed-senders "987654321098765432"
```

You should see:

```
✓ wrote /Users/eduardo/.claude-beep/config.yaml
✓ saved 1 token(s) to /Users/eduardo/.claude-beep/env (perms 0600)
```

Inspect (token masked):

```bash
$ claude-beep config --show
```

---

## Step 5 — Verify outbound: get your first message

```bash
$ claude-beep daemon --foreground &
$ sleep 1
$ claude-beep status
```

**Expected:**

```
claude-beep daemon: running
  outbound:   discord
  inbound:    discord
  ...
```

If `inbound:` is empty, the daemon couldn't log in. The two most common reasons:
- Bot token wrong → rerun `claude-beep config`.
- **MESSAGE CONTENT INTENT** not enabled → revisit the dev portal Bot tab.

Fire a test event:

```bash
$ echo '{"session_id":"hello","hook_event_name":"Stop","cwd":"/tmp/test"}' | claude-beep hook stop
```

**PASS:** Within 2 seconds, your Discord channel shows a formatted message:

```
✅ Claude finished · test

📁 `/tmp/test`
🔖 `test-hell`

Reply to this message to route your response to this session.
```

---

## Step 6 — Verify inbound: reply from Discord

This is the two-way path. Replies need:
1. Your user ID in `allowed_senders` (done in step 4).
2. Claude launched through the `claude-beep run` wrapper.

### Routing your reply to a specific session

When you have **multiple Claude sessions** running, all notifications come to the same channel. Three ways to target a specific one — in priority order:

#### 1. `@mention` a named session

Launch each Claude session with a short name:

```bash
$ claude-beep run --name api -- claude
$ claude-beep run --name ui  -- claude
```

From Discord, send:

```
@api restart the dev server
@ui  hot reload broken, check vite config
```

The `@name` prefix is stripped before injection. Name rules: letters, digits, `_`, `-`; starts with letter or digit; ≤ 32 chars. The notification's 🔖 field shows the name.

(Discord may auto-suggest a @-mention of a real Discord user as you type — just keep typing the bot's session name instead of selecting from the popup. The session name lives in claude-beep, not Discord, so the autocomplete is just noise.)

#### 2. Discord "Reply" feature

| Platform | How to reply to a specific message |
|---|---|
| Desktop | Hover over the bot's message → click the **↩ Reply** arrow (or right-click → **Reply**) |
| Mobile | **Long-press** the bot's message → tap **Reply** |
| Web | Same as desktop |

Discord prepends a quote of the original message and includes `message_reference` in the API payload. claude-beep looks that up and routes to the session that produced the notification.

#### 3. Plain message — falls back to the most recent session

If you just type a new message (no `@` prefix, not a reply), claude-beep injects it into the most-recent session that posted in this channel.

### Bot commands

Send any of these in the channel where the bot is — replies post inline without injecting into any session:

| Command | Aliases | What it does |
|---|---|---|
| `/sessions` | `/ls`, `/sess` | List active Claude sessions with their `@name`, cwd, and PID |
| `/status` | `/s`, `/info` | Daemon health |
| `/help` | — | List commands and reply patterns |

Commands respect `allowed_senders`. Discord may show its own slash-command UI for `/sessions` etc.; those are claude-beep's, not native Discord commands.

Daemon log shows which path was used:

```
inbound discord from 987654321... -> session abc... via reply (15 chars)
inbound discord from 987654321... -> session def... via last  (8 chars)
```

### Step-by-step test

```bash
$ claude-beep run -- claude
```

Inside Claude, ask something slow:

> Write a short poem about distributed systems, then ask me what to do next.

When the **`Claude needs input · …`** notification arrives in Discord, click the **↩ Reply** arrow on that message and type:

```
make it shorter
```

**PASS:**
- Within a second, "make it shorter" appears as the next user input in the Claude terminal.
- Claude responds to it as a normal turn.
- `claude-beep tail` shows `inbound discord from <YOUR_ID> -> session <uuid> via reply`.

---

## Step 7 — Verify auth: rejected sender

```bash
$ claude-beep config --transport discord --channel-id "<KEEP_SAME>" --allowed-senders "0"
```

Restart the daemon. Reply again from Discord.

**PASS:** Nothing happens. Daemon log shows no `inbound …` line. Restore your real ID:

```bash
$ claude-beep config --transport discord --channel-id "<KEEP_SAME>" --allowed-senders "<YOUR_USER_ID>"
```

---

## Step 8 — Register the hooks with Claude Code (one-time)

```bash
$ claude-beep init
```

Merges hook entries into `~/.claude/settings.json`. After this, `claude-beep run -- claude` is all you need — no manual `echo … | hook` invocations.

---

## Optional: pastebin for long messages

Discord caps messages at 2000 characters. If Claude's response is longer, claude-beep can upload the full text to a pastebin (default **dpaste**, 30-day expiry, no account) and replace the excerpt with a preview + link.

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

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Daemon starts but `inbound: (none)` | MESSAGE CONTENT INTENT off, or wrong bot token | Dev portal → Bot tab → enable the intent, save. Rerun `claude-beep config` if token might be stale. |
| Outbound posts but bot shows as offline in the member list | Daemon not running | `claude-beep status`. If down, `claude-beep daemon --foreground`. |
| `discord send failed: 401` | Wrong bot token | Reset token in the dev portal → `claude-beep config` again. |
| `discord send failed: 403 Missing Access` | Bot was kicked, or doesn't have `Send Messages` permission in this channel | Re-invite via the OAuth URL with proper permissions, or grant the role manually. |
| `discord send failed: 404 Unknown Channel` | Wrong channel ID, or bot isn't in the channel | Right-click the channel → Copy Channel ID, compare with config. |
| Reply does nothing | Your user ID isn't in `allowed_senders`, or no outbound has happened in this channel yet | Generate an outbound first; check `allowed_senders` matches `Copy User ID` value. |
| `daemon.log` says `no session bound` on inbound | Channel→session map is empty | Run any wrapper that posts outbound first (`claude-beep run -- bash`, then `exit`). |
| Messages look like raw markdown (e.g., `**bold**` literally) | Channel has Markdown disabled (rare) | Check channel settings; Discord renders `**bold**` and backticks in normal text channels. |

If something else is wrong, run `claude-beep tail` while reproducing — every routing decision is logged.

---

## Quick reference

```bash
# Useful commands
claude-beep config                       # interactive setup wizard
claude-beep config --show                # print current config (token masked)
claude-beep daemon --foreground          # run daemon in this terminal
claude-beep daemon --foreground --dry-run   # don't actually call Discord API
claude-beep status                       # query daemon state
claude-beep tail                         # follow daemon.log
claude-beep run -- claude                # launch claude with two-way replies
claude-beep service install              # install launchd/systemd unit
```

## Cleaning up

If you want to remove the bot:

1. **Discord side**: right-click the bot in the server's member list → **Kick**. To delete the application entirely, dev portal → application → **Delete App**.
2. **Local**: `claude-beep service uninstall`, then optionally `rm -rf ~/.claude-beep`.
