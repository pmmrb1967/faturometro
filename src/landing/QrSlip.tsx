import { useState } from 'react';
import { t } from '../i18n/pt-PT';

/** Example 5.2 ("Fatura simplificada") from the AT QR code technical specification. */
const SPEC_EXAMPLE =
  'A:123456789*B:999999990*C:PT*D:FS*E:N*F:20190812*G:FS CDVF/12345*H:CDF7T5HD-12345' +
  '*I1:PT*I7:0.65*I8:0.15*N:0.15*O:0.80*Q:YhGV*R:9999*S:NU;0.80';

const DECODED = ['A', 'D', 'F', 'I7', 'I8', 'O'] as const;
type DecodedCode = (typeof DECODED)[number];

const MODULES = 25;

/** Decorative QR-like pattern (not a real code): finder squares plus deterministic noise. */
function qrModules(): boolean[] {
  const cells: boolean[] = [];
  let seed = 195_2020;
  const inFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= MODULES - 7 && y < 7) || (x < 7 && y >= MODULES - 7);
  const finderOn = (x: number, y: number) => {
    const fx = x >= MODULES - 7 ? x - (MODULES - 7) : x;
    const fy = y >= MODULES - 7 ? y - (MODULES - 7) : y;
    const ring = Math.max(Math.abs(fx - 3), Math.abs(fy - 3));
    return ring !== 2;
  };
  for (let y = 0; y < MODULES; y++) {
    for (let x = 0; x < MODULES; x++) {
      if (inFinder(x, y)) {
        cells.push(finderOn(x, y));
        continue;
      }
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      cells.push(seed % 7 < 3);
    }
  }
  return cells;
}

const CELLS = qrModules();

export function QrSlip() {
  const [active, setActive] = useState<DecodedCode | null>(null);
  const fields = SPEC_EXAMPLE.split('*');

  return (
    <figure className="slip" aria-labelledby="slip-title">
      <div className="slip-head">
        <svg
          className="slip-qr"
          viewBox={`-2 -2 ${MODULES + 4} ${MODULES + 4}`}
          aria-hidden="true"
          shapeRendering="crispEdges"
        >
          {CELLS.map((on, i) =>
            on ? (
              <rect key={i} x={i % MODULES} y={Math.floor(i / MODULES)} width="1" height="1" />
            ) : null,
          )}
        </svg>
        <h2 id="slip-title" className="slip-title">
          {t.landing.qr.title}
        </h2>
      </div>

      <p className="slip-raw" aria-label={SPEC_EXAMPLE}>
        {fields.map((field, index) => {
          const code = field.slice(0, field.indexOf(':'));
          return (
            <span key={code}>
              <span className={code === active ? 'slip-field is-active' : 'slip-field'}>
                {field}
              </span>
              {index < fields.length - 1 ? '*' : ''}
              <wbr />
            </span>
          );
        })}
      </p>

      <dl className="slip-decoded">
        {DECODED.map((code) => {
          const { label, value } = t.landing.qr.fields[code];
          return (
            <div
              key={code}
              className={code === active ? 'slip-row is-active' : 'slip-row'}
              tabIndex={0}
              onMouseEnter={() => setActive(code)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(code)}
              onBlur={() => setActive(null)}
            >
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          );
        })}
      </dl>

      <figcaption className="slip-caption">
        <span>{t.landing.qr.hint}</span> <span>{t.landing.qr.source}</span>
      </figcaption>
    </figure>
  );
}
