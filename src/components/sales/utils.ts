export function formatYen(amount: number): string {
  if (!Number.isFinite(amount)) return '¥0';
  return `¥${amount.toLocaleString()}`;
}
