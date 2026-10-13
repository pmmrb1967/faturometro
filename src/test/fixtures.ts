/** Test-only: loads layout fixtures (public synthetic + private, if present on this machine). */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PageText } from '../pdf/text';
import { parseFiscalQr, type FiscalQr } from '../qr/parse';

export interface LayoutFixture {
  name: string;
  private: boolean;
  pages: PageText[];
  qrs: FiscalQr[];
}

const ROOT = join(__dirname, '../../fixtures');

function load(dir: string, isPrivate: boolean): LayoutFixture[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
        pages: PageText[];
        qrs?: { text: string }[];
      };
      const qrs = (raw.qrs ?? []).flatMap(({ text }) => {
        const result = parseFiscalQr(text);
        return result.ok ? [result.qr] : [];
      });
      return {
        name: `${isPrivate ? 'private/' : ''}${file}`,
        private: isPrivate,
        pages: raw.pages,
        qrs,
      };
    });
}

export function layoutFixtures(providerId: string): LayoutFixture[] {
  const publicOnly = Boolean(process.env.FIXTURES_PUBLIC_ONLY);
  const own = publicOnly ? [] : load(join(ROOT, 'private', providerId), true);
  return [...load(join(ROOT, providerId), false), ...own];
}
