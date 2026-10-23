import { CreateLot } from '../app/create-lot.js';
import { PlaceBid } from '../app/place-bid.js';
import { seedDemo } from '../app/seed.js';
import { SystemClock } from '../infra/clock.js';
import { config } from '../infra/config.js';
import { createPool } from '../infra/db.js';
import { PostgresLotUnitOfWork } from '../infra/postgres/uow.js';

const pool = createPool(config.databaseUrl, 4);
const clock = new SystemClock();
const uow = new PostgresLotUnitOfWork(pool);

try {
  const result = await seedDemo(
    new CreateLot(uow, clock),
    new PlaceBid(uow, config.rules, clock),
  );
  console.log(`seeded ${result.lots} lots and ${result.bids} bids`);
} finally {
  await pool.end();
}
