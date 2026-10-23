import type { CreateLot } from './create-lot.js';
import type { PlaceBid } from './place-bid.js';

export interface DemoLot {
  lotId: string;
  title: string;
  startPrice: number;
  minIncrement: number;
  endsAt: number;
}

export function demoLots(now: number): DemoLot[] {
  return [
    {
      lotId: 'omega-speedmaster',
      title: 'Omega Speedmaster 145.022',
      startPrice: 320_000,
      minIncrement: 5_000,
      endsAt: now + 240_000,
    },
    {
      lotId: 'rolex-daytona',
      title: 'Rolex Daytona 116500LN',
      startPrice: 2_400_000,
      minIncrement: 25_000,
      endsAt: now + 900_000,
    },
    {
      lotId: 'heuer-carrera',
      title: 'Heuer Carrera 2447N',
      startPrice: 850_000,
      minIncrement: 10_000,
      endsAt: now + 90_000,
    },
  ];
}

const OPENING_BIDS: { lotId: string; bidder: string; amount: number }[] = [
  { lotId: 'omega-speedmaster', bidder: 'ana', amount: 320_000 },
  { lotId: 'omega-speedmaster', bidder: 'bruno', amount: 330_000 },
  { lotId: 'omega-speedmaster', bidder: 'chloe', amount: 340_000 },
  { lotId: 'omega-speedmaster', bidder: 'dmitri', amount: 355_000 },
  { lotId: 'rolex-daytona', bidder: 'ana', amount: 2_400_000 },
  { lotId: 'rolex-daytona', bidder: 'chloe', amount: 2_450_000 },
];

export async function seedDemo(createLot: CreateLot, placeBid: PlaceBid): Promise<{ lots: number; bids: number }> {
  const now = Date.now();
  const lots = demoLots(now);

  for (const lot of lots) {
    await createLot.execute(lot);
  }

  let bids = 0;
  for (const bid of OPENING_BIDS) {
    const result = await placeBid.execute({
      ...bid,
      idempotencyKey: `seed:${bid.lotId}:${bid.bidder}:${bid.amount}`,
    });
    if (result.outcome.ok && !result.duplicate) bids += 1;
  }

  return { lots: lots.length, bids };
}
