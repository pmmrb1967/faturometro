/**
 * Grouping and vocabulary form of a word: compatibility-normalized (ligatures split)
 * and lower case, accents kept ("Campanhã" is not "campanha").
 */
export function wordKey(word: string): string {
  return word.normalize('NFKC').toLowerCase();
}

/** Loose form, for locking personal words: also without accents. */
export function foldKey(word: string): string {
  return word.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}
