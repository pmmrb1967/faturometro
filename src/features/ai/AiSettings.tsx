import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import type { FreeStatus } from '../../ai/free';
import { maskApiKey } from '../../ai/key-mask';
import { DEFAULT_MODELS, PRICES_CHECKED, formatMicroUsd, modelsOf } from '../../ai/models';
import { AiError } from '../../ai/provider';
import {
  aiKeyOf,
  aiModelOf,
  aiModeOf,
  freeProvider,
  providerFromSettings,
  recordUsage,
  usageSince,
} from '../../ai/session';
import { isGuest } from '../../db/profiles';
import type { Repositories } from '../../db/repositories';
import type { AiMode, Settings } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { useSession } from '../auth/session-context';
import { getSettings, updateSettings } from '../settings/settings';
import { aiErrorText } from './errors';

const copy = t.ai.settings;
const price = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 });
const MODES: readonly AiMode[] = ['free', 'gemini', 'anthropic', 'none'];
const KEY_LINKS = {
  gemini: 'https://aistudio.google.com/apikey',
  anthropic: 'https://console.anthropic.com/settings/keys',
} as const;
const KEY_PLACEHOLDERS = { gemini: 'AIza…', anthropic: 'sk-ant-…' } as const;

type KeyMode = 'gemini' | 'anthropic';
type Message = { text: string; problem?: boolean };

function monthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/** The free AI's readings left today on this device (asked when the section opens). */
function FreeAiStatus({ settings }: { settings: Partial<Settings> }) {
  const [status, setStatus] = useState<FreeStatus | 'error'>();
  const [message, setMessage] = useState<Message>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    freeProvider(settings)
      .status()
      .then((next) => live && setStatus(next))
      .catch(() => live && setStatus('error'));
    return () => {
      live = false;
    };
    // The status depends only on this device, not on the other settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function test() {
    setBusy(true);
    setMessage(undefined);
    try {
      await freeProvider(settings).testConnection();
      setMessage({ text: copy.testOkFree });
    } catch (error) {
      setMessage({
        text: aiErrorText(error instanceof AiError ? error.code : 'unavailable'),
        problem: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {status && status !== 'error' && (
        <p>{status.available ? copy.freeLeft(status.left, status.limit) : copy.freePaused}</p>
      )}
      <div className="ingest-actions">
        <button
          type="button"
          className="action-secondary"
          disabled={busy}
          onClick={() => void test()}
        >
          {busy ? copy.testing : copy.test}
        </button>
      </div>
      {message && (
        <p className={message.problem ? 'ingest-problem' : 'doc-saved'} role="status">
          {message.text}
        </p>
      )}
    </>
  );
}

/** The user's key for Gemini or Claude, and the model. */
function KeySettings({
  mode,
  settings,
  repos,
}: {
  mode: KeyMode;
  settings: Omit<Settings, 'updatedAt'>;
  repos: Repositories;
}) {
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<Message>();
  const [busy, setBusy] = useState(false);
  /** Typing a new key over the saved one. */
  const [changing, setChanging] = useState(false);
  const saved = aiKeyOf(settings, mode);
  const keyField = mode === 'gemini' ? 'aiGeminiKey' : 'aiApiKey';

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!key.trim()) return;
    const value = key.trim();
    await updateSettings(
      repos,
      mode === 'gemini' ? { aiMode: mode, aiGeminiKey: value } : { aiMode: mode, aiApiKey: value },
    );
    setKey('');
    setMessage({ text: saved ? copy.keyChanged : copy.keySaved });
    setChanging(false);
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
    const next = { ...(await getSettings(repos)) };
    delete next[keyField];
    await repos.settings.put(next);
    setChanging(false);
    setMessage({ text: copy.removed });
  }

  return (
    <>
      {mode === 'gemini' && <p className="muted">{copy.geminiBilling}</p>}
      <form onSubmit={save} noValidate>
        {!saved && (
          <p>
            <a href={KEY_LINKS[mode]} target="_blank" rel="noreferrer">
              {copy.getKey[mode]}
            </a>
          </p>
        )}
        {saved && !changing ? (
          <>
            {/* Never shown whole: a key in clear can be read over a shoulder or in a screenshot. */}
            <p>
              {copy.keyCurrent} <code>{maskApiKey(saved)}</code>
            </p>
            <p className="muted">{copy.keyHint}</p>
          </>
        ) : (
          <>
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={mode === 'gemini' ? 'google' : 'anthropic'}
              readOnly
              hidden
            />
            <Field
              id={`ai-key-${mode}`}
              label={changing ? copy.newKey[mode] : copy.key[mode]}
              hint={copy.keyHint}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={KEY_PLACEHOLDERS[mode]}
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </>
        )}
        <div className="ingest-actions">
          {saved && !changing ? (
            <>
              <button
                type="button"
                className="action-secondary"
                onClick={() => {
                  setMessage(undefined);
                  setChanging(true);
                }}
              >
                {copy.change}
              </button>
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
          ) : (
            <>
              <button type="submit" className="action-primary" disabled={!key.trim()}>
                {changing ? copy.saveNew : copy.save}
              </button>
              {changing && (
                <button
                  type="button"
                  className="action-secondary"
                  onClick={() => {
                    setKey('');
                    setChanging(false);
                  }}
                >
                  {copy.cancel}
                </button>
              )}
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
        id={`ai-model-${mode}`}
        label={copy.model}
        value={aiModelOf({ ...settings, aiMode: mode })}
        onChange={(event) =>
          void updateSettings(
            repos,
            mode === 'gemini'
              ? { aiGeminiModel: event.target.value }
              : { aiModel: event.target.value },
          )
        }
      >
        {modelsOf(mode).map((model) => (
          <option key={model.id} value={model.id}>
            {copy.modelOption(
              model.label,
              price.format(model.inputUsdPerMTok),
              price.format(model.outputUsdPerMTok),
            ) + (model.id === DEFAULT_MODELS[mode] ? copy.recommended : '')}
          </option>
        ))}
      </SelectField>
      <p className="muted">{copy.pricesNote(formatIsoDate(PRICES_CHECKED))}</p>
    </>
  );
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
  if (!session || !settings) return null;
  const { repos } = session;
  const guest = isGuest(session.profile);
  const mode = aiModeOf(settings);

  return (
    <section className="settings-section" aria-labelledby="ai-title">
      <h2 id="ai-title">{copy.title}</h2>
      <p>{copy.intro}</p>

      <fieldset className="ai-modes">
        <legend>{copy.chooseLegend}</legend>
        {MODES.map((option) => (
          <label key={option} className="check settings-check">
            <input
              type="radio"
              name="ai-mode"
              value={option}
              checked={mode === option}
              onChange={() => void updateSettings(repos, { aiMode: option })}
            />
            <span>
              {copy.modes[option]}
              <span className="ai-mode-hint muted">{copy.modeHints[option]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="muted">{copy.privacy[mode]}</p>

      {mode === 'free' && <FreeAiStatus settings={settings} />}
      {(mode === 'gemini' || mode === 'anthropic') &&
        (guest ? (
          // "Criar conta" is in the notice at the top of Settings.
          <p>{copy.needsAccount}</p>
        ) : (
          <KeySettings key={mode} mode={mode} settings={settings} repos={repos} />
        ))}

      {mode !== 'none' && (
        <label className="check settings-check">
          <input
            type="checkbox"
            checked={settings.aiAutoSend}
            onChange={(event) => void updateSettings(repos, { aiAutoSend: event.target.checked })}
          />
          {copy.autoSend}
        </label>
      )}

      {usage && mode !== 'none' && (
        <p className="muted">{copy.usage(usage.requests, formatMicroUsd(usage.costMicroUsd))}</p>
      )}
    </section>
  );
}
