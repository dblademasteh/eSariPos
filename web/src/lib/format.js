export const makeMoney =
  (currency = 'USD') =>
  (n) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(n) || 0);

export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export const fmtWeekdayShort = (dateStr) =>
  new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });

export const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function dayRange(dateStr) {
  const from = new Date(dateStr + 'T00:00:00');
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
