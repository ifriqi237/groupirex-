/**
 * Point d'entrée de l'API GROUPDEALS.
 */

import { createApp } from './app';
import { loadConfig } from './config';
import { syncTranslations } from './modules/reference';
import { seedCatalog } from './seed-demo';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await syncTranslations(app);
  await app.start();
  await seedCatalogOnce(app);

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info('shutdown', { signal });
    app.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Chargement unique du catalogue de départ, demandé par SEED_CATALOG_FOR=<email d'un administrateur>.
 * Ne fait rien si le catalogue contient déjà un produit : retirez la variable une fois le chargement fait.
 */
async function seedCatalogOnce(app: Awaited<ReturnType<typeof createApp>>): Promise<void> {
  const email = process.env.SEED_CATALOG_FOR?.trim().toLowerCase();
  if (!email) return;
  try {
    if (await app.db.one(`SELECT 1 FROM products LIMIT 1`)) return app.log.info('seed_catalog', { skipped: 'catalogue déjà rempli' });
    const admin = await app.db.one(`SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id WHERE u.email = $1 AND r.role_code IN ('SUPER_ADMIN', 'ADMIN') LIMIT 1`, [email]);
    if (!admin) return app.log.info('seed_catalog', { skipped: 'administrateur introuvable' });
    const support = await app.reference.support();
    const r = await seedCatalog(app, { adminId: admin.id, phone: support.phone, email: support.email });
    app.log.info('seed_catalog', { done: true, ...r });
  } catch (e) {
    app.log.info('seed_catalog', { error: (e as Error).message });
  }
}

main().catch((e) => {
  process.stderr.write(`${(e as Error)?.message ?? e}\n`);
  process.exit(1);
});
