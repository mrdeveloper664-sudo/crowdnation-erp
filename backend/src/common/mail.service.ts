import { Injectable, Logger } from '@nestjs/common';

export interface Mail { to: string; subject: string; text: string; token?: string; kind?: string }

/**
 * Mail transport abstraction. No SMTP is configured in development: messages are logged
 * and kept in `outbox` (used by e2e tests). Replace `send` with SES/SMTP in production.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  readonly outbox: Mail[] = [];

  async send(mail: Mail) {
    this.outbox.push(mail);
    if (this.outbox.length > 200) this.outbox.shift();
    if (process.env.NODE_ENV !== 'test') this.logger.log(`to=${mail.to} subject="${mail.subject}"${mail.token ? ' (token delivered)' : ''}`);
  }
}
