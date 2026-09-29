/**
 * Format currency in Ghanaian Cedi (GH₵)
 */
export function formatCurrency(amount: number, currency: string = 'GHS'): string {
  const safeAmount = isNaN(amount) ? 0 : amount;
  // Format cleanly as GH₵ 150.00
  return `GH₵ ${safeAmount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(timestamp: number): string {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp));
}

export function formatDateTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

export function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}
