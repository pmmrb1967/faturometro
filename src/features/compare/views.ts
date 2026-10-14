/** What the gas and "luz + gás" tabs show, from what is available (no silent states). */
export type GasView = 'noContract' | 'noKwh' | 'needsEscalao' | 'cannotEstimate' | 'ready';

export function gasView(input: {
  hasContract: boolean;
  hasUsage: boolean;
  escalao?: number | undefined;
  hasComparison: boolean;
}): GasView {
  if (!input.hasContract) return 'noContract';
  if (!input.hasUsage) return 'noKwh';
  if (input.escalao === undefined) return 'needsEscalao';
  return input.hasComparison ? 'ready' : 'cannotEstimate';
}

export type BothView = 'needsBoth' | 'incomplete' | 'ready';

export function bothView(input: {
  hasElectricity: boolean;
  hasGas: boolean;
  hasBoth: boolean;
}): BothView {
  if (!input.hasElectricity || !input.hasGas) return 'needsBoth';
  return input.hasBoth ? 'ready' : 'incomplete';
}
