/**
 * Assemblage de l'application : configuration, base, services, routes, tâches.
 */

import http from 'node:http';
import { Config } from './config';
import { Pool, createPool } from './db/pool';
import { migrate } from './db/migrate';
import { RateLimiter, Router, createHttpServer } from './http/server';
import { AuthService } from './services/auth-service';
import { Reference } from './services/reference';
import { RbacCache } from './services/rbac-cache';
import { PaymentGateway, createGateway } from './services/gateway';
import { Jobs } from './services/jobs';
import { registerAuthRoutes } from './modules/auth';
import { registerReferenceRoutes } from './modules/reference';
import { registerCatalogRoutes } from './modules/catalog';
import { registerOrderRoutes } from './modules/orders';
import { registerPaymentRoutes } from './modules/payments';
import { registerOfficeRoutes } from './modules/offices';
import { registerLogisticsRoutes } from './modules/logistics';
import { registerMatchingRoutes } from './modules/matching';
import { registerProfileRoutes } from './modules/profile';
import { registerAdminRoutes } from './modules/admin';
import { registerAdminCatalogRoutes } from './modules/admin-catalog';

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  request(data: Record<string, unknown>): void;
}

export interface Clock {
  now(): Date;
  /** Décalage appliqué à l'horloge (tests uniquement). */
  offsetMs: number;
}

export interface App {
  config: Config;
  db: Pool;
  log: Logger;
  clock: Clock;
  router: Router;
  rateLimiter: RateLimiter;
  reference: Reference;
  rbac: RbacCache;
  auth: AuthService;
  gateway: PaymentGateway;
  jobs: Jobs;
  server: http.Server;
  start(): Promise<number>;
  stop(): Promise<void>;
}

function createLogger(level: Config['logLevel']): Logger {
  const write = (lvl: string, msg: string, data?: Record<string, unknown>) => {
    if (level === 'silent') return;
    process.stdout.write(JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...data }) + '\n');
  };
  return {
    info: (msg, data) => write('info', msg, data),
    error: (msg, data) => {
      // Les erreurs inattendues sont toujours écrites, même en mode silencieux.
      process.stderr.write(JSON.stringify({ time: new Date().toISOString(), level: 'error', msg, ...data }) + '\n');
    },
    request: (data) => {
      if (level === 'silent') return;
      if (level === 'info' && data.status === 200 && data.method === 'GET') return;
      write('info', 'request', data);
    },
  };
}

export async function createApp(config: Config, opts: { migrate?: boolean } = {}): Promise<App> {
  const db = await createPool(config.database);
  const log = createLogger(config.logLevel);
  if (opts.migrate ?? true) await migrate(db, log);

  const clock: Clock = {
    offsetMs: 0,
    now() {
      return new Date(Date.now() + this.offsetMs);
    },
  };

  const app = {
    config,
    db,
    log,
    clock,
    router: new Router(),
    rateLimiter: new RateLimiter(),
  } as App;

  app.reference = new Reference(app);
  app.rbac = new RbacCache(app);
  await app.rbac.syncFromCode();
  app.auth = new AuthService(app);
  app.gateway = createGateway(app);
  app.jobs = new Jobs(app);

  registerAuthRoutes(app);
  registerReferenceRoutes(app);
  registerCatalogRoutes(app);
  registerOrderRoutes(app);
  registerPaymentRoutes(app);
  registerOfficeRoutes(app);
  registerLogisticsRoutes(app);
  registerMatchingRoutes(app);
  registerProfileRoutes(app);
  registerAdminRoutes(app);
  registerAdminCatalogRoutes(app);

  app.server = createHttpServer(app);

  app.start = () =>
    new Promise<number>((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(config.port, () => {
        const address = app.server.address();
        const port = typeof address === 'object' && address ? address.port : config.port;
        if (config.runJobs) app.jobs.start();
        log.info('listening', { port, env: config.env, payments: config.payments.provider });
        resolve(port);
      });
    });

  app.stop = async () => {
    app.jobs.stop();
    app.rateLimiter.stop();
    await new Promise<void>((resolve) => {
      app.server.close(() => resolve());
      app.server.closeAllConnections?.();
    });
    await db.close();
  };

  return app;
}
