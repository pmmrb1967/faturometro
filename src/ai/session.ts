/** AI glue for the app: provider from the settings, local usage log. */
import { isGuest, type Profile } from '../db/profiles';
import type { Repositories } from '../db/repositories';
import type { AiMode, Settings } from '../domain/types';
import { DEFAULT_SYNC_URL } from '../sync/config';
import { AnthropicProvider } from './anthropic';
import { deviceId } from './device';
import { FreeProvider } from './free';
import { GeminiProvider } from './gemini';
import { prepareFreeImages } from './images';
import { findModel } from './models';
import type { AiProvider, AiUsage } from './provider';

type AiSettings = Pick<
  Settings,
  'aiMode' | 'aiApiKey' | 'aiModel' | 'aiGeminiKey' | 'aiGeminiModel' | 'ownNif'
>;

/** The chosen AI; older settings without a choice keep Claude if they have its key. */
export function aiModeOf(settings: Partial<AiSettings>): AiMode {
  if (settings.aiMode) return settings.aiMode;
  return settings.aiApiKey?.trim() ? 'anthropic' : 'free';
}

/** The user's key for a provider that needs one. */
export function aiKeyOf(settings: Partial<AiSettings>, mode: 'gemini' | 'anthropic'): string {
  return ((mode === 'gemini' ? settings.aiGeminiKey : settings.aiApiKey) ?? '').trim();
}

/** Whether the chosen AI can be used now (a key is saved, when it needs one). */
export function hasAiKey(settings: Partial<AiSettings>): boolean {
  const mode = aiModeOf(settings);
  if (mode === 'free') return true;
  if (mode === 'none') return false;
  return Boolean(aiKeyOf(settings, mode));
}

/**
 * Keys need an account: a guest's key would sit unprotected in the browser.
 * The free AI has no key, so guests can use it too.
 */
export function aiAvailable(profile: Profile, settings: Partial<AiSettings>): boolean {
  const mode = aiModeOf(settings);
  if (mode === 'free') return true;
  return !isGuest(profile) && hasAiKey(settings);
}

export function aiModelOf(settings: Partial<AiSettings>): string {
  const mode = aiModeOf(settings);
  if (mode === 'gemini') return findModel(settings.aiGeminiModel, 'gemini').id;
  if (mode === 'free') return findModel(undefined, 'free').id;
  return findModel(settings.aiModel, 'anthropic').id;
}

export function providerFromSettings(settings: Partial<AiSettings>): AiProvider | undefined {
  if (!hasAiKey(settings)) return undefined;
  const mode = aiModeOf(settings);
  const model = aiModelOf(settings);
  if (mode === 'free') return freeProvider(settings);
  if (mode === 'gemini') return new GeminiProvider({ apiKey: aiKeyOf(settings, mode), model });
  return new AnthropicProvider({ apiKey: aiKeyOf(settings, 'anthropic'), model, browser: true });
}

/** The free AI, also for its status in the settings. */
export function freeProvider(settings: Partial<AiSettings>): FreeProvider {
  return new FreeProvider({
    // The build's sync server (the project's by default), the one the CSP allows.
    serverUrl: DEFAULT_SYNC_URL,
    deviceId: deviceId(),
    known: settings.ownNif ? [settings.ownNif] : [],
    prepareImages: prepareFreeImages,
  });
}

export async function recordUsage(repos: Repositories, usage: readonly AiUsage[]): Promise<void> {
  for (const entry of usage) {
    await repos.aiUsage.put({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      task: entry.task,
      model: entry.model,
      promptVersion: entry.promptVersion,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      costMicroUsd: entry.costMicroUsd,
    });
  }
}

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

/** Requests made from this device since `since` (ISO date-time). */
export async function usageSince(repos: Repositories, since: string): Promise<UsageSummary> {
  const records = (await repos.aiUsage.list()).filter((record) => record.createdAt >= since);
  return records.reduce<UsageSummary>(
    (sum, record) => ({
      requests: sum.requests + 1,
      inputTokens: sum.inputTokens + record.inputTokens,
      outputTokens: sum.outputTokens + record.outputTokens,
      costMicroUsd: sum.costMicroUsd + record.costMicroUsd,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 },
  );
}
