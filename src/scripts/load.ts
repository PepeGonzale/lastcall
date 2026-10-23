/**
 * Load probe. It measures two different things on purpose:
 *
 *  1. contention on a single lot: everyone bids the same price at once. Only
 *     one bid can win, and the run fails if the engine ever double-accepts.
 *  2. throughput across lots: independent partitions, no contention, which is
 *     the number that actually says how fast the write path is.
 *
 * Usage: pnpm load -- --base=http://127.0.0.1:3333 --lots=12 --bids=25
 */
import { writeFile } from 'node:fs/promises';

interface Args {
  base: string;
  lots: number;
  bids: number;
  json: boolean;
  reset: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { base: 'http://127.0.0.1:3333', lots: 12, bids: 25, json: false, reset: true };
  for (const arg of argv) {
    if (arg.startsWith('--base=')) args.base = arg.slice('--base='.length);
    if (arg.startsWith('--lots=')) args.lots = Number(arg.slice('--lots='.length));
    if (arg.startsWith('--bids=')) args.bids = Number(arg.slice('--bids='.length));
    if (arg === '--json') args.json = true;
    if (arg === '--no-reset') args.reset = false;
  }
  return args;
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

async function postJson(path: string, body: unknown): Promise<{ status: number; json: any; ms: number }> {
  const started = performance.now();
  const response = await fetch(`${args.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, json, ms: performance.now() - started };
}

const args = parseArgs(process.argv.slice(2));
const stamp = Date.now().toString(36);

async function createLot(lotId: string, startPrice: number): Promise<void> {
  const response = await postJson('/api/lots', {
    lotId,
    title: `Load lot ${lotId}`,
    startPrice,
    minIncrement: 1_000,
    endsAt: Date.now() + 60 * 60 * 1000,
  });
  if (response.status !== 201) throw new Error(`create lot failed: ${JSON.stringify(response.json)}`);
}

async function contention(): Promise<{
  attempts: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  latencies: number[];
}> {
  const lotId = `contention-${stamp}`;
  await createLot(lotId, 100_000);

  const attempts = 50;
  const latencies: number[] = [];
  const results = await Promise.all(
    Array.from({ length: attempts }, async (_, index) => {
      const response = await postJson(`/api/lots/${lotId}/bids`, {
        bidder: `contender-${index}`,
        amount: 100_000,
        idempotencyKey: `${lotId}-${index}`,
      });
      latencies.push(response.ms);
      return response.json;
    }),
  );

  // Retry exactly one accepted bid with the same key: the engine must answer
  // "duplicate" and must not place a second bid.
  const winner = results.find((result) => result.accepted);
  let duplicates = 0;
  if (winner) {
    const winnerIndex = results.findIndex((result) => result.accepted);
    const retry = await postJson(`/api/lots/${lotId}/bids`, {
      bidder: `contender-${winnerIndex}`,
      amount: 100_000,
      idempotencyKey: `${lotId}-${winnerIndex}`,
    });
    duplicates = retry.json.duplicate ? 1 : 0;
  }

  return {
    attempts,
    accepted: results.filter((result) => result.accepted).length,
    rejected: results.filter((result) => !result.accepted).length,
    duplicates,
    latencies,
  };
}

async function throughput(): Promise<{
  bids: number;
  accepted: number;
  rejected: number;
  latencies: number[];
  wallMs: number;
}> {
  const startPrice = 100_000;
  const latencies: number[] = [];
  const perLot = await Promise.all(
    Array.from({ length: args.lots }, async (_, lotIndex) => {
      const lotId = `throughput-${stamp}-${lotIndex}`;
      await createLot(lotId, startPrice);
      const results: boolean[] = [];
      for (let bidIndex = 0; bidIndex < args.bids; bidIndex += 1) {
        const response = await postJson(`/api/lots/${lotId}/bids`, {
          bidder: `bidder-${lotIndex}`,
          amount: startPrice + bidIndex * 1_000,
          idempotencyKey: `${lotId}-${bidIndex}`,
        });
        latencies.push(response.ms);
        results.push(Boolean(response.json.accepted));
      }
      return results;
    }),
  );

  const flat = perLot.flat();
  return {
    bids: flat.length,
    accepted: flat.filter(Boolean).length,
    rejected: flat.filter((accepted) => !accepted).length,
    latencies,
    wallMs: 0,
  };
}

async function drainProjector(timeoutMs = 15000): Promise<any> {
  const started = Date.now();
  let health: any = null;
  while (Date.now() - started < timeoutMs) {
    health = await fetch(`${args.base}/api/health`).then((response) => response.json());
    if ((health.projector?.cursor ?? 0) >= (health.head ?? 0)) return health;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return health;
}

async function invariantReport(): Promise<{ ok: boolean; detail: Record<string, unknown> }> {
  const health = await drainProjector();
  const events = health?.events ?? 0;
  const bids = health?.bids ?? 0;
  const lots = health?.lots ?? 0;
  const orphans = events - lots - bids;

  // Every event in this workload is exactly one lot.opened or one bid.placed,
  // so a caught-up projection must satisfy events == lots + bids. Orphans mean
  // a bid that reached the log but never reached the read model.
  return {
    ok: orphans === 0 && (health?.duplicateDeliveries ?? 0) === 0,
    detail: {
      events,
      bids,
      lots,
      orphanEvents: orphans,
      duplicateDeliveries: health?.duplicateDeliveries ?? 0,
      projectorCursor: health?.projector?.cursor ?? 0,
      logHead: health?.head ?? 0,
    },
  };
}

if (args.reset) {
  await postJson('/api/demo/reset', {});
}

const startedAt = performance.now();
const contentionResult = await contention();
const throughputResult = await throughput();
const wallMs = performance.now() - startedAt;
const invariants = await invariantReport();

const allLatencies = [...contentionResult.latencies, ...throughputResult.latencies];
const accepted = contentionResult.accepted + throughputResult.accepted;
const report = {
  generatedAt: new Date().toISOString(),
  base: args.base,
  contention: {
    attempts: contentionResult.attempts,
    accepted: contentionResult.accepted,
    rejected: contentionResult.rejected,
    retriedAcceptedBidAnsweredAsDuplicate: contentionResult.duplicates === 1,
    verdict: contentionResult.accepted === 1 ? 'PASS' : 'FAIL',
  },
  throughput: {
    lots: args.lots,
    bids: throughputResult.bids,
    accepted: throughputResult.accepted,
    rejected: throughputResult.rejected,
    bidsPerSecond: Number((throughputResult.bids / (wallMs / 1000)).toFixed(1)),
    acceptedPerSecond: Number((accepted / (wallMs / 1000)).toFixed(1)),
  },
  latencyMs: {
    p50: Number(percentile(allLatencies, 50).toFixed(2)),
    p95: Number(percentile(allLatencies, 95).toFixed(2)),
    p99: Number(percentile(allLatencies, 99).toFixed(2)),
    max: Number(Math.max(...allLatencies).toFixed(2)),
  },
  invariants: invariants.detail,
  wallMs: Number(wallMs.toFixed(0)),
};

if (args.json) {
  await writeFile('load-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(report, null, 2));
if (report.contention.verdict === 'FAIL' || !invariants.ok) process.exitCode = 1;
