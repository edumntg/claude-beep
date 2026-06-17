import { startIpcServer, type SessionHandle } from '../ipc/server.js';
import { appendDaemonLog, appendEventLog } from '../logger.js';
import { SOCKET_PATH } from '../config/paths.js';
import { loadConfig } from '../config/loader.js';
import { buildTransports } from '../transports/index.js';
import { buildInboundTransports } from '../transports/inbound/index.js';
import { pickRoute, resolveTargetId } from '../routing.js';
import { shouldNotify } from '../filters.js';
import { formatEvent } from '../format.js';
import { recordStart, consumeDuration } from '../session-tracker.js';
import { scrubChatMessage } from '../security/scrub-message.js';
import { isSensitivePath } from '../security/denylist.js';
import { loadIntoProcessEnv, ENV_FILE } from '../config/env-file.js';
import { buildPastebin } from '../pastebin/index.js';
import { parseMention } from '../inbound-router.js';
import {
  parseBotCommand,
  buildSessionsReply,
  buildStatusReply,
  buildHelpReply,
} from '../bot-commands.js';
import type { NormalizedEvent } from '../events/schema.js';
import type { StatusResponse } from '../ipc/protocol.js';
import type { ChatMessage } from '../transports/types.js';
import type { PastebinProvider } from '../pastebin/types.js';
import type { Config } from '../config/loader.js';

interface DaemonOptions {
  foreground?: boolean;
  dryRun?: boolean;
}

const MAX_MESSAGE_MAP_SIZE = 1000;

export async function daemonCommand(opts: DaemonOptions): Promise<void> {
  const envLoaded = loadIntoProcessEnv();
  const config = await loadConfig();
  const dryRun = opts.dryRun || process.env.CLAUDE_BEEP_DRY_RUN === '1';
  const transports = buildTransports(config, { dryRun });
  const inboundTransports = dryRun ? [] : buildInboundTransports(config);
  const pastebin = buildPastebin(config);

  const startedAt = Date.now();
  let eventsSeen = 0;
  let lastEventAt: number | undefined;

  appendDaemonLog(`daemon starting (pid=${process.pid}, dryRun=${dryRun})`);
  if (envLoaded > 0) {
    appendDaemonLog(`loaded ${envLoaded} env var(s) from ${ENV_FILE}`);
  }
  appendDaemonLog(`outbound transports: ${[...transports.byName.keys()].join(', ') || '(none)'}`);
  appendDaemonLog(
    `inbound transports: ${inboundTransports.map((t) => t.name).join(', ') || '(none)'}`,
  );
  appendDaemonLog(`pastebin: ${pastebin ? pastebin.name : 'disabled'}`);

  const sessions = new Map<string, SessionHandle>();
  const sessionsByName = new Map<string, string>(); // name -> session_id
  const lastSessionByChannel = new Map<string, string>();
  const messageToSession = new Map<string, string>();
  const channelKey = (transport: string, id: string) => `${transport}:${id}`;
  const messageKey = (transport: string, channel: string, msgId: string) =>
    `${transport}:${channel}:${msgId}`;

  const rememberMessage = (transport: string, channel: string, msgId: string, sessionId: string) => {
    messageToSession.set(messageKey(transport, channel, msgId), sessionId);
    if (messageToSession.size > MAX_MESSAGE_MAP_SIZE) {
      const oldest = messageToSession.keys().next().value;
      if (oldest) messageToSession.delete(oldest);
    }
  };

  const server = startIpcServer({
    onSessionStart(handle) {
      sessions.set(handle.session_id, handle);
      if (handle.name) {
        const prior = sessionsByName.get(handle.name);
        if (prior && prior !== handle.session_id) {
          appendDaemonLog(
            `session name "${handle.name}" reassigned: ${prior} -> ${handle.session_id}`,
          );
        }
        sessionsByName.set(handle.name, handle.session_id);
      }
      appendDaemonLog(
        `session registered: ${handle.session_id}${handle.name ? ` name=${handle.name}` : ''} (pid=${handle.pid}, cwd=${handle.cwd})`,
      );
    },
    onSessionEnd(sessionId) {
      const handle = sessions.get(sessionId);
      sessions.delete(sessionId);
      if (handle?.name && sessionsByName.get(handle.name) === sessionId) {
        sessionsByName.delete(handle.name);
      }
      for (const [key, sid] of lastSessionByChannel) {
        if (sid === sessionId) lastSessionByChannel.delete(key);
      }
      appendDaemonLog(`session unregistered: ${sessionId}`);
    },
    onQuery(): StatusResponse {
      return {
        type: 'status',
        pid: process.pid,
        uptime_ms: Date.now() - startedAt,
        started_at: startedAt,
        outbound: [...transports.byName.keys()],
        inbound: inboundTransports.map((t) => t.name),
        sessions: [...sessions.values()].map((s) => ({
          session_id: s.session_id,
          pid: s.pid,
          cwd: s.cwd,
          name: s.name,
        })),
        events_seen: eventsSeen,
        last_event_at: lastEventAt,
      };
    },
    async onEvent(event) {
      eventsSeen += 1;
      lastEventAt = Date.now();
      appendEventLog({ via: 'daemon', ...event });

      if (event.event_type === 'user-prompt-submit') {
        if (event.raw.session_id) recordStart(event.raw.session_id);
        return;
      }

      if (isSensitivePath(event.raw.cwd, config.security.sensitive_paths)) {
        appendDaemonLog(`skipped: sensitive cwd ${event.raw.cwd}`);
        return;
      }

      const duration = event.raw.session_id ? consumeDuration(event.raw.session_id) : undefined;

      const verdict = shouldNotify(config.filters, {
        event_type: event.event_type,
        duration_seconds: duration,
      });
      if (!verdict.allow) {
        appendDaemonLog(`filtered (${event.event_type}): ${verdict.reason}`);
        return;
      }

      const route = pickRoute(config, { cwd: event.raw.cwd });
      if (!route) {
        appendDaemonLog(`no route matched for cwd=${event.raw.cwd ?? '<none>'}`);
        return;
      }

      const transport = transports.byName.get(route.transport);
      if (!transport) {
        appendDaemonLog(`transport not active: ${route.transport} (missing token?)`);
        return;
      }

      const targetId = resolveTargetId(config, route);
      if (!targetId) {
        appendDaemonLog(`no target id resolved for transport=${route.transport}`);
        return;
      }

      const raw = await formatEvent(event, { duration_seconds: duration });
      const scrubbed = scrubChatMessage(raw, {
        enabled: config.security.scrub_tokens,
        extra_patterns: config.security.scrub_extra_patterns,
      });
      const finalMessage = await maybePasteExcerpt(scrubbed, config, pastebin);

      try {
        const result = await transport.send({ id: targetId }, finalMessage);
        appendDaemonLog(
          `sent via ${route.transport} -> ${targetId} (label=${raw.session_label})`,
        );
        if (event.wrapper_id) {
          lastSessionByChannel.set(channelKey(route.transport, targetId), event.wrapper_id);
          if (result.message_id) {
            rememberMessage(route.transport, targetId, result.message_id, event.wrapper_id);
          }
        }
      } catch (err) {
        appendDaemonLog(`send failed via ${route.transport}: ${(err as Error).message}`);
      }
    },
  });

  for (const inbound of inboundTransports) {
    try {
      await inbound.start(async (msg) => {
        // Bot commands ( /sessions, /status, /help ) — handled inline, never injected into a session.
        const cmd = parseBotCommand(msg.text);
        if (cmd) {
          const transport = transports.byName.get(msg.transport);
          if (!transport) {
            appendDaemonLog(
              `bot command /${cmd.name} from ${msg.sender_id}: no outbound transport for ${msg.transport}`,
            );
            return;
          }
          let reply;
          if (cmd.name === 'sessions') reply = buildSessionsReply([...sessions.values()]);
          else if (cmd.name === 'status')
            reply = buildStatusReply(
              {
                pid: process.pid,
                startedAt,
                outbound: [...transports.byName.keys()],
                inbound: inboundTransports.map((t) => t.name),
                eventsSeen,
                lastEventAt,
              },
              sessions.size,
            );
          else reply = buildHelpReply();
          try {
            await transport.send({ id: msg.channel_id }, reply);
            appendDaemonLog(`bot command /${cmd.name} from ${msg.sender_id} → replied`);
          } catch (err) {
            appendDaemonLog(`bot command /${cmd.name} reply failed: ${(err as Error).message}`);
          }
          return;
        }

        // Routing priority: @name mention > reply-to-message > last session in channel.
        let sessionId: string | undefined;
        let routedBy: 'mention' | 'reply' | 'last' | undefined;
        let injectText = msg.text;

        const mention = parseMention(msg.text);
        if (mention.name) {
          const named = sessionsByName.get(mention.name);
          if (named) {
            sessionId = named;
            routedBy = 'mention';
            injectText = mention.text;
          } else {
            appendDaemonLog(
              `inbound ${msg.transport}: @${mention.name} did not match any active session`,
            );
            return;
          }
        }
        if (!sessionId && msg.reply_to_message_id) {
          sessionId = messageToSession.get(
            messageKey(msg.transport, msg.channel_id, msg.reply_to_message_id),
          );
          if (sessionId) routedBy = 'reply';
        }
        if (!sessionId) {
          sessionId = lastSessionByChannel.get(channelKey(msg.transport, msg.channel_id));
          if (sessionId) routedBy = 'last';
        }
        if (!sessionId) {
          appendDaemonLog(
            `inbound ${msg.transport} from ${msg.sender_id} in ${msg.channel_id}: no session bound`,
          );
          return;
        }
        const session = sessions.get(sessionId);
        if (!session) {
          appendDaemonLog(
            `inbound ${msg.transport}: session ${sessionId} no longer active (routed by ${routedBy})`,
          );
          return;
        }
        if (!injectText) {
          appendDaemonLog(`inbound ${msg.transport}: empty text after @mention, nothing to inject`);
          return;
        }
        session.inject(injectText);
        appendDaemonLog(
          `inbound ${msg.transport} from ${msg.sender_id} -> session ${sessionId} via ${routedBy} (${injectText.length} chars)`,
        );
      });
      appendDaemonLog(`inbound ${inbound.name} started`);
    } catch (err) {
      appendDaemonLog(`inbound ${inbound.name} failed to start: ${(err as Error).message}`);
    }
  }

  console.log(`claude-beep daemon listening on ${SOCKET_PATH}`);
  console.log(`pid=${process.pid}`);
  console.log(`outbound: ${[...transports.byName.keys()].join(', ') || '(none)'}`);
  console.log(`inbound:  ${inboundTransports.map((t) => t.name).join(', ') || '(none)'}`);
  console.log(`pastebin: ${pastebin ? pastebin.name : 'disabled'}`);
  if (dryRun) console.log('mode: dry-run (no real messages will be sent)');

  const shutdown = async () => {
    appendDaemonLog('daemon shutting down');
    for (const inbound of inboundTransports) {
      try {
        await inbound.stop();
      } catch {
        /* ignore */
      }
    }
    for (const session of sessions.values()) {
      try {
        session.close();
      } catch {
        /* ignore */
      }
    }
    server.close();
    setTimeout(() => process.exit(0), 100).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function maybePasteExcerpt(
  message: ChatMessage,
  config: Config,
  pastebin: PastebinProvider | undefined,
): Promise<ChatMessage> {
  if (!pastebin) return message;
  if (!message.excerpt) return message;
  if (message.excerpt.length <= config.pastebin.threshold_chars) return message;

  try {
    const title = `${message.title} · ${new Date().toISOString().slice(0, 19)}`;
    const url = await pastebin.upload(message.excerpt, { title, language: 'markdown' });
    const preview = message.excerpt.slice(0, config.pastebin.preview_chars).trimEnd();
    appendDaemonLog(
      `pastebin (${pastebin.name}): ${message.excerpt.length} chars -> ${url}`,
    );
    return {
      ...message,
      excerpt: `${preview} …\n\nSee full response: ${url}`,
    };
  } catch (err) {
    appendDaemonLog(`pastebin upload failed: ${(err as Error).message}`);
    const preview = message.excerpt.slice(0, config.pastebin.preview_chars).trimEnd();
    return {
      ...message,
      excerpt: `${preview} …\n\n(pastebin upload failed — message truncated)`,
    };
  }
}
