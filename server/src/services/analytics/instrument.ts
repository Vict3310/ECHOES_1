import { GemmaUnavailableError, type GemmaProvider, type GenerateOptions, type GenerateResult } from '../gemma/providers';
import { logger } from '../../lib/logger';
import { logAiRequest } from './ai';

/**
 * Wraps a provider so every call is measured.
 *
 * The wrapper sits between the feature code and the provider, which is the only
 * place that sees both the timing and the outcome. It records metadata only:
 * neither the prompt nor the answer is passed to the logger, so nothing a visitor
 * typed can end up in the AI table.
 */
export function withAiLogging(provider: GemmaProvider, feature: 'guide' | 'itinerary' | 'translate'): GemmaProvider {
  return {
    name: provider.name,
    model: provider.model,
    health: () => provider.health(),
    async generate(options: GenerateOptions): Promise<GenerateResult> {
      const started = Date.now();
      try {
        const result = await provider.generate(options);
        await logAiRequest({
          feature,
          model: result.model || provider.model,
          provider: result.provider || provider.name,
          ok: true,
          status: 200,
          latencyMs: result.latencyMs ?? Date.now() - started,
          inputTokens: result.usage?.inputTokens ?? null,
          outputTokens: result.usage?.outputTokens ?? null,
        });
        return result;
      } catch (error) {
        const status = statusFromErrorMessage(error);
        await logAiRequest({
          feature,
          model: provider.model,
          provider: provider.name,
          ok: false,
          status,
          latencyMs: Date.now() - started,
          errorMessage: error instanceof Error ? error.message : 'unknown error',
        });
        logger.warn(
          { feature, provider: provider.name, status, err: error instanceof Error ? error.message : error },
          'AI request failed',
        );
        throw error;
      }
    },
  };
}

/**
 * Recovers the provider's HTTP status from the message the provider threw, so a
 * 429 is distinguishable from a 500 in the cost and error views. Anything
 * unrecognised is treated as a provider-side failure rather than a client error.
 */
function statusFromErrorMessage(error: unknown): number {
  if (!(error instanceof GemmaUnavailableError)) return 500;
  const match = /HTTP (\d{3})/.exec(error.message);
  if (match?.[1]) return Number.parseInt(match[1], 10);
  if (/abort|timeout|timed out/i.test(error.message)) return 504;
  if (/not configured|api key/i.test(error.message)) return 503;
  return 500;
}

/**
 * Records a question answered without a language model.
 *
 * ECHOES keeps working when no provider is configured, answering from its own
 * records. That is a served request and belongs in the volumes — with the model
 * named as the record set, and no tokens or cost invented for it.
 */
export async function logRecordOnlyAnswer(feature: 'guide' | 'itinerary', latencyMs: number): Promise<void> {
  await logAiRequest({
    feature,
    model: 'records-only',
    provider: 'offline',
    ok: true,
    status: 200,
    latencyMs,
    inputTokens: null,
    outputTokens: null,
  });
}
