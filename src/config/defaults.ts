export const DEFAULT_CONFIG_YAML = `# claude-beep config
# Tokens should be set via env vars or OS keychain — never put them here directly.

default_transport: telegram

transports:
  telegram:
    bot_token_env: TELEGRAM_BOT_TOKEN
    default_chat_id: ""
    allowed_senders: []    # Telegram user IDs allowed to reply
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    default_channel_id: ""
    allowed_senders: []    # Discord user snowflake IDs
  slack:
    app_token_env: SLACK_APP_TOKEN
    bot_token_env: SLACK_BOT_TOKEN
    default_channel_id: ""
    allowed_senders: []    # Slack user IDs (U...)

routing:
  - match: { cwd: "**" }
    transport: telegram

filters:
  min_turn_seconds: 0
  notify_on_error: true
  quiet_hours: []
  # Notify on Stop and SubagentStop by default. Suppress the noisy "Claude needs input"
  # (Notification) events. Add "notification" here if you want permission prompts in chat too.
  notify_event_types: ["stop", "subagent-stop"]

security:
  # Redact common token patterns from outbound messages.
  scrub_tokens: true
  # Additional regex patterns redacted (case-insensitive, replaced with [REDACTED]).
  scrub_extra_patterns: []
  # cwd globs that suppress notifications entirely.
  sensitive_paths:
    - "**/.env"
    - "**/.env.*"
    - "**/credentials/**"
    - "**/secrets/**"
    - "**/*.pem"
    - "**/*.key"

# When an excerpt is too long for Telegram's 4096-char message cap, upload the
# full text to a paste service and replace the chat excerpt with a preview +
# link. Content is uploaded AFTER the scrubber runs, so secrets are redacted
# before being sent to the 3rd party.
pastebin:
  enabled: false        # opt-in
  provider: dpaste      # dpaste | gist
  threshold_chars: 1000 # paste when excerpt is longer than this
  preview_chars: 400    # how much to show inline before "…See full response: <url>"
  dpaste:
    expiry_days: 30
    syntax: markdown
  gist:
    token_env: GITHUB_TOKEN   # set this env var with a PAT having gist scope
    public: false             # secret gist (URL is unlisted; needed to view)
`;

export const HOOK_EVENTS = ['Stop', 'Notification', 'SubagentStop', 'UserPromptSubmit'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];
