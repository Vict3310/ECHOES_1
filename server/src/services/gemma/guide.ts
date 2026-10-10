import { logger } from '../../lib/logger';
import type { Place, Story } from '../../domain/types';
import { analysePlace } from '../knowledge';
import { buildGrounding, type CitationRecord } from './grounding';
import { GUIDE_SYSTEM_PROMPT, NARRATION_SYSTEM_PROMPT, guideUserPrompt } from './prompts';
import { GemmaUnavailableError, createGemmaProvider, type GemmaProvider } from './providers';
import { answerSchema, parseStructured, validateCitations } from './validate';

export interface AnswerResult {
  answer: string;
  citations: CitationRecord[];
  evidenceStatus: 'sufficient' | 'insufficient' | 'conflicting';
  followUpQuestions: string[];
  mode: 'gemma' | 'retrieval-only';
  provider: string;
  model: string;
  latencyMs: number;
  limitations: string[];
  placesUsed: Array<{ id: string; name: string; category: string }>;
}

export interface AnswerDeps {
  places: Place[];
  experiences?: Array<{ id: string; title: string; placeId: string; isSampleData: boolean }>;
  communityStories?: Array<{ place: Place; stories: Story[] }>;
  provider?: GemmaProvider;
}

export async function answerCulturalQuestion(
  question: string,
  deps: AnswerDeps,
  focusPlaceId?: string | null,
): Promise<AnswerResult> {
  const provider = deps.provider ?? createGemmaProvider();
  const bundle = buildGrounding({
    question,
    places: deps.places,
    experiences: deps.experiences,
    communityStories: deps.communityStories,
    focusPlaceId: focusPlaceId ?? null,
  });

  const focus = focusPlaceId ? deps.places.find((p) => p.id === focusPlaceId) : undefined;
  const availableIds = bundle.citations.map((c) => c.id);

  const base = {
    provider: provider.name,
    model: provider.model,
    placesUsed: bundle.placesUsed.map((p) => ({ id: p.id, name: p.name, category: p.category })),
  };

  try {
    const result = await provider.generate({
      system: GUIDE_SYSTEM_PROMPT,
      prompt: guideUserPrompt(bundle.contextBlock, question, focus?.name),
      json: true,
      temperature: 0.25,
    });

    const parsed = parseStructured(result.text, answerSchema);
    if (!parsed.ok) {
      logger.warn({ error: parsed.error }, 'Gemma returned unusable structured output; using retrieval fallback.');
      return { ...retrievalOnlyAnswer(bundle, question), latencyMs: result.latencyMs };
    }

    const payload = parsed.data;
    const { valid, dropped } = validateCitations(payload.citationIds ?? [], availableIds);
    const limitations: string[] = [];
    if (dropped.length > 0) {
      limitations.push(
        `Removed ${dropped.length} citation${dropped.length === 1 ? '' : 's'} that did not match a retrieved record.`,
      );
    }

    return {
      answer: payload.answer,
      citations: bundle.citations.filter((c) => valid.includes(c.id)),
      evidenceStatus: payload.evidenceStatus,
      followUpQuestions: payload.followUpQuestions ?? [],
      mode: 'gemma',
      latencyMs: result.latencyMs,
      limitations,
      ...base,
    } satisfies AnswerResult;
  } catch (error) {
    if (error instanceof GemmaUnavailableError) {
      logger.warn({ err: error.message }, 'Gemma unavailable; serving retrieval-only answer.');
      const fallback = retrievalOnlyAnswer(bundle, question);
      return {
        ...fallback,
        limitations: [`Gemma is not available: ${error.message}`, ...fallback.limitations],
      };
    }
    throw error;
  }
}

/**
 * No-model fallback. It assembles an answer strictly from the retrieved
 * records, keeps the citations, and states what is missing. It never
 * paraphrases beyond the stored text.
 */
function retrievalOnlyAnswer(
  bundle: ReturnType<typeof buildGrounding>,
  question: string,
): AnswerResult {
  const [first, ...rest] = bundle.placesUsed;
  if (!first) {
    return {
      answer:
        'ECHOES has no matching record for that question. Try a place name, a neighbourhood, or ask which places have incomplete records.',
      citations: [],
      evidenceStatus: 'insufficient',
      followUpQuestions: ['Which places have incomplete records?', 'Show me museums in Lagos'],
      mode: 'retrieval-only',
      provider: 'offline',
      model: 'none',
      latencyMs: 0,
      limitations: [
        'No language model is configured, so this answer is assembled directly from ECHOES records.',
      ],
      placesUsed: [],
    };
  }

  const analysis = analysePlace(first);
  const lines: string[] = [
    `${first.name} — ${first.summary}`,
    '',
    first.history,
    '',
  ];

  if (rest.length > 0) {
    lines.push('Related records:');
    for (const place of rest) {
      lines.push(`• ${place.name} — ${place.summary}`);
    }
    lines.push('');
  }

  if (analysis.needsResearch) {
    lines.push(`Gaps in the sources that were checked: ${analysis.explanation}`);
  }

  lines.push(
    '',
    `Sources: ${first.sources.map((s) => `${s.title} — ${s.url}`).join(' | ') || 'none recorded'}`,
  );

  return {
    answer: lines.join('\n'),
    citations: bundle.citations,
    evidenceStatus: analysis.needsResearch ? 'insufficient' : 'sufficient',
    followUpQuestions: [
      `What is missing from the records for ${first.name}?`,
      'Which nearby places are worth visiting?',
    ],
    mode: 'retrieval-only',
    provider: 'offline',
    model: 'none',
    latencyMs: 0,
    limitations: [
      'Retrieval-only mode: no language model is configured, so this is assembled verbatim from ECHOES records.',
      'Question was: ' + question.slice(0, 160),
    ],
    placesUsed: bundle.placesUsed.map((p) => ({ id: p.id, name: p.name, category: p.category })),
  };
}

export async function generateNarrationScript(
  place: Place,
  stories: Story[],
  provider: GemmaProvider = createGemmaProvider(),
): Promise<{ script: string; mode: 'gemma' | 'records'; model: string }> {
  const analysis = analysePlace(place);
  const records = [
    `PLACE: ${place.name} (${place.category}, ${place.neighbourhood})`,
    `SUMMARY: ${place.summary}`,
    `HISTORY: ${place.history}`,
    `SOURCES: ${place.sources.map((s) => `${s.title} (${s.publisher})`).join(' | ') || 'none recorded'}`,
    `COVERAGE: ${analysis.explanation}`,
    stories.length
      ? `COMMUNITY ACCOUNTS (unverified): ${stories.map((s) => s.body).join(' || ')}`
      : 'COMMUNITY ACCOUNTS (unverified): none published',
  ].join('\n');

  try {
    const result = await provider.generate({
      system: NARRATION_SYSTEM_PROMPT,
      prompt: records,
      temperature: 0.4,
      maxTokens: 400,
    });
    return { script: result.text.trim(), mode: 'gemma', model: `${result.provider}:${result.model}` };
  } catch (error) {
    if (!(error instanceof GemmaUnavailableError)) throw error;
    // Fall back to the stored record so audio storytelling still works offline.
    const script = `${place.name}. ${place.summary} ${place.history}`.trim();
    return { script, mode: 'records', model: 'records-only' };
  }
}
