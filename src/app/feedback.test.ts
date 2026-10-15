import { describe, expect, it } from 'vitest';
import { feedbackBody, feedbackLink } from './feedback';

describe('feedback email', () => {
  it('opens a message to the project address with a "Faturómetro:" subject', () => {
    const link = feedbackLink('problem', '/app/faturas');
    const url = new URL(link);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe('faturometro@outlook.com');
    expect(url.searchParams.get('subject')).toBe('Faturómetro: Problema');
    expect(url.searchParams.get('body')).toContain('Página: /app/faturas');
  });

  it('adds only the version and the page', () => {
    const body = feedbackBody('/app', 'abc1234', '2026-10-15');
    expect(body).toContain('Versão: abc1234 (2026-10-15)');
    expect(body.split('\n')).toHaveLength(6);
  });
});
