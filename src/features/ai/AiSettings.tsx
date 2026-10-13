import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { AI_MODELS, DEFAULT_AI_MODEL, PRICES_CHECKED, formatMicroUsd } from '../../ai/models';
import { AiError } from '../../ai/provider';
import { aiModelOf, providerFromSettings, recordUsage, usageSince } from '../../ai/session';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { useSession } from '../auth/session-context';
import { getSettings, updateSettings } from '../settings/settings';
import { aiErrorText } from './errors';

const copy = t.ai.settings;
const price = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 });

function monthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export function AiSettings() {
  const { session } = useSession();
  const settings = useLiveQuery(
    async () => (session ? getSettings(session.repos) : null),
    [session],
  );
  const usage = useLiveQuery(
    async () => (session ? usageSince(session.repos, monthStart()) : null),
    [session],
  );
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<{ text: string; problem?: boolean }>();
  const [busy, setBusy] = useState(false);
  if (!session || !settings) return null;
  const { repos } = session;
  const hasKey = Boolean(settings.aiApiKey);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!key.trim()) return;
    await updateSettings(repos, { aiProvider: 'anthropic', aiApiKey: key.trim() });
    setKey('');
    setMessage({ text: copy.keySaved });
  }

  async function test() {
    const provider = providerFromSettings(await getSettings(repos));
    if (!provider) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const used = await provider.testConnection();
      await recordUsage(repos, [used]);
      setMessage({ text: copy.testOk(formatMicroUsd(used.costMicroUsd)) });
    } catch (error) {
      setMessage({
        text: aiErrorText(error instanceof AiError ? error.code : 'unavailable'),
        problem: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const current = await getSettings(repos);
    const next = { ...current };
    delete next.aiApiKey;
    await repos.settings.put(next);
    setMessage({ text: copy.removed });
  }

  return (
    <section className="settings-section" aria-labelledby="ai-title">
      <h2 id="ai-title">{copy.title}</h2>
      <p>{copy.intro}</p>
      <p className="muted">{copy.privacy}</p>

      <form onSubmit={save} noValidate>
        {!hasKey && (
          <p>
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              {copy.getKey}
            </a>
          </p>
        )}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value="anthropic"
          readOnly
          hidden
        />
        <Field
          id="ai-key"
          label={copy.key}
          hint={copy.keyHint}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={hasKey ? '••••••••••••' : 'sk-ant-…'}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <div className="ingest-actions">
          <button type="submit" className="action-primary" disabled={!key.trim()}>
            {copy.save}
          </button>
          {hasKey && (
            <>
              <button
                type="button"
                className="action-secondary"
                disabled={busy}
                onClick={() => void test()}
              >
                {busy ? copy.testing : copy.test}
              </button>
              <button
                type="button"
                className="action-secondary danger"
                onClick={() => void remove()}
              >
                {copy.remove}
              </button>
            </>
          )}
        </div>
      </form>
      {message && (
        <p className={message.problem ? 'ingest-problem' : 'doc-saved'} role="status">
          {message.text}
        </p>
      )}

      <SelectField
        id="ai-model"
        label={copy.model}
        value={aiModelOf(settings)}
        onChange={(event) => void updateSettings(repos, { aiModel: event.target.value })}
      >
        {AI_MODELS.map((model) => (
          <option key={model.id} value={model.id}>
            {copy.modelOption(
              model.label,
              price.format(model.inputUsdPerMTok),
              price.format(model.outputUsdPerMTok),
            ) + (model.id === DEFAULT_AI_MODEL ? copy.recommended : '')}
          </option>
        ))}
      </SelectField>
      <p className="muted">{copy.pricesNote(formatIsoDate(PRICES_CHECKED))}</p>

      <label className="check settings-check">
        <input
          type="checkbox"
          checked={settings.aiAutoSend}
          onChange={(event) => void updateSettings(repos, { aiAutoSend: event.target.checked })}
        />
        {copy.autoSend}
      </label>

      {usage && (
        <p className="muted">{copy.usage(usage.requests, formatMicroUsd(usage.costMicroUsd))}</p>
      )}
    </section>
  );
}
