import { config } from '../infra/config.js';
import { createPool, migrate } from '../infra/db.js';

const pool = createPool(config.databaseUrl, 2);
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'schema already up to date');
} finally {
  await pool.end();
}
