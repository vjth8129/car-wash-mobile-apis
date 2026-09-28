import { env } from '../config/env';
import { logger } from '../config/logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

class ConsoleMailProvider implements MailProvider {
  async send(message: MailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      '[dev-mail] Email would be sent (MAIL_PROVIDER=console)',
    );
  }
}

class SmtpMailProvider implements MailProvider {
  async send(message: MailMessage): Promise<void> {
    // Production SMTP integration point. Wire up nodemailer (or another provider SDK)
    // here using env.SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD.
    logger.info({ to: message.to, subject: message.subject }, 'Sending email via SMTP provider');
    throw new Error(
      'SMTP mail provider is not configured. Install and configure nodemailer (or your provider SDK) in src/utils/mailer.ts.',
    );
  }
}

export const mailer: MailProvider =
  env.MAIL_PROVIDER === 'smtp' ? new SmtpMailProvider() : new ConsoleMailProvider();

export async function sendPasswordResetCodeEmail(to: string, code: string): Promise<void> {
  await mailer.send({
    to,
    subject: 'Your Car Wash password reset code',
    text: `Your password reset code is ${code}. It expires shortly and can be used once.\n\nIf you did not request this, you can safely ignore this email.`,
  });
}
