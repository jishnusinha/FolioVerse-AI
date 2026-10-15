import { Global, Injectable, Logger, Module } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env';

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private transporter?: Transporter;
  /** Last messages, kept only in test so suites can read tokens without an SMTP server. */
  readonly outbox: OutboundMail[] = [];

  async send(m: OutboundMail) {
    if (env().NODE_ENV === 'test') {
      this.outbox.push(m);
      return;
    }
    if (!env().FV_MAIL_ENABLED) {
      this.log.log(`Mail disabled (FV_MAIL_ENABLED=false); not sent: subject="${m.subject}"`);
      return;
    }
    try {
      this.transporter ??= nodemailer.createTransport(env().SMTP_URL);
      await this.transporter.sendMail({ from: env().MAIL_FROM, ...m });
    } catch (e) {
      this.log.warn(`Mail delivery failed (${(e as Error).message}); subject="${m.subject}"`);
    }
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
