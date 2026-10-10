import { env } from '../../env';
import { logger } from '../../lib/logger';

export interface GenerateOptions {
  system: string;
  prompt: string;
  /** Ask the provider for machine-readable JSON (validated by the caller). */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  provider: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
}

export interface GemmaProvider {
  readonly name: 'google' | 'ollama' | 'offline';
  readonly model: string;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  health(): Promise<{ ok: boolean; message: string }>;
}

export class GemmaUnavailableError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'GemmaUnavailableError';
  }
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

/** Google AI for Developers — hosted Gemma inference (ai.google.dev/gemma). */
class GoogleGemmaProvider implements GemmaProvider {
  readonly name = 'google' as const;
  constructor(readonly model: string, private readonly apiKey: string) {}

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const { signal, done } = withTimeout(env.gemma.timeoutMs);
    const started = Date.now();
    try {
      const url = `${env.gemma.googleBaseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: options.system }] },
          contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
          generationConfig: {
            temperature: options.temperature ?? 0.3,
            maxOutputTokens: options.maxTokens ?? env.gemma.maxOutputTokens,
            ...(options.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new GemmaUnavailableError(
          `Gemma (Google AI) returned HTTP ${response.status}. ${detail.slice(0, 300)}`,
        );
      }

      const body = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text =
        body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')?.trim() ?? '';
      if (!text) throw new GemmaUnavailableError('Gemma returned an empty response.');

      return {
        text,
        provider: this.name,
        model: this.model,
        usage: {
          inputTokens: body.usageMetadata?.promptTokenCount,
          outputTokens: body.usageMetadata?.candidatesTokenCount,
        },
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      if (error instanceof GemmaUnavailableError) throw error;
      throw new GemmaUnavailableError(
        error instanceof Error ? `Gemma (Google AI) request failed: ${error.message}` : 'Gemma request failed.',
        error,
      );
    } finally {
      done();
    }
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.generate({ system: 'Reply with the single word: ready', prompt: 'ping', maxTokens: 8 });
      return { ok: true, message: `Google AI reachable (${result.model}).` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'unreachable' };
    }
  }
}

/** Ollama — self-hosted Gemma inference (docs.ollama.com). */
class OllamaGemmaProvider implements GemmaProvider {
  readonly name = 'ollama' as const;
  constructor(readonly model: string, private readonly baseUrl: string) {}

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const { signal, done } = withTimeout(env.gemma.timeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          ...(options.json ? { format: 'json' } : {}),
          options: {
            temperature: options.temperature ?? 0.3,
            num_predict: options.maxTokens ?? env.gemma.maxOutputTokens,
          },
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.prompt },
          ],
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new GemmaUnavailableError(
          `Ollama returned HTTP ${response.status}. ${detail.slice(0, 300)}`,
        );
      }

      const body = (await response.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const text = body.message?.content?.trim() ?? '';
      if (!text) throw new GemmaUnavailableError('Gemma returned an empty response.');

      return {
        text,
        provider: this.name,
        model: this.model,
        usage: { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count },
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      if (error instanceof GemmaUnavailableError) throw error;
      throw new GemmaUnavailableError(
        error instanceof Error ? `Gemma (Ollama) request failed: ${error.message}` : 'Gemma request failed.',
        error,
      );
    } finally {
      done();
    }
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/tags`);
      if (!response.ok) return { ok: false, message: `Ollama returned HTTP ${response.status}.` };
      const body = (await response.json()) as { models?: Array<{ name?: string }> };
      const names = (body.models ?? []).map((m) => m.name ?? '').filter(Boolean);
      const present = names.some((n) => n.startsWith(this.model.split(':')[0] ?? this.model));
      return {
        ok: present,
        message: present
          ? `Ollama reachable and model "${this.model}" is installed.`
          : `Ollama reachable but model "${this.model}" is not installed. Installed: ${names.join(', ') || 'none'}.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Ollama unreachable at ${this.baseUrl}: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  }
}

/**
 * Offline provider: no language model is called. Callers detect this and fall
 * back to retrieval-only answers assembled from the citation records, so the
 * product keeps working — and keeps its provenance — without a model.
 */
export class OfflineProvider implements GemmaProvider {
  readonly name = 'offline' as const;
  readonly model = 'none';

  async generate(): Promise<GenerateResult> {
    throw new GemmaUnavailableError(
      'No Gemma provider is configured (set GEMMA_PROVIDER=ollama or =google with credentials).',
    );
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    return {
      ok: false,
      message: 'No Gemma provider configured. Grounded retrieval answers remain available offline.',
    };
  }
}

export function createGemmaProvider(): GemmaProvider {
  if (env.gemma.provider === 'google') {
    if (!env.gemma.googleApiKey) {
      logger.warn('GEMMA_PROVIDER=google but GOOGLE_AI_API_KEY is empty; falling back to offline mode.');
      return new OfflineProvider();
    }
    return new GoogleGemmaProvider(env.gemma.model, env.gemma.googleApiKey);
  }
  if (env.gemma.provider === 'ollama') {
    return new OllamaGemmaProvider(env.gemma.model, env.gemma.ollamaBaseUrl);
  }
  return new OfflineProvider();
}
