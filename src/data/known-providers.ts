import type { SectorGroup } from '../domain/grouping';

/**
 * Common suppliers in Portugal that do not have an automatic reader yet, shown
 * so users know what to expect. Names only: a reader (and its issuer NIF) only
 * comes from real invoices (CLAUDE.md rules 2 and 6).
 */
export const KNOWN_WITHOUT_READER: Record<SectorGroup, readonly string[]> = {
  energy: [
    'EDP Comercial',
    'SU Eletricidade',
    'Endesa',
    'Iberdrola',
    'Galp',
    'Goldenergy',
    'Plenitude',
    'Coopérnico',
    'Luzboa',
  ],
  telecom: ['Vodafone', 'DIGI'],
  water: [],
  insurance: ['Ageas', 'Allianz', 'Zurich', 'Lusitania', 'Caravela'],
  other: ['Via Verde'],
};
