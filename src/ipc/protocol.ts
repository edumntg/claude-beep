import type { NormalizedEvent } from '../events/schema.js';

export interface StatusResponse {
  type: 'status';
  pid: number;
  uptime_ms: number;
  started_at: number;
  outbound: string[];
  inbound: string[];
  sessions: Array<{ session_id: string; pid: number; cwd: string; name?: string }>;
  events_seen: number;
  last_event_at?: number;
}

export type IpcMessage =
  | { type: 'event'; payload: NormalizedEvent }
  | { type: 'register'; session_id: string; pid: number; cwd: string; name?: string }
  | { type: 'unregister'; session_id: string }
  | { type: 'inject'; text: string }
  | { type: 'query' }
  | StatusResponse;

export const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
