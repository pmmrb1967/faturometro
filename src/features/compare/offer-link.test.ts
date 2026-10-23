import { describe, expect, it } from 'vitest';
import type { Offer } from '../../domain/erse';
import { sharedSheets, sheetUrl, withTextFragment } from './offer-link';

const offer = (id: string, links: Offer['links']) => ({ id, links }) as Offer;

describe('withTextFragment', () => {
  it('encodes the name, including "-", "," and "&"', () => {
    expect(
      withTextFragment('https://example.pt/ofertas/', 'Gás + Luz DD+FE - Digital, 15% & mais'),
    ).toBe(
      'https://example.pt/ofertas/#:~:text=G%C3%A1s%20%2B%20Luz%20DD%2BFE%20%2D%20Digital%2C%2015%25%20%26%20mais',
    );
  });

  it('keeps a fragment the page already has', () => {
    expect(withTextFragment('https://example.pt/#precos', 'Casa')).toBe(
      'https://example.pt/#precos:~:text=Casa',
    );
  });
});

describe('sheetUrl', () => {
  it('the standard sheet, else the offer page', () => {
    expect(sheetUrl(offer('A', { standardSheet: 'https://s', offer: 'https://o' }))).toBe(
      'https://s',
    );
    expect(sheetUrl(offer('B', { offer: 'https://o' }))).toBe('https://o');
    expect(sheetUrl(offer('C', {}))).toBeUndefined();
  });
});

describe('sharedSheets', () => {
  it('pages given for more than one offer', () => {
    const offers = [
      offer('A', { standardSheet: 'https://tarifarios' }),
      offer('B', { standardSheet: 'https://tarifarios' }),
      offer('C', { standardSheet: 'https://digital' }),
      // The same offer twice (two cycles) is not a shared page.
      offer('D', { standardSheet: 'https://propria' }),
      offer('D', { standardSheet: 'https://propria' }),
    ];
    expect([...sharedSheets(offers)]).toEqual(['https://tarifarios']);
  });
});
