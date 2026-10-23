import { z } from 'zod';
import { serializeLot } from '../app/views.js';
import type { AuctionService } from '../app/service.js';
import type { CreateLot } from '../app/create-lot.js';
import type { CloseDueLots } from '../app/close-lots.js';
import type { Projector } from '../app/projector.js';
import type { PostgresStore } from '../infra/postgres/store.js';
import type { Hub } from './hub.js';

const BidBody = z.object({
  bidder: z.string().trim().min(1).max(40),
  amount: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).max(120),
});

const CreateLotBody = z.object({
  lotId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  title: z.string().trim().min(1).max(120),
  startPrice: z.number().int().positive(),
  minIncrement: z.number().int().positive(),
  endsAt: z.number().int().positive(),
});

const LagBody = z.object({ ms: z.number().int().min(0).max(60_000) });

export interface Dependencies {
  service: AuctionService;
  projector: Projector;
  closeDueLots: CloseDueLots;
  createLot: CreateLot;
  store: PostgresStore;
  hub: Hub;
  seed: () => Promise<unknown>;
}

export function registerRoutes(app: import('fastify').FastifyInstance, deps: Dependencies): void {
  const { service, projector, closeDueLots, createLot, store, hub } = deps;

  app.get('/api/health', async () => ({ ok: true, ...(await service.stats()) }));

  app.get('/api/lots', async () => ({
    lots: (await service.deps.readModel.listLots()).map(serializeLot),
  }));

  app.get<{ Params: { lotId: string } }>('/api/lots/:lotId', async (request, reply) => {
    const { lotId } = request.params;
    const lot = await service.deps.readModel.getLot(lotId);
    if (!lot) return reply.code(404).send({ error: 'lot_not_found', lotId });

    const [bids, rejections] = await Promise.all([
      service.deps.readModel.listBids(lotId, 40),
      service.deps.readModel.listRejections(lotId, 12),
    ]);
    return { lot: serializeLot(lot), bids, rejections };
  });

  app.get<{ Params: { lotId: string }; Querystring: { until?: string } }>(
    '/api/lots/:lotId/timeline',
    async (request, reply) => {
      const { until } = request.query;
      const parsed = until === undefined ? undefined : Number(until);
      if (parsed !== undefined && !Number.isFinite(parsed)) {
        return reply.code(400).send({ error: 'invalid_until' });
      }
      const timeline = await service.timeline(request.params.lotId, parsed);
      if (!timeline.state) return reply.code(404).send({ error: 'lot_not_found' });
      return timeline;
    },
  );

  app.post<{ Params: { lotId: string } }>('/api/lots/:lotId/bids', async (request, reply) => {
    const body = BidBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_bid', issues: body.error.issues });
    }

    const { lotId } = request.params;
    const result = await service.bid({ lotId, ...body.data });

    // A refused bid is a business outcome, not a transport failure: the
    // command was processed and answered. 200 keeps that distinction honest.
    if (!result.outcome.ok) {
      const payload = {
        accepted: false,
        reason: result.outcome.reason,
        ...(result.outcome.minimum !== undefined ? { minimum: result.outcome.minimum } : {}),
      };
      hub.broadcast({ type: 'bid.rejected', lotId, ...payload, bidder: body.data.bidder, amount: body.data.amount });
      return payload;
    }

    return {
      accepted: true,
      duplicate: result.duplicate,
      eventId: result.outcome.eventId,
      amount: result.outcome.amount,
      extended: result.outcome.extended,
      endsAt: result.outcome.endsAt,
      position: result.envelopes[0]?.position ?? null,
    };
  });

  app.post('/api/lots', async (request, reply) => {
    const body = CreateLotBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_lot', issues: body.error.issues });
    const lot = await createLot.execute(body.data);
    return reply.code(201).send({ lot });
  });

  app.get('/api/chaos/state', async () => ({
    projector: await projector.status(),
    offsets: await projector.offsets(),
    counters: await service.deps.readModel.counters(),
  }));

  app.post<{ Params: { lotId: string } }>('/api/chaos/redeliver/:lotId', async (request) => {
    const result = await projector.redeliverLatest(request.params.lotId);
    return { action: 'redeliver', ...result, counters: await service.deps.readModel.counters() };
  });

  app.post<{ Params: { lotId: string } }>('/api/chaos/reorder/:lotId', async (request) => {
    const result = await projector.deliverOutOfOrder(request.params.lotId);
    return { action: 'reorder', ...result, counters: await service.deps.readModel.counters() };
  });

  app.post<{ Params: { lotId: string } }>('/api/chaos/poison/:lotId', async (request) => {
    const position = await service.injectPoison(request.params.lotId);
    return { action: 'poison', position, counters: await service.deps.readModel.counters() };
  });

  app.post('/api/chaos/lag', async (request, reply) => {
    const body = LagBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_lag' });
    projector.setLag(body.data.ms);
    return { action: 'lag', ms: body.data.ms, projector: await projector.status() };
  });

  app.post('/api/chaos/pause', async () => {
    projector.pause();
    return { action: 'pause', projector: await projector.status() };
  });

  app.post('/api/chaos/resume', async () => {
    projector.resume();
    return { action: 'resume', projector: await projector.status() };
  });

  app.post('/api/chaos/rebuild', async () => {
    await projector.rebuild();
    return { action: 'rebuild', projector: await projector.status() };
  });

  app.post('/api/chaos/tick', async () => {
    const applied = await projector.tick();
    return { action: 'tick', applied, projector: await projector.status() };
  });

  app.post('/api/chaos/close-sweep', async () => {
    const closed = await closeDueLots.execute();
    return { action: 'close-sweep', closed };
  });

  app.post('/api/demo/reset', async () => {
    await projector.pause();
    await store.resetAll();
    projector.resetState();
    const seeded = await deps.seed();
    // The seed appended to the log; project it before answering so the caller
    // never sees the read model mid-rebuild.
    await projector.catchUpNow();
    projector.resume();
    await projector.publishStatus();
    return { action: 'reset', seeded, projector: await projector.status() };
  });

}
