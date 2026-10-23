const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function euro(cents) {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '—';
  return `${money.format(cents / 100)} €`;
}

export function amountOnly(cents) {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '—';
  return money.format(cents / 100);
}

export function clock(ms) {
  if (ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function timeOfDay(value) {
  const date = new Date(value);
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

export function secondsAgo(value, now) {
  const diff = Math.max(0, now - value);
  if (diff < 1_000) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  return `${Math.floor(diff / 60_000)}m`;
}

export function centsFromInput(value) {
  const normalized = String(value).replace(',', '.').trim();
  if (normalized === '') return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}
