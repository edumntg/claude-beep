export interface InboundMessage {
  transport: 'telegram' | 'discord' | 'slack';
  sender_id: string;
  channel_id: string;
  text: string;
  reply_to_message_id?: string;
}

export type InboundHandler = (msg: InboundMessage) => void | Promise<void>;

export interface InboundTransport {
  readonly name: 'telegram' | 'discord' | 'slack';
  start(onMessage: InboundHandler): Promise<void>;
  stop(): Promise<void>;
}
