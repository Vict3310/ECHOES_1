import { randomUUID } from 'node:crypto';
import { env, gemmaConfigured } from '../../env';
import { logger } from '../../lib/logger';
import type { AiRequestRecord } from '../../domain/analytics';
import { createRepository } from '../../repo';

/**
 * Published list prices, in USD micros per million tokens.
 *
 * These are estimates for budgeting, never an invoice: providers change prices,
 * caching and batch discounts are not modelled, and a model we have no price for
 * reports its cost as unknown rather than free. Self-hosted inference is priced
 * at zero because there is no per-token charge — the compute is already paid for.
 */
export const MODEL_PRICES: Record<string, { inputMicrosPerMillion: number; outputMicrosPerMillion: number }> = {
  'gpt-4o-mini': { inputMicrosPerMillion: 150_000, outputMicrosPerMillion: 600_000 },
  'gpt-4o': { inputMicrosPerMillion: 2_500_000, outputMicrosPerMillion: 10_000_000 },
  'gemini-1.5-flash': { inputMicrosPerMillion: 75_000, outputMicrosPerMillion: 300_000 },
};

export function estimateCostMicros(
  model: string,
  provider: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  // Local inference has no per-token charge.
  if (provider === 'ollama') return 0;
  const price = MODEL_PRICES[model];
  if (!price) return null;
  if (inputTokens === null && outputTokens === null) return null;
  const input = ((inputTokens ?? 0) * price.inputMicrosPerMillion) / 1_000_000;
  const output = ((outputTokens ?? 0) * price.outputMicrosPerMillion) / 1_000_000;
  return Math.round(input + output);
}

export function errorKindFor(status: number, message: string): AiRequestRecord['errorKind'] {
  const text = message.toLowerCase();
  if (text.includes('abort') || text.includes('timeout') || text.includes('timed out')) return 'timeout';
  if (status === 429 || text.includes('rate limit')) return 'rate_limit';
  if (status >= 500) return 'provider';
  if (status === 401 || status === 403 || text.includes('api key') || text.includes('not configured')) {
    return 'config';
  }
  if (status >= 400) return 'provider';
  return 'unknown';
}

/**
 * Records one AI request.
 *
 * Only metadata is kept: feature, model, timing, token counts and an outcome.
 * Prompts, answers and any personal information inside them are never written,
 * so this table is safe to read and export.
 */
export async function logAiRequest(input: {
  feature: AiRequestRecord['feature'];
  model: string;
  provider: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  errorMessage?: string | null;
  providerCostMinor?: number | null;
}): Promise<void> {
  const estimated = estimateCostMicros(
    input.model,
    input.provider,
    input.inputTokens ?? null,
    input.outputTokens ?? null,
  );
  const record: AiRequestRecord = {
    id: randomUUID(),
    feature: input.feature,
    model: input.model,
    provider: input.provider,
    ok: input.ok,
    status: input.status,
    latencyMs: input.latencyMs,
    promptTokens: input.inputTokens ?? null,
    completionTokens: input.outputTokens ?? null,
    providerCostMinor: input.providerCostMinor ?? null,
    estimatedCostMicros: estimated,
    errorKind: input.ok ? null : errorKindFor(input.status, input.errorMessage ?? ''),
    createdAt: new Date().toISOString(),
  };

  try {
    await createRepository().appendAiRequest(record);
  } catch (error) {
    // Cost telemetry must never break the user's request.
    logger.warn({ err: error }, 'could not record an AI request');
  }
}

export interface BudgetStatus {
  configured: boolean;
  daily: { limitMicros: number; spentMicros: number; percentUsed: number | null; exceeded: boolean };
  monthly: { limitMicros: number; spentMicros: number; percentUsed: number | null; exceeded: boolean };
  alertThresholdPercent: number;
  alerting: boolean;
  currency: 'USD';
  note: string;
}

export function budgetStatus(dailyMicros: number, monthlyMicros: number): BudgetStatus {
  const { dailyMicros: dailyLimit, monthlyMicros: monthlyLimit, alertThresholdPercent } = env.aiBudget;
  const ratio = (spent: number, limit: number): number | null => (limit <= 0 ? null : (spent / limit) * 100);

  const dailyPercent = ratio(dailyMicros, dailyLimit);
  const monthlyPercent = ratio(monthlyMicros, monthlyLimit);
  const alerting =
    (dailyPercent !== null && dailyPercent >= alertThresholdPercent) ||
    (monthlyPercent !== null && monthlyPercent >= alertThresholdPercent);

  return {
    configured: dailyLimit > 0 || monthlyLimit > 0,
    daily: {
      limitMicros: dailyLimit,
      spentMicros: dailyMicros,
      percentUsed: dailyPercent,
      exceeded: dailyLimit > 0 && dailyMicros > dailyLimit,
    },
    monthly: {
      limitMicros: monthlyLimit,
      spentMicros: monthlyMicros,
      percentUsed: monthlyPercent,
      exceeded: monthlyLimit > 0 && monthlyMicros > monthlyLimit,
    },
    alertThresholdPercent,
    alerting,
    currency: 'USD',
    note:
      'Spend is estimated from published token prices. It is a budgeting signal, not a provider invoice, and it excludes requests whose model has no known price.',
  };
}

export function aiConfiguration(): {
  provider: string;
  model: string;
  configured: boolean;
  priceKnown: boolean;
} {
  return {
    provider: env.gemma.provider,
    model: env.gemma.model,
    configured: gemmaConfigured(),
    priceKnown: env.gemma.provider === 'ollama' || Boolean(MODEL_PRICES[env.gemma.model]),
  };
}
