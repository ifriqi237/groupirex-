import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';
import { buildMime, composeEmail, sendMail } from '../src/services/email';
import { TestEnv, startEnv } from './helpers';

/** Faux serveur SMTP : enregistre les commandes et le message reçu. */
function fakeSmtp(): Promise<{ port: number; commands: string[]; messages: string[]; close(): void }> {
  const commands: string[] = [];
  const messages: string[] = [];
  const server = net.createServer((socket) => {
    let inData = false;
    let data = '';
    let buffer = '';
    socket.write('220 fake.smtp ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          data += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          messages.push(data);
          data = '';
          inData = false;
          socket.write('250 2.0.0 Ok: queued\r\n');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        commands.push(line);
        if (/^EHLO/.test(line)) socket.write('250-fake.smtp\r\n250-AUTH LOGIN\r\n250 8BITMIME\r\n');
        else if (line === 'AUTH LOGIN') socket.write('334 VXNlcm5hbWU6\r\n');
        else if (commands[commands.length - 2] === 'AUTH LOGIN') socket.write('334 UGFzc3dvcmQ6\r\n');
        else if (commands[commands.length - 3] === 'AUTH LOGIN') socket.write('235 2.7.0 Authentication successful\r\n');
        else if (/^MAIL FROM|^RCPT TO/.test(line)) socket.write('250 Ok\r\n');
        else if (line === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (line === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else socket.write('502 Unknown\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, commands, messages, close: () => server.close() })));
}

const decodeParts = (raw: string) =>
  [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8'));

describe('Emails par SMTP', () => {
  let smtp: Awaited<ReturnType<typeof fakeSmtp>>;
  let env: TestEnv;
  before(async () => {
    smtp = await fakeSmtp();
    env = await startEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_SECURITY: 'none', SMTP_USER: 'no-reply@groupdeals.test', SMTP_PASSWORD: 'secret', MAIL_FROM: 'GROUPDEALS <no-reply@groupdeals.test>' });
  });
  after(async () => {
    await env.close();
    smtp.close();
  });

  it('le message est en UTF-8, avec un sujet encodé et des corps texte et HTML', () => {
    const raw = buildMime('GROUPDEALS <no-reply@groupdeals.test>', { to: 'awa@test.local', subject: 'Confirmez votre adresse — été', text: 'Bonjour Awa,', html: '<p>Bonjour Awa,</p>' });
    assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
    assert.deepEqual(decodeParts(raw), ['Bonjour Awa,', '<p>Bonjour Awa,</p>']);
    assert.ok(!/^\./m.test(raw), 'aucune ligne ne commence par un point');
  });

  it('l’inscription envoie l’email de vérification avec son lien, en français ou en anglais', async () => {
    const res = await env.api('POST', '/auth/register', { body: { firstName: 'Awa', lastName: 'Ndiaye', countryCode: 'SN', email: 'awa.mail@test.local', whatsapp: '+221770000099', password: 'Motdepasse2026', languageCode: 'fr' } });
    assert.equal(res.status, 201);
    await env.app.jobs.runOnce('outbox');
    // Deux emails : la vérification de l'adresse et le message de bienvenue.
    assert.equal(smtp.messages.length, 2);
    const raw = smtp.messages.find((m) => decodeParts(m)[0].includes('/verify-email?token='))!;
    assert.ok(raw, 'email de vérification reçu');
    assert.ok(smtp.commands.includes('MAIL FROM:<no-reply@groupdeals.test>') && smtp.commands.includes('RCPT TO:<awa.mail@test.local>'));
    assert.ok(smtp.commands.includes('AUTH LOGIN'), 'authentifié');
    const [text, html] = decodeParts(raw);
    assert.match(text, /Bonjour Awa,/);
    assert.match(text, /\/verify-email\?token=[\w-]{20,}/);
    assert.match(html, /Confirmer mon adresse/);
    const outbox = await env.app.db.one(`SELECT status FROM notification_outbox o JOIN notifications n ON n.id = o.notification_id WHERE n.type = 'EMAIL_VERIFY' AND o.channel = 'EMAIL' ORDER BY n.created_at DESC LIMIT 1`);
    assert.equal(outbox!.status, 'SENT');

    const en = composeEmail({ channel: 'EMAIL', type: 'PASSWORD_RESET', params: {}, link: '/reset-password?token=x', user: { id: '', email: 'g@test.local', whatsapp: '', firstName: 'Grace', languageCode: 'en' }, deviceTokens: [] }, 'https://groupdeals.example')!;
    assert.equal(en.subject, 'Choose a new password');
    assert.match(en.text, /Hello Grace,[\s\S]*https:\/\/groupdeals\.example\/reset-password\?token=x/);
  });

  it('un serveur SMTP injoignable : l’envoi est rejoué plus tard, sans bloquer', async () => {
    await assert.rejects(sendMail({ host: '127.0.0.1', port: 1, security: 'none', user: '', password: '', from: 'a@b.c', rejectUnauthorized: true, timeoutMs: 2000 }, { to: 'x@y.z', subject: 's', text: 't', html: 'h' }));
  });
});
