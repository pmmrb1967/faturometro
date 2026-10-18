import { useState } from 'react';
import { Field, SelectField } from '../../components/Field';
import { monthlyAverage } from '../../domain/comescolha';
import { addMonths, EARLY_EXIT_SOURCE, earlyExit, type LoyaltyKind } from '../../domain/early-exit';
import type { Contract, Invoice } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { centsToPtInput, formatCents, parsePtAmount, type Cents } from '../../lib/money';
import { today } from '../alerts/refresh';

const copy = t.contracts.earlyExit;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Empty → undefined; not an amount → null. */
function amountOf(text: string): Cents | undefined | null {
  if (!text.trim()) return undefined;
  const cents = parsePtAmount(text);
  return cents !== null && cents >= 0 ? cents : null;
}

/** Telecom contract still in its loyalty period: cost of leaving now against the saving. */
export function EarlyExitSection({
  contract,
  invoices,
}: {
  contract: Contract & { loyaltyEndDate: string };
  invoices: readonly Invoice[];
}) {
  const end = contract.loyaltyEndDate;
  const known = contract.monthlyPriceCents ?? monthlyAverage(invoices)?.cents;
  const [start, setStart] = useState(addMonths(end, -24));
  const [kind, setKind] = useState<LoyaltyKind>('initial');
  const [monthly, setMonthly] = useState(known !== undefined ? centsToPtInput(known) : '');
  const [newMonthly, setNewMonthly] = useState('');
  const [stated, setStated] = useState('');

  const monthlyCents = amountOf(monthly);
  const newCents = amountOf(newMonthly);
  const statedCents = amountOf(stated);
  const result =
    typeof monthlyCents === 'number'
      ? earlyExit({
          today: today(),
          loyaltyEnd: end,
          ...(ISO_DATE.test(start) ? { loyaltyStart: start } : {}),
          kind,
          monthlyCents,
          ...(typeof newCents === 'number' ? { newMonthlyCents: newCents } : {}),
          ...(typeof statedCents === 'number' ? { statedChargeCents: statedCents } : {}),
        })
      : null;

  return (
    <section aria-labelledby="early-exit-title">
      <h2 id="early-exit-title" className="section-title">
        {copy.title}
      </h2>
      <p className="muted">{copy.intro}</p>
      <Field
        id="early-exit-start"
        label={copy.start}
        hint={copy.startHint}
        type="date"
        value={start}
        max={end}
        onChange={(event) => setStart(event.target.value)}
      />
      <SelectField
        id="early-exit-kind"
        label={copy.kind}
        value={kind}
        onChange={(event) => setKind(event.target.value as LoyaltyKind)}
      >
        <option value="initial">{copy.kinds.initial}</option>
        <option value="renewal_same_installation">{copy.kinds.renewal_same_installation}</option>
      </SelectField>
      <Field
        id="early-exit-monthly"
        label={copy.monthly}
        hint={copy.monthlyHint}
        inputMode="decimal"
        value={monthly}
        onChange={(event) => setMonthly(event.target.value)}
        {...(monthlyCents === null ? { error: copy.amountError } : {})}
      />
      <Field
        id="early-exit-new"
        label={copy.newMonthly}
        inputMode="decimal"
        value={newMonthly}
        onChange={(event) => setNewMonthly(event.target.value)}
        {...(newCents === null ? { error: copy.amountError } : {})}
      />
      <Field
        id="early-exit-stated"
        label={copy.stated}
        inputMode="decimal"
        value={stated}
        onChange={(event) => setStated(event.target.value)}
        {...(statedCents === null ? { error: copy.amountError } : {})}
      />

      {result && (
        <div className="early-exit-result" aria-live="polite">
          <p>{copy.monthsLeft(result.monthsLeft, formatCents(result.remainingFeesCents))}</p>
          {result.capPct !== null && result.maxChargeCents !== null ? (
            <p>{copy.cap(result.year, result.capPct, formatCents(result.maxChargeCents))}</p>
          ) : (
            statedCents === undefined && <p>{copy.oldContract}</p>
          )}
          {typeof statedCents === 'number' && <p>{copy.usingStated(formatCents(statedCents))}</p>}
          {result.savingCents !== undefined &&
            (result.savingCents > 0 ? (
              <p>{copy.saving(formatCents(result.savingCents))}</p>
            ) : (
              <p>{copy.noSaving}</p>
            ))}
          {result.balanceCents !== undefined && result.savingCents! > 0 && (
            <p className="early-exit-verdict">
              {result.balanceCents > 0
                ? copy.worth(formatCents(result.balanceCents))
                : copy.notWorth(formatCents(-result.balanceCents), formatIsoDate(end))}
            </p>
          )}
        </div>
      )}
      <p className="field-hint">
        <a href={EARLY_EXIT_SOURCE} target="_blank" rel="noreferrer">
          {copy.source}
        </a>
      </p>
    </section>
  );
}
