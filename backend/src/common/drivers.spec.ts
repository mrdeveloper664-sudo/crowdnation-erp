import * as nodemailer from 'nodemailer';
import { S3Storage } from '../attachments/s3-storage';
import { MailService } from './mail.service';

describe('MailService (SMTP driver)', () => {
  it('sends through the configured transport with the From address', async () => {
    process.env.MAIL_FROM = 'NEXERP <no-reply@example.com>';
    const mail = new MailService();
    const t = nodemailer.createTransport({ jsonTransport: true });
    mail.useTransport(t);
    const sent: any[] = [];
    const orig = t.sendMail.bind(t);
    (t as any).sendMail = async (m: any) => { sent.push(m); return orig(m); };
    await mail.send({ to: 'a@b.test', subject: 'Hello', text: 'body', kind: 'verify' });
    expect(sent[0]).toMatchObject({ to: 'a@b.test', subject: 'Hello', from: 'NEXERP <no-reply@example.com>' });
    expect(mail.outbox).toHaveLength(1);
  });
  it('a failing transport never throws into the caller', async () => {
    const mail = new MailService();
    mail.useTransport({ sendMail: async () => { throw new Error('smtp down'); } });
    await expect(mail.send({ to: 'a@b.test', subject: 'x', text: 'y' })).resolves.toBeUndefined();
  });
});

describe('S3Storage', () => {
  it('puts, gets and deletes objects and rejects path traversal', async () => {
    const store = new Map<string, Buffer>();
    const client: any = {
      send: async (cmd: any) => {
        const name = cmd.constructor.name; const key = cmd.input.Key;
        if (name === 'PutObjectCommand') { store.set(key, cmd.input.Body); expect(cmd.input.ServerSideEncryption).toBe('AES256'); return {}; }
        if (name === 'GetObjectCommand') return { Body: { transformToByteArray: async () => new Uint8Array(store.get(key)!) } };
        if (name === 'DeleteObjectCommand') { store.delete(key); return {}; }
        throw new Error('unexpected ' + name);
      },
    };
    const s = new S3Storage(client, 'bucket');
    await s.put('c1/file.pdf', Buffer.from('%PDF-1'));
    expect((await s.get('c1/file.pdf')).toString()).toBe('%PDF-1');
    await s.delete('c1/file.pdf');
    expect(store.size).toBe(0);
    await expect(s.put('../evil', Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
    await expect(s.put('/abs', Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
  });
  it('requires a bucket', () => { delete process.env.S3_BUCKET; expect(() => new S3Storage({ send: async () => ({}) } as any)).toThrow(/S3_BUCKET/); });
});
