export const SECTIONS = [
  { id: 'home', path: '/app' },
  { id: 'contracts', path: '/app/contratos' },
  { id: 'invoices', path: '/app/faturas' },
  { id: 'compare', path: '/app/comparar' },
  { id: 'settings', path: '/app/definicoes' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];
