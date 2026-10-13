/** Portuguese NIF (tax number): 9 digits, the last one a mod-11 check digit. */
export function nifCheckDigit(first8: string): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(first8[i]) * (9 - i);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidNif(nif: string): boolean {
  if (!/^\d{9}$/.test(nif)) return false;
  return nifCheckDigit(nif.slice(0, 8)) === Number(nif[8]);
}
