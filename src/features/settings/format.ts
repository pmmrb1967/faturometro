export function formatMegabytes(bytes: number): string {
  if (bytes > 0 && bytes < 100_000) return 'menos de 0,1 MB';
  return `${(bytes / 1_000_000).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} MB`;
}
