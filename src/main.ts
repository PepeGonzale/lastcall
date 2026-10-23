import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { AuctionService } from './app/service.js';
import { serializeLot } from './app/views.js';
import { CloseDueLots } from './app/close-lots.js';
import { CreateLot } from './app/create-lot.js';
import { Projector } from './app/projector.js';
import { ReplayLog } from './app/replay.js';
import { seedDemo } from './app/seed.js';
import { SystemClock } from './infra/clock.js';
import { config } from './infra/config.js';
import { createPool, migrate } from './infra/db.js';
import { PostgresEventLog } from './infra/postgres/log.js';
import { PostgresLotUnitOfWork } from './infra/postgres/uow.js';
import { PostgresReadModel, PostgresStore } from './infra/postgres/store.js';
import { Hub } from './http/hub.js';
import { registerRoutes } from './http/routes.js';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', 'web', 'dist');

async function main(): Promise<void> {
  const pool = createPool(config.databaseUrl);
  const applied = await migrate(pool);
  if (applied.length > 0) console.log(`[db] applied ${applied.join(', ')}`);

  const clock = new SystemClock();
  const log = new PostgresEventLog(pool);
  const store = new PostgresStore(pool);
  const readModel = new PostgresReadModel(pool);
  const uow = new PostgresLotUnitOfWork(pool);
  const hub = new Hub();

  const projector = new Projector(log, store, hub.broadcast, {
    consumer: 'lot-projection',
    pollMs: config.projector.pollMs,
    batchSize: config.projector.batchSize,
  });
  const closeDueLots = new CloseDueLots(uow, store, clock);
  const createLot = new CreateLot(uow, clock);
  const service = new AuctionService({
    rules: config.rules,
    clock,
    log,
    uow,
    writeModel: store,
    readModel,
    projector,
    closeDueLots,
    replay: new ReplayLog(log),
  });

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });
  await app.register(websocket);
  await app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket) => {
      hub.add(socket);
      socket.on('close', () => hub.remove(socket));
      socket.on('error', () => hub.remove(socket));

      void (async () => {
        const [lots, stats] = await Promise.all([readModel.listLots(), service.stats()]);
        socket.send(JSON.stringify({ type: 'snapshot', lots: lots.map(serializeLot), stats }));
      })();
    });
  });

  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
  } else {
    app.get('/', async (_request, reply) =>
      reply
        .type('text/plain')
        .send('LastCall API is up. Run `pnpm build` (or `pnpm web:dev`) to serve the UI.'),
    );
  }

  registerRoutes(app, {
    service,
    projector,
    closeDueLots,
    createLot,
    store,
    hub,
    seed: () => seedDemo(createLot, service.placeBid),
  });

  await projector.start();

  const existing = await log.count();
  if (existing === 0) {
    const seeded = await seedDemo(createLot, service.placeBid);
    console.log(`[seed] ${seeded.lots} lots, ${seeded.bids} bids`);
  }

  const sweep = setInterval(() => {
    closeDueLots.execute().catch((error: unknown) => console.error('[sweep]', error));
  }, 250);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[shutdown] ${signal}`);
    clearInterval(sweep);
    await projector.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  console.log(`\n  LASTCALL  http://${config.host}:${config.port}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
