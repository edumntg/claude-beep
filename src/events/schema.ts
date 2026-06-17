import { z } from 'zod';

export const BaseEventSchema = z
  .object({
    session_id: z.string().optional(),
    transcript_path: z.string().optional(),
    cwd: z.string().optional(),
    hook_event_name: z.string().optional(),
  })
  .passthrough();

export type BaseEvent = z.infer<typeof BaseEventSchema>;

export interface NormalizedEvent {
  event_type: string;
  received_at: number;
  raw: BaseEvent;
  wrapper_id?: string;
  session_name?: string;
}
