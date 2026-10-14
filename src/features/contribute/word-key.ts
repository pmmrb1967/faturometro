/** Comparison form of a word: lower case, without accents. */
export function wordKey(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
