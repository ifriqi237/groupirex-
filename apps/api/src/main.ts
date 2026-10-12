/**
 * Point d'entrée de l'API GROUPDEALS.
 */

import { createApp } from './app';
import { loadConfig } from './config';
import { syncTranslations } from './modules/reference';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await syncTranslations(app);
  await app.start();

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

main().catch((e) => {
  process.stderr.write(`${(e as Error)?.message ?? e}\n`);
  process.exit(1);
});
