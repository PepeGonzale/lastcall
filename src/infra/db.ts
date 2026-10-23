import pg from 'pg';

// int8 is used for money and positions. Safe here: cents and offsets stay far
// below Number.MAX_SAFE_INTEGER, and JSON consumers (the UI) need real numbers,
// not strings.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function createPool(connectionString: string, max = 16): Pool {
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', (error) => {
    console.error('[pg] idle client error', error.message);
  });
  return pool;
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(pool: Pool): Promise<string[]> {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, '..', '..', 'migrations');

  await pool.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    const { rows } = await pool.query('select 1 from schema_migrations where name = $1', [file]);
    if (rows.length > 0) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    applied.push(file);
  }

  return applied;
}
