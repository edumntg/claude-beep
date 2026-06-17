export interface MessageField {
  icon: string;
  label: string;
  value: string;
}

export interface ChatMessage {
  title: string;
  emoji: string;
  fields: MessageField[];
  excerpt?: string;
  hint?: string;
  session_id?: string;
  session_label?: string;
  cwd?: string;
  event_type?: string;
}

export interface SendTarget {
  id: string;
}

export interface SendResult {
  message_id?: string;
}

export interface Transport {
  readonly name: 'telegram' | 'discord' | 'slack' | 'dry-run';
  send(target: SendTarget, message: ChatMessage): Promise<SendResult>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
