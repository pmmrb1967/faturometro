/** An axis maximum whose quarters are round numbers (1, 2, 4, 6, 8 × 10^n). */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 4, 6, 8, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}
