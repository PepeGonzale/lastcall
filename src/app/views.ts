import { minimumNextBid, type LotState } from '../domain/auction.js';
import { formatCents } from '../domain/money.js';

export interface LotView {
  lotId: string;
  title: string;
  startPrice: number;
  minIncrement: number;
  currentPrice: number;
  currentPriceLabel: string;
  minimumNextBid: number;
  minimumNextBidLabel: string;
  leader: string | null;
  bidCount: number;
  endsAt: number;
  status: 'open' | 'closed';
  extensionCount: number;
  version: number;
}

/** One serializer for HTTP and WebSocket so the UI never forks the contract. */
export function serializeLot(state: LotState): LotView {
  const minimum = minimumNextBid(state);
  return {
    lotId: state.lotId,
    title: state.title,
    startPrice: state.startPrice,
    minIncrement: state.minIncrement,
    currentPrice: state.currentPrice,
    currentPriceLabel: formatCents(state.currentPrice),
    minimumNextBid: minimum,
    minimumNextBidLabel: formatCents(minimum),
    leader: state.leader,
    bidCount: state.bidCount,
    endsAt: state.endsAt,
    status: state.status,
    extensionCount: state.extensionCount,
    version: state.version,
  };
}
