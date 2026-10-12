import { Router } from 'express';
import type { Place } from '../domain/types';
import { env, gemmaConfigured } from '../env';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { AI_INTEGRITY_NOTE } from '../services/gemma/notes';
import { aiLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { createRepository } from '../repo';
import { askSchema, narrationSchema } from '../schemas';
import { answerCulturalQuestion, generateNarrationScript } from '../services/gemma/guide';
import { createGemmaProvider } from '../services/gemma/providers';
import { logRecordOnlyAnswer, withAiLogging } from '../services/analytics/instrument';
import { analysePlace } from '../services/knowledge';

export const aiRouter = Router();

/** Builds the grounding inputs: places, sample listings and moderated accounts. */
async function groundingDeps() {
  const repo = createRepository();
  const places = await repo.listPlaces({});
  const experiences = (await repo.listExperiences()).map((e) => ({
    id: e.id,
    title: e.title,
    placeId: e.placeId,
    isSampleData: e.isSampleData,
  }));
  const communityStories: Array<{ place: Place; stories: Awaited<ReturnType<typeof repo.listStoriesForPlace>> }> = [];
  for (const place of places) {
    const stories = await repo.listStoriesForPlace(place.id, 'approved');
    if (stories.length > 0) communityStories.push({ place, stories });
  }
  return { places, experiences, communityStories };
}

aiRouter.get(
  '/ai/status',
  asyncHandler(async (_req, res) => {
    const provider = createGemmaProvider();
    const health = env.isTest ? { ok: gemmaConfigured(), message: 'skipped in tests' } : await provider.health();
    ok(res, {
      primaryModel: 'Gemma',
      provider: provider.name,
      model: provider.model,
      configured: gemmaConfigured(),
      healthy: health.ok,
      detail: health.message,
      offlineFallback:
        'When Gemma is unavailable, answers are assembled directly from ECHOES records with citations intact.',
      narration: {
        script: 'Written by Gemma when configured, otherwise taken verbatim from the stored record.',
        audio: 'Playback uses the browser speech synthesis API. No external text-to-speech provider is integrated.',
      },
    });
  }),
);

aiRouter.post(
  '/ai/answer',
  aiLimiter,
  validateBody(askSchema),
  asyncHandler(async (req, res) => {
    const { question, placeId } = req.body as { question: string; placeId?: string | null };

    if (placeId) {
      const repo = createRepository();
      const place = await repo.getPlace(placeId);
      if (!place) throw ApiError.badRequest('That place does not exist in ECHOES.');
    }

    const deps = await groundingDeps();
    // The provider is wrapped, not replaced: the guide keeps its own fallback,
    // and every model call is measured on the way through.
    const provider = withAiLogging(createGemmaProvider(), 'guide');
    const started = Date.now();
    const result = await answerCulturalQuestion(question, { ...deps, provider }, placeId ?? null);
    if (provider.name === 'offline') {
      // Answered from ECHOES records with no model involved: still a served
      // question, and named as such rather than counted as a model call.
      await logRecordOnlyAnswer('guide', Date.now() - started);
    }

    ok(res, {
      ...result,
      grounding: {
        placesUsed: result.placesUsed,
        citationCount: result.citations.length,
        sourcesChecked: AI_INTEGRITY_NOTE.sourcesChecked,
      },
      integrity: AI_INTEGRITY_NOTE.integrity,
    });
  }),
);

aiRouter.post(
  '/ai/narration',
  aiLimiter,
  validateBody(narrationSchema),
  asyncHandler(async (req, res) => {
    const { placeId } = req.body as { placeId: string };
    const repo = createRepository();
    const place = await repo.getPlace(placeId);
    if (!place) throw ApiError.notFound('No cultural place matches that id.');

    const stories = await repo.listStoriesForPlace(place.id, 'approved');
    const provider = withAiLogging(createGemmaProvider(), 'guide');
    const started = Date.now();
    const narration = await generateNarrationScript(place, stories, provider);
    if (provider.name === 'offline') await logRecordOnlyAnswer('guide', Date.now() - started);
    const analysis = analysePlace(place);

    ok(res, {
      placeId: place.id,
      placeName: place.name,
      script: narration.script,
      mode: narration.mode,
      model: narration.model,
      audio: {
        provider: 'browser-speech-synthesis',
        note: 'No external text-to-speech provider is integrated. Playback happens in the browser and is labelled as generated narration.',
      },
      sources: place.sources,
      qualifications: {
        coverageExplanation: analysis.explanation,
        communityAccountsAreUnverified: stories.length > 0,
      },
    });
  }),
);
