import nodemailer from 'nodemailer';
import { resetEnvCache } from '../../src/config/env';
import { MailService } from '../../src/modules/mail/mail.service';

describe('mail delivery switch', () => {
  const nodeEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.FV_SKIP_DOTENV = '1';
  });
  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
    delete process.env.FV_MAIL_ENABLED;
    delete process.env.FV_SKIP_DOTENV;
    resetEnvCache();
    jest.restoreAllMocks();
  });

  it('sends nothing and opens no SMTP connection when FV_MAIL_ENABLED=false', async () => {
    process.env.NODE_ENV = 'development';
    process.env.FV_MAIL_ENABLED = 'false';
    resetEnvCache();
    const create = jest.spyOn(nodemailer, 'createTransport');
    const mail = new MailService();
    await mail.send({ to: 'a@example.com', subject: 'Reset your FolioVerse password', text: 'token=secret-token' });
    expect(create).not.toHaveBeenCalled();
    expect(mail.outbox).toHaveLength(0);
  });
});
