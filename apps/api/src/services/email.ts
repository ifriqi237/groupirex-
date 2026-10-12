/**
 * Envoi des emails par SMTP (vérification de l'adresse, mot de passe oublié, notifications).
 *
 * Fonctionne avec tout serveur SMTP : la messagerie de votre hébergeur (par exemple
 * smtp.hostinger.com, port 465), Brevo, Mailgun, Amazon SES, Google Workspace…
 * Configuration : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM (voir .env.example).
 *
 * Le client SMTP est écrit ici, sans dépendance : connexion chiffrée (port 465) ou
 * STARTTLS (port 587), authentification LOGIN ou PLAIN, message texte + HTML en UTF-8.
 */

import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import type { App } from '../app';
import type { ChannelSender, OutboundMessage, NotificationType } from './notify';

export interface SmtpConfig {
  host: string;
  port: number;
  /** "ssl" : chiffré dès la connexion (465) ; "starttls" : chiffrement demandé ensuite (587) ; "none" : en clair (tests seulement). */
  security: 'ssl' | 'starttls' | 'none';
  user: string;
  password: string;
  /** Adresse d'expédition, par exemple « GROUPDEALS <no-reply@groupdeals.com> ». */
  from: string;
  /** Vérifier le certificat du serveur (true sauf exception). */
  rejectUnauthorized: boolean;
  timeoutMs: number;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/* ------------------------------------------------------------------ */
/* Client SMTP minimal                                                 */
/* ------------------------------------------------------------------ */

class SmtpConnection {
  private socket: net.Socket | tls.TLSSocket;
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(socket: net.Socket | tls.TLSSocket, private readonly timeoutMs: number) {
    this.socket = socket;
    this.attach(socket);
  }

  private attach(socket: net.Socket | tls.TLSSocket) {
    socket.setEncoding('utf8');
    socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error('SMTP : délai dépassé')));
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (e) => {
      this.failure = e;
      this.flush();
    });
    socket.on('close', () => {
      if (!this.failure) this.failure = new Error('SMTP : connexion fermée par le serveur');
      this.flush();
    });
  }

  private flush() {
    if (!this.waiting) return;
    // Une réponse est complète quand sa dernière ligne a la forme « 250 texte » (sans tiret).
    const lines = this.buffer.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
        const reply = lines.slice(0, i + 1).join('\n');
        this.buffer = lines.slice(i + 1).join('\r\n');
        const done = this.waiting;
        this.waiting = null;
        done(reply);
        return;
      }
    }
    if (this.failure) {
      const done = this.waiting;
      this.waiting = null;
      done('');
    }
  }

  /** Attend la réponse du serveur et vérifie son code. */
  read(expected: number[]): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiting = (reply) => {
        if (!reply) return reject(this.failure ?? new Error('SMTP : pas de réponse'));
        const code = parseInt(reply.slice(0, 3), 10);
        if (!expected.includes(code)) return reject(new Error(`SMTP : réponse inattendue « ${reply.split('\n').pop()} »`));
        resolve(reply);
      };
      this.flush();
    });
  }

  async command(line: string, expected: number[]): Promise<string> {
    this.socket.write(line + '\r\n');
    return this.read(expected);
  }

  /** Passe la connexion en TLS (STARTTLS). */
  async upgrade(host: string, rejectUnauthorized: boolean): Promise<void> {
    const plain = this.socket;
    plain.removeAllListeners('data');
    plain.removeAllListeners('error');
    plain.removeAllListeners('close');
    plain.setTimeout(0);
    const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const s = tls.connect({ socket: plain, servername: host, rejectUnauthorized }, () => resolve(s));
      s.once('error', reject);
    });
    this.socket = secure;
    this.buffer = '';
    this.attach(secure);
  }

  write(data: string) {
    this.socket.write(data);
  }

  close() {
    this.socket.end();
  }
}

function connect(cfg: SmtpConfig): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => reject(e);
    const socket =
      cfg.security === 'ssl'
        ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized }, () => resolve(socket))
        : net.connect({ host: cfg.host, port: cfg.port }, () => resolve(socket));
    socket.once('error', onError);
    socket.setTimeout(cfg.timeoutMs, () => socket.destroy(new Error('SMTP : connexion impossible (délai dépassé)')));
  });
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
/** Encodage des en-têtes non ASCII (RFC 2047). */
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s: string) => s.replace(/.{1,76}/g, (m) => m + '\r\n');
const addressOf = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim();

/** Construit le message MIME (texte + HTML, en base64 : aucune ligne ne commence par un point). */
export function buildMime(from: string, mail: Mail, now = new Date()): string {
  const boundary = `gd-${crypto.randomBytes(12).toString('hex')}`;
  const fromMatch = /^(.*?)\s*<([^>]+)>$/.exec(from);
  const fromHeader = fromMatch ? `${header(fromMatch[1].replace(/^"|"$/g, ''))} <${fromMatch[2]}>` : from;
  const domain = addressOf(from).split('@')[1] ?? 'groupdeals.local';
  return [
    `From: ${fromHeader}`,
    `To: ${mail.to}`,
    `Subject: ${header(mail.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(mail.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(mail.html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export async function sendMail(cfg: SmtpConfig, mail: Mail): Promise<void> {
  const conn = new SmtpConnection(await connect(cfg), cfg.timeoutMs);
  try {
    await conn.read([220]);
    const me = 'groupdeals';
    let ehlo = await conn.command(`EHLO ${me}`, [250]);
    if (cfg.security === 'starttls') {
      if (!/STARTTLS/i.test(ehlo)) throw new Error('SMTP : le serveur ne propose pas STARTTLS');
      await conn.command('STARTTLS', [220]);
      await conn.upgrade(cfg.host, cfg.rejectUnauthorized);
      ehlo = await conn.command(`EHLO ${me}`, [250]);
    }
    if (cfg.user) {
      if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo)) {
        await conn.command(`AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${cfg.password}`, 'utf8').toString('base64')}`, [235]);
      } else {
        await conn.command('AUTH LOGIN', [334]);
        await conn.command(b64(cfg.user), [334]);
        await conn.command(b64(cfg.password), [235]);
      }
    }
    await conn.command(`MAIL FROM:<${addressOf(cfg.from)}>`, [250]);
    await conn.command(`RCPT TO:<${addressOf(mail.to)}>`, [250, 251]);
    await conn.command('DATA', [354]);
    conn.write(buildMime(cfg.from, mail) + '\r\n.\r\n');
    await conn.read([250]);
    await conn.command('QUIT', [221]).catch(() => undefined);
  } finally {
    conn.close();
  }
}

/* ------------------------------------------------------------------ */
/* Contenu des emails                                                  */
/* ------------------------------------------------------------------ */

type Lang = 'fr' | 'en';

/** Mêmes textes que la page Notifications du site, en français et en anglais. */
const SUBJECT: Partial<Record<NotificationType, Record<Lang, string>>> = {
  WELCOME: { fr: 'Bienvenue sur GROUPDEALS. Découvrez les offres en cours.', en: 'Welcome to GROUPDEALS. Discover the ongoing offers.' },
  DEAL_NEW: { fr: 'Nouvelle offre : {title}', en: 'New offer: {title}' },
  DEAL_ENDING: { fr: 'L’offre « {title} » se termine bientôt', en: 'The offer “{title}” is ending soon' },
  DEAL_CANCELLED: { fr: 'La campagne « {title} » a été annulée', en: 'The campaign “{title}” has been cancelled' },
  DEAL_CONFIRMED: { fr: 'La campagne « {title} » est confirmée : la commande groupée est lancée', en: 'The campaign “{title}” is confirmed: the group order has been placed' },
  ORDER_CREATED: { fr: 'Commande {number} enregistrée', en: 'Order {number} recorded' },
  ORDER_EXPIRED: { fr: 'Commande {number} : le délai de paiement est dépassé', en: 'Order {number}: the payment deadline has passed' },
  PAYMENT_CONFIRMED: { fr: 'Paiement confirmé pour la commande {number}', en: 'Payment confirmed for order {number}' },
  PAYMENT_FAILED: { fr: 'Le paiement de la commande {number} n’a pas abouti', en: 'The payment for order {number} did not go through' },
  REFUND_PENDING: { fr: 'Un remboursement est en cours pour la commande {number}', en: 'A refund is in progress for order {number}' },
  REFUND_DONE: { fr: 'La commande {number} a été remboursée', en: 'Order {number} has been refunded' },
  LOGISTICS_STEP: { fr: 'Suivi de commande : une nouvelle étape est franchie', en: 'Order tracking: a new step has been reached' },
  MATCHING_PUBLISHED: { fr: 'Votre demande « {title} » est publiée', en: 'Your request “{title}” is published' },
  MATCHING_REJECTED: { fr: 'Votre demande « {title} » n’a pas été retenue', en: 'Your request “{title}” was not accepted' },
  MATCHING_CONVERTED: { fr: '« {title} » est devenue une offre GROUPDEALS', en: '“{title}” is now a GROUPDEALS offer' },
  MATCHING_THRESHOLD: { fr: 'Matching : « {title} » atteint {interests} membres intéressés', en: 'Matching: “{title}” has reached {interests} interested members' },
};

const COPY = {
  fr: {
    hello: 'Bonjour {name},',
    verifySubject: 'Confirmez votre adresse email',
    verifyBody: 'Pour activer les commandes sur GROUPDEALS, confirmez votre adresse email. Le lien est valable 48 heures.',
    verifyButton: 'Confirmer mon adresse',
    resetSubject: 'Choisissez un nouveau mot de passe',
    resetBody: 'Vous avez demandé à changer votre mot de passe. Le lien est valable 1 heure. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.',
    resetButton: 'Choisir un nouveau mot de passe',
    open: 'Voir sur GROUPDEALS',
    footer: 'GROUPDEALS — une plateforme GROUPIREX. Vous recevez cet email parce que vous avez un compte GROUPDEALS. Gérez vos préférences dans votre profil.',
    fallback: 'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
  },
  en: {
    hello: 'Hello {name},',
    verifySubject: 'Confirm your email address',
    verifyBody: 'To enable orders on GROUPDEALS, please confirm your email address. The link is valid for 48 hours.',
    verifyButton: 'Confirm my address',
    resetSubject: 'Choose a new password',
    resetBody: 'You asked to change your password. The link is valid for 1 hour. If you did not make this request, ignore this message.',
    resetButton: 'Choose a new password',
    open: 'View on GROUPDEALS',
    footer: 'GROUPDEALS — a GROUPIREX platform. You receive this email because you have a GROUPDEALS account. Manage your preferences in your profile.',
    fallback: 'If the button does not work, copy this link into your browser:',
  },
};

const fill = (s: string, params: Record<string, unknown>) => s.replace(/\{(\w+)\}/g, (_, k) => (params[k] === undefined ? '' : String(params[k])));
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Compose l'email d'une notification. Renvoie null pour un type sans email. */
export function composeEmail(m: OutboundMessage, publicUrl: string): Mail | null {
  const lang: Lang = m.user.languageCode === 'en' ? 'en' : 'fr';
  const c = COPY[lang];
  const link = m.link ? publicUrl + m.link : null;
  let subject: string;
  let body: string;
  let button: string;
  if (m.type === 'EMAIL_VERIFY') {
    subject = c.verifySubject;
    body = c.verifyBody;
    button = c.verifyButton;
  } else if (m.type === 'PASSWORD_RESET') {
    subject = c.resetSubject;
    body = c.resetBody;
    button = c.resetButton;
  } else {
    const s = SUBJECT[m.type];
    if (!s) return null;
    subject = fill(s[lang], m.params);
    body = subject;
    button = c.open;
  }
  const hello = fill(c.hello, { name: m.user.firstName || '' }).replace(' ,', ',');
  const text = [hello, '', body, '', link ? `${button} : ${link}` : '', '', '—', c.footer].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:#F3F5F9;font-family:Arial,Helvetica,sans-serif;color:#0A1230">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden">
<tr><td style="background:#0A1230;padding:20px 28px;font-size:20px;font-weight:bold;color:#FFFFFF">GROUP<span style="color:#FF4F79">DEALS</span></td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55">
<p style="margin:0 0 16px">${escapeHtml(hello)}</p>
<p style="margin:0 0 24px">${escapeHtml(body)}</p>
${link ? `<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#FF4F79;color:#0A1230;font-weight:bold;text-decoration:none;padding:13px 26px;border-radius:999px">${escapeHtml(button)}</a></p>
<p style="margin:0;font-size:13px;color:#59638A">${escapeHtml(c.fallback)}<br><a href="${escapeHtml(link)}" style="color:#59638A;word-break:break-all">${escapeHtml(link)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #DDE2EC;font-size:12px;color:#59638A">${escapeHtml(c.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { to: m.user.email, subject, text, html };
}

/** Canal EMAIL branché sur SMTP. */
export class SmtpSender implements ChannelSender {
  readonly channel = 'EMAIL' as const;
  constructor(private readonly app: App, private readonly cfg: SmtpConfig) {}
  async send(m: OutboundMessage): Promise<boolean> {
    if (!m.user.email) return false;
    const mail = composeEmail(m, this.app.config.publicUrl);
    if (!mail) return false;
    await sendMail(this.cfg, mail);
    this.app.log.info('email', { type: m.type, to: m.user.email });
    return true;
  }
}
