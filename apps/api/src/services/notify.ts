/**
 * Notifications (§33).
 *
 * Une notification est d'abord une ligne en base (visible dans l'application),
 * puis une entrée par canal dans une file d'envoi. L'envoi réel est découplé de
 * l'action métier : un fournisseur indisponible ne bloque jamais une commande,
 * et l'envoi est rejoué automatiquement.
 *
 * Les canaux externes sont des ports : la V1 livre un envoi « console » (journal
 * + boîte d'envoi consultable) ; brancher un fournisseur réel revient à
 * implémenter ChannelSender, sans toucher au code métier.
 */

import type { App } from '../app';
import type { Db } from '../db/pool';

export type NotificationType =
  | 'WELCOME'
  | 'EMAIL_VERIFY'
  | 'PASSWORD_RESET'
  | 'DEAL_NEW'
  | 'DEAL_ENDING'
  | 'DEAL_CANCELLED'
  | 'DEAL_CONFIRMED'
  | 'ORDER_CREATED'
  | 'ORDER_EXPIRED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_FAILED'
  | 'REFUND_PENDING'
  | 'REFUND_DONE'
  | 'LOGISTICS_STEP'
  | 'MATCHING_PUBLISHED'
  | 'MATCHING_REJECTED'
  | 'MATCHING_CONVERTED'
  | 'MATCHING_THRESHOLD';

export type Channel = 'PUSH' | 'EMAIL' | 'WHATSAPP';

/** Notifications qui partent toujours par email, quelles que soient les préférences. */
const TRANSACTIONAL: NotificationType[] = ['EMAIL_VERIFY', 'PASSWORD_RESET'];

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  params?: Record<string, unknown>;
  link?: string | null;
  /** Limiter les canaux (par défaut : selon les préférences de l'utilisateur). */
  channels?: Channel[];
  /** Ne pas l'afficher dans la liste des notifications de l'application. */
  silent?: boolean;
}

export async function notify(db: Db, input: NotifyInput): Promise<void> {
  const user = await db.one('SELECT notification_prefs FROM users WHERE id = $1', [input.userId]);
  if (!user) return;
  const prefs = (user.notification_prefs ?? {}) as Record<string, boolean>;
  const row = await db.one(
    `INSERT INTO notifications (user_id, type, params, link, read_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.userId, input.type, JSON.stringify(input.params ?? {}), input.link ?? null, input.silent ? new Date() : null],
  );
  const channels: Channel[] = TRANSACTIONAL.includes(input.type)
    ? ['EMAIL']
    : (input.channels ?? (['PUSH', 'EMAIL', 'WHATSAPP'] as Channel[])).filter((c) => prefs[c.toLowerCase()] !== false);
  for (const channel of channels) {
    await db.query(
      `INSERT INTO notification_outbox (notification_id, channel) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [row!.id, channel],
    );
  }
}

export async function notifyMany(db: Db, userIds: string[], input: Omit<NotifyInput, 'userId'>): Promise<void> {
  for (const userId of [...new Set(userIds)]) await notify(db, { ...input, userId });
}

/**
 * Notification de masse en une seule requête (nouvelle offre, offre bientôt terminée…).
 * `audienceSql` doit renvoyer une colonne user_id ; ses paramètres commencent à $4.
 */
export async function broadcast(
  db: Db,
  type: NotificationType,
  params: Record<string, unknown>,
  link: string | null,
  audienceSql: string,
  audienceParams: unknown[],
): Promise<number> {
  const res = await db.query(
    `WITH audience AS (${audienceSql}),
          created AS (
            INSERT INTO notifications (user_id, type, params, link)
            SELECT DISTINCT a.user_id, $1, $2::jsonb, $3 FROM audience a JOIN users u ON u.id = a.user_id WHERE u.status = 'ACTIVE'
            RETURNING id, user_id)
     INSERT INTO notification_outbox (notification_id, channel)
     SELECT c.id, ch FROM created c JOIN users u ON u.id = c.user_id
      CROSS JOIN unnest(ARRAY['PUSH', 'EMAIL', 'WHATSAPP']) AS ch
      WHERE COALESCE((u.notification_prefs ->> lower(ch))::boolean, true)`,
    [type, JSON.stringify(params), link, ...audienceParams],
  );
  return res.rowCount;
}

/* ------------------------------------------------------------------ */
/* Envoi                                                               */
/* ------------------------------------------------------------------ */

export interface OutboundMessage {
  channel: Channel;
  type: NotificationType;
  params: Record<string, unknown>;
  link: string | null;
  user: { id: string; email: string; whatsapp: string; firstName: string; languageCode: string };
  deviceTokens: string[];
}

export interface ChannelSender {
  readonly channel: Channel;
  /** Renvoie false si le canal n'est pas configuré (l'envoi est alors marqué « ignoré »). */
  send(message: OutboundMessage): Promise<boolean>;
}

/** Envoi de développement : écrit le message dans le journal. */
export class ConsoleSender implements ChannelSender {
  constructor(
    readonly channel: Channel,
    private readonly app: App,
  ) {}
  async send(m: OutboundMessage): Promise<boolean> {
    if (this.channel === 'PUSH' && m.deviceTokens.length === 0) return false;
    this.app.log.info('notification', {
      channel: this.channel,
      type: m.type,
      to: this.channel === 'EMAIL' ? m.user.email : this.channel === 'WHATSAPP' ? m.user.whatsapp : `${m.deviceTokens.length} appareil(s)`,
      params: m.params,
      link: m.link ? this.app.config.publicUrl + m.link : null,
    });
    return true;
  }
}

/** Traite un lot de la file d'envoi. Appelé par les tâches de fond. */
export async function processOutbox(app: App, senders: Record<Channel, ChannelSender>, batch = 50): Promise<number> {
  const now = app.clock.now();
  const due = await app.db.all(
    `SELECT o.id, o.channel, o.attempts, n.type, n.params, n.link,
            u.id AS user_id, u.email, u.whatsapp, u.first_name, u.language_code,
            COALESCE((SELECT array_agg(token) FROM device_tokens d WHERE d.user_id = u.id), '{}') AS tokens
       FROM notification_outbox o
       JOIN notifications n ON n.id = o.notification_id
       JOIN users u ON u.id = n.user_id
      WHERE o.status = 'PENDING' AND o.next_attempt_at <= $1
      ORDER BY o.next_attempt_at LIMIT $2`,
    [now, batch],
  );
  for (const row of due) {
    try {
      const sent = await senders[row.channel as Channel].send({
        channel: row.channel,
        type: row.type,
        params: row.params,
        link: row.link,
        user: { id: row.user_id, email: row.email, whatsapp: row.whatsapp, firstName: row.first_name, languageCode: row.language_code },
        deviceTokens: row.tokens,
      });
      await app.db.query(`UPDATE notification_outbox SET status = $2, sent_at = $3, attempts = attempts + 1 WHERE id = $1`, [
        row.id,
        sent ? 'SENT' : 'SKIPPED',
        sent ? now : null,
      ]);
    } catch (e) {
      const attempts = row.attempts + 1;
      // Nouvel essai après 1, 5, 25 minutes… puis abandon au 5e échec.
      await app.db.query(
        `UPDATE notification_outbox SET attempts = $2, last_error = $3, status = $4, next_attempt_at = $5 WHERE id = $1`,
        [row.id, attempts, String(e).slice(0, 500), attempts >= 5 ? 'FAILED' : 'PENDING', new Date(now.getTime() + 60_000 * 5 ** (attempts - 1))],
      );
    }
  }
  return due.length;
}
