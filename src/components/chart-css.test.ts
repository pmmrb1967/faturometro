import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n/pt-PT';

const css = readFileSync(fileURLToPath(new URL('./chart.css', import.meta.url)), 'utf8');

describe('chart.css', () => {
  it('has a series colour for every sector', () => {
    for (const sector of Object.keys(t.sectors)) {
      expect(css, `--series-${sector}`).toContain(`--series-${sector}:`);
    }
  });
});
