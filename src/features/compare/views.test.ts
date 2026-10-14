import { describe, expect, it } from 'vitest';
import { bothView, gasView } from './views';

describe('gasView', () => {
  const base = { hasContract: true, hasUsage: true, escalao: 2, hasComparison: true };

  it('asks for what is missing, in order', () => {
    expect(gasView({ ...base, hasContract: false })).toBe('noContract');
    expect(gasView({ ...base, hasUsage: false })).toBe('noKwh');
    expect(gasView({ ...base, escalao: undefined })).toBe('needsEscalao');
  });

  it('explains when the latest invoice cannot be used (Review: silent tab)', () => {
    expect(gasView({ ...base, hasComparison: false })).toBe('cannotEstimate');
  });

  it('shows the comparison when everything is there', () => {
    expect(gasView(base)).toBe('ready');
  });
});

describe('bothView', () => {
  it('tells "add a contract" apart from "complete the other tabs"', () => {
    expect(bothView({ hasElectricity: false, hasGas: true, hasBoth: false })).toBe('needsBoth');
    expect(bothView({ hasElectricity: true, hasGas: true, hasBoth: false })).toBe('incomplete');
    expect(bothView({ hasElectricity: true, hasGas: true, hasBoth: true })).toBe('ready');
  });
});
