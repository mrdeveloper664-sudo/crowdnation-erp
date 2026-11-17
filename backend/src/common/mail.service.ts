import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface Mail { to: string; subject: string; text: string; token?: string; kind?: string }

/**
 * Mail transport. Set SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465, or an SES SMTP endpoint)
 * and MAIL_FROM to send real email. Without SMTP_URL messages are only logged and kept in `outbox`
 * (development and e2e tests).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  readonly outbox: Mail[] = [];
  private transport: { sendMail(m: nodemailer.SendMailOptions): Promise<unknown> } | null = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;

  /** Test hook: swap the transport (e.g. nodemailer's jsonTransport). */
  useTransport(t: { sendMail(m: nodemailer.SendMailOptions): Promise<unknown> } | null) { this.transport = t; }

  async send(mail: Mail) {
    this.outbox.push(mail);
    if (this.outbox.length > 200) this.outbox.shift();
    if (this.transport) {
      try {
        await this.transport.sendMail({ from: process.env.MAIL_FROM ?? 'NEXERP <no-reply@localhost>', to: mail.to, subject: mail.subject, text: mail.text });
      } catch (e) {
        // a mail outage must never break registration / password reset flows
        this.logger.error(`Failed to send "${mail.subject}": ${(e as Error).message}`);
      }
      return;
    }
    if (process.env.NODE_ENV !== 'test') this.logger.log(`to=${mail.to} subject="${mail.subject}"${mail.token ? ' (token delivered)' : ''}`);
  }
}
