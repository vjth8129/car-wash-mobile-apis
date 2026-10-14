import { env } from '../config/env';
import { logger } from '../config/logger';
import type { PromotionChannel } from '../db/schema';

export interface OutgoingMessage {
  to: string;
  body: string;
  channel: PromotionChannel;
}

export interface MessageProvider {
  /** Stored on each promotion so the app can tell real deliveries from logged-only ones. */
  readonly name: string;
  /** Resolves once the provider accepted the message; throws with a readable reason otherwise. */
  send(message: OutgoingMessage): Promise<void>;
}

class ConsoleMessageProvider implements MessageProvider {
  readonly name = 'console';
  async send(message: OutgoingMessage): Promise<void> {
    logger.info(
      { to: message.to, channel: message.channel, body: message.body },
      '[dev-message] Promotion message would be sent (MESSAGE_PROVIDER=console)',
    );
  }
}

// Integration point for a real SMS / WhatsApp provider (MSG91, Twilio, Gupshup, ...): implement
// MessageProvider, add its name to MESSAGE_PROVIDER in config/env.ts and pick it here.
export const messenger: MessageProvider =
  env.MESSAGE_PROVIDER === 'console' ? new ConsoleMessageProvider() : new ConsoleMessageProvider();
