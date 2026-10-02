/**
 * Formatting for money and time. Amounts arrive as decimal strings and are formatted as strings:
 * nothing here converts money to a JavaScript number.
 */
export function formatAmount(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const negative = value.startsWith('-');
  const [int, frac] = (negative ? value.slice(1) : value).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${grouped}${frac !== undefined ? `.${frac}` : ''}`;
}

export function formatMoney(value: string | null | undefined, currency: string): string {
  return value === null || value === undefined ? '—' : `${currency.trim()} ${formatAmount(value)}`;
}

const dateTime = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const timeOnly = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function formatDateTime(value: string | Date | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : '—';
}
export function formatDate(value: string | Date | null | undefined): string {
  return value ? dateOnly.format(new Date(value)) : '—';
}
export function formatTime(value: string | Date | null | undefined): string {
  return value ? timeOnly.format(new Date(value)) : '—';
}

export function titleCase(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function shortId(id: string | null | undefined): string {
  return id ? `${id.slice(0, 8)}…` : '—';
}
