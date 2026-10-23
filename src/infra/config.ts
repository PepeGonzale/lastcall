function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://localhost:5432/lastcall',
  port: int('PORT', 3333),
  host: process.env.HOST ?? '127.0.0.1',
  rules: {
    snipeWindowMs: int('SNIPE_WINDOW_MS', 10_000),
    extensionMs: int('EXTENSION_MS', 15_000),
  },
  projector: {
    pollMs: int('PROJECTOR_POLL_MS', 40),
    batchSize: int('PROJECTOR_BATCH_SIZE', 200),
  },
} as const;

export type AppConfig = typeof config;
