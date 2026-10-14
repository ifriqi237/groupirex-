/**
 * Tâches de fond, exécutées dans le processus de l'API.
 *
 * Chaque tâche prend un verrou consultatif PostgreSQL avant de tourner : avec
 * plusieurs instances de l'API, une seule exécute une tâche donnée à un instant.
 */

import type { App } from '../app';
import { Channel, ChannelSender, ConsoleSender, broadcast, processOutbox } from './notify';
import { expireUnpaidOrders } from './orders';
import { dealOpenIn } from './pricing';
import { SmtpSender } from './email';

interface Job {
  name: string;
  everyMs: number;
  lockId: number;
  run(): Promise<unknown>;
}

export class Jobs {
  private timers: NodeJS.Timeout[] = [];
  readonly senders: Record<Channel, ChannelSender>;
  private readonly jobs: Job[];

  constructor(private readonly app: App) {
    this.senders = {
      EMAIL: app.config.smtp ? new SmtpSender(app, app.config.smtp) : new ConsoleSender('EMAIL', app),
      PUSH: new ConsoleSender('PUSH', app),
      WHATSAPP: new ConsoleSender('WHATSAPP', app),
    };
    this.jobs = [
      { name: 'expire-orders', everyMs: 60_000, lockId: 727275001, run: () => expireUnpaidOrders(app) },
      { name: 'outbox', everyMs: 15_000, lockId: 727275002, run: () => processOutbox(app, this.senders) },
      { name: 'deals-ending-soon', everyMs: 10 * 60_000, lockId: 727275003, run: () => this.notifyEndingSoon() },
      { name: 'purge-tokens', everyMs: 6 * 3_600_000, lockId: 727275004, run: () => this.purge() },
    ];
  }

  /** Exécute une tâche une fois, sous verrou. Renvoie false si une autre instance la tient déjà. */
  async runOnce(name: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`Tâche inconnue : ${name}`);
    return this.app.db.tx(async (tx) => {
      const lock = await tx.one(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [job.lockId]);
      if (!lock!.ok) return false;
      await job.run();
      return true;
    });
  }

  start(): void {
    for (const job of this.jobs) {
      const tick = () => {
        this.runOnce(job.name).catch((e) => this.app.log.error('job_failed', { job: job.name, error: String((e as Error)?.stack ?? e) }));
      };
      const timer = setInterval(tick, job.everyMs);
      timer.unref();
      this.timers.push(timer);
      setTimeout(tick, 2_000).unref();
    }
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /** « Offre bientôt terminée » : prévient une fois ceux qui l'ont en favori ou une commande à payer. */
  private async notifyEndingSoon(): Promise<number> {
    const hours = await this.app.reference.setting('deals.ending_soon_hours', 48);
    const now = this.app.clock.now();
    const deals = await this.app.db.all(
      `SELECT d.id, d.slug, d.product_id, d.ends_at, COALESCE(d.title, p.name) AS title
         FROM group_deals d JOIN products p ON p.id = d.product_id
        WHERE d.stored_status = 'PUBLISHED' AND d.ending_notified_at IS NULL AND d.starts_at <= $1
          AND d.ends_at > $1 AND d.ends_at <= $2`,
      [now, new Date(now.getTime() + hours * 3_600_000)],
    );
    for (const d of deals) {
      await this.app.db.tx(async (tx) => {
        const claimed = await tx.one(`UPDATE group_deals SET ending_notified_at = $2 WHERE id = $1 AND ending_notified_at IS NULL RETURNING id`, [d.id, now]);
        if (!claimed) return;
        await broadcast(
          tx, 'DEAL_ENDING', { title: d.title, endsAt: (d.ends_at as Date).toISOString() }, `/deals/${d.slug}`,
          `SELECT f.user_id FROM favorites f JOIN users u ON u.id = f.user_id JOIN group_deals d ON d.id = $5
            WHERE f.product_id = $4 AND ${dealOpenIn('d', 'u.country_code')}
           UNION SELECT user_id FROM orders WHERE deal_id = $5 AND payment_status IN ('PENDING', 'FAILED')`,
          [d.product_id, d.id],
        );
      });
    }
    return deals.length;
  }

  private async purge(): Promise<void> {
    const cutoff = new Date(this.app.clock.now().getTime() - 30 * 86_400_000);
    await this.app.db.query(`DELETE FROM auth_tokens WHERE expires_at < $1`, [cutoff]);
    await this.app.db.query(`DELETE FROM refresh_tokens WHERE expires_at < $1`, [cutoff]);
    await this.app.db.query(`DELETE FROM notification_outbox WHERE status IN ('SENT', 'SKIPPED') AND next_attempt_at < $1`, [cutoff]);
  }
}
