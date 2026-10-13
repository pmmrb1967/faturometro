/** AI glue for the app: provider from the settings, local usage log. */
import type { Repositories } from '../db/repositories';
import type { Settings } from '../domain/types';
import { AnthropicProvider } from './anthropic';
import { DEFAULT_AI_MODEL } from './models';
import type { AiProvider, AiUsage } from './provider';

type AiSettings = Pick<Settings, 'aiApiKey' | 'aiModel'>;

export function hasAiKey(settings: AiSettings): boolean {
  return Boolean(settings.aiApiKey?.trim());
}

export function aiModelOf(settings: AiSettings): string {
  return settings.aiModel ?? DEFAULT_AI_MODEL;
}

export function providerFromSettings(settings: AiSettings): AiProvider | undefined {
  if (!hasAiKey(settings)) return undefined;
  return new AnthropicProvider({
    apiKey: settings.aiApiKey ?? '',
    model: aiModelOf(settings),
    browser: true,
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
