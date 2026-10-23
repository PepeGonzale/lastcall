/**
 * Money is always an integer number of minor units (cents).
 * Floats never touch a price: `0.1 + 0.2` must not decide who wins an auction.
 */
export type Cents = number;

export function isValidCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

const formatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCents(cents: Cents, currency = 'EUR'): string {
  const amount = formatter.format(cents / 100);
  return currency === 'EUR' ? `${amount} €` : `${currency} ${amount}`;
}
