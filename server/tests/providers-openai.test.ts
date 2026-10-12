import { describe, expect, it } from 'vitest';
import { env } from '../src/env';
import { createGemmaProvider } from '../src/services/gemma/providers';

describe('AI provider selection', () => {
  it('uses OpenAI GPT-4o mini when configured as the primary model', () => {
    const previousProvider = env.gemma.provider;
    const previousModel = env.gemma.model;
    const previousApiKey = env.gemma.openaiApiKey;

    env.gemma.provider = 'openai';
    env.gemma.model = 'gpt-4o-mini';
    env.gemma.openaiApiKey = 'test-key';

    try {
      const provider = createGemmaProvider();
      expect(provider.name).toBe('openai');
      expect(provider.model).toBe('gpt-4o-mini');
    } finally {
      env.gemma.provider = previousProvider;
      env.gemma.model = previousModel;
      env.gemma.openaiApiKey = previousApiKey;
    }
  });
});
