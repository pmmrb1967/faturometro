import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router';
import { Field } from '../../components/Field';
import {
  BENEFITS,
  checkSocialTariff,
  INTERNET_ACTIVATION_MAX_CENTS,
  INTERNET_PRICE_CENTS,
  SOCIAL_TARIFF_SOURCES,
  type Benefit,
  type ServiceCheck,
} from '../../domain/social-tariff';
import { t } from '../../i18n/pt-PT';
import { formatCents, parsePtAmount } from '../../lib/money';
import { useSession } from '../auth/session-context';
import './social-tariff.css';

const copy = t.socialTariff;

function verdict(check: ServiceCheck): string {
  if (check.eligible) {
    return check.reason === 'income' && check.incomeLimitCents !== undefined
      ? copy.eligibleIncome(formatCents(check.incomeLimitCents))
      : copy.eligibleBenefit;
  }
  return check.incomeLimitCents === undefined
    ? copy.notEligibleGas
    : copy.notEligible(formatCents(check.incomeLimitCents));
}

/** "Tenho direito à tarifa social?": answers stay in this screen only. */
export function SocialTariffPage() {
  const { session } = useSession();
  const contracts = useLiveQuery(async () => session?.repos.contracts.list() ?? [], [session]);
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [income, setIncome] = useState('');
  const [members, setMembers] = useState('0');

  const incomeCents = income.trim() ? parsePtAmount(income) : undefined;
  const checks = checkSocialTariff(
    {
      benefits,
      ...(incomeCents !== undefined && incomeCents !== null && incomeCents >= 0
        ? { annualIncomeCents: incomeCents }
        : {}),
      membersWithoutIncome: Number(members) || 0,
    },
    contracts ?? [],
  );

  const toggle = (benefit: Benefit, on: boolean) =>
    setBenefits((current) =>
      on ? [...current, benefit] : current.filter((candidate) => candidate !== benefit),
    );

  return (
    <>
      <Link to="/app" className="back-link">
        ← {copy.back}
      </Link>
      <h1>{copy.title}</h1>
      <p className="muted">{copy.intro}</p>

      <form className="social-form" onSubmit={(event) => event.preventDefault()}>
        <fieldset>
          <legend>{copy.benefitsLegend}</legend>
          {BENEFITS.map((benefit) => (
            <label key={benefit} className="social-check">
              <input
                type="checkbox"
                checked={benefits.includes(benefit)}
                onChange={(event) => toggle(benefit, event.target.checked)}
              />
              {copy.benefits[benefit]}
            </label>
          ))}
        </fieldset>
        <Field
          id="social-income"
          label={copy.income}
          hint={copy.incomeHint}
          inputMode="decimal"
          autoComplete="off"
          value={income}
          onChange={(event) => setIncome(event.target.value)}
          {...(incomeCents === null ? { error: copy.incomeError } : {})}
        />
        <Field
          id="social-members"
          label={copy.members}
          hint={copy.membersHint}
          type="number"
          min={0}
          max={10}
          value={members}
          onChange={(event) => setMembers(event.target.value)}
        />
      </form>

      <ul className="social-results" aria-live="polite">
        {checks.map((check) => (
          <li
            key={check.service}
            className={`social-result ${check.eligible ? 'is-eligible' : 'is-not-eligible'}`}
          >
            <h2>{copy.services[check.service]}</h2>
            <p className="social-verdict">{verdict(check)}</p>
            {check.contractNotes.map((note) => (
              <p key={note} className="social-note">
                {copy.notes[note]}
              </p>
            ))}
            <p className="muted">
              {check.service === 'internet'
                ? copy.conditions.internet(
                    formatCents(INTERNET_PRICE_CENTS),
                    formatCents(INTERNET_ACTIVATION_MAX_CENTS),
                  )
                : copy.conditions[check.service]}
            </p>
            <p className="muted">
              {check.service === 'internet' ? copy.how.internet : copy.how.energy}
            </p>
          </li>
        ))}
      </ul>
      <p className="muted">{copy.water}</p>
      <p className="muted">{copy.sources}</p>
      <ul className="social-links">
        <li>
          <a href={SOCIAL_TARIFF_SOURCES.dgeg} target="_blank" rel="noreferrer">
            {copy.links.dgeg}
          </a>
        </li>
        <li>
          <a href={SOCIAL_TARIFF_SOURCES.energy} target="_blank" rel="noreferrer">
            {copy.links.energy}
          </a>
        </li>
        <li>
          <a href={SOCIAL_TARIFF_SOURCES.internet} target="_blank" rel="noreferrer">
            {copy.links.internet}
          </a>
        </li>
      </ul>
    </>
  );
}
