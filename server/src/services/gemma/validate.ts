import { z } from 'zod';

export const answerSchema = z.object({
  answer: z.string().min(1).max(4000),
  citationIds: z.array(z.string().max(16)).max(20).default([]),
  evidenceStatus: z.enum(['sufficient', 'insufficient', 'conflicting']),
  followUpQuestions: z.array(z.string().max(200)).max(4).default([]),
});
export type AnswerPayload = z.infer<typeof answerSchema>;

export const itinerarySchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1500),
  stops: z
    .array(
      z.object({
        placeId: z.string().min(1).max(80),
        reason: z.string().min(1).max(400),
        suggestedVisitMinutes: z.number().int().min(5).max(480),
      }),
    )
    .max(12)
    .min(1),
  limitations: z.array(z.string().max(300)).max(8).default([]),
});
export type ItineraryPayload = z.infer<typeof itinerarySchema>;

/** Pull the first JSON object out of a model response (handles ```json fences). */
export function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseStructured<S extends z.ZodTypeAny>(
  raw: string,
  schema: S,
): ParseResult<z.output<S>> {
  const json = extractJson(raw);
  if (!json) return { ok: false, error: 'Model response did not contain a JSON object.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Model response was not valid JSON.' };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    };
  }
  return { ok: true, data: result.data };
}

/**
 * Drops citations the model produced that do not correspond to a retrieved
 * record, so an answer can never display a link that does not support it.
 */
export function validateCitations(
  citationIds: string[],
  available: string[],
): { valid: string[]; dropped: string[] } {
  const allowed = new Set(available);
  const valid: string[] = [];
  const dropped: string[] = [];
  for (const id of citationIds) {
    if (allowed.has(id)) {
      if (!valid.includes(id)) valid.push(id);
    } else {
      dropped.push(id);
    }
  }
  return { valid, dropped };
}

/**
 * Every place id returned by the model is checked against the candidate set
 * that was actually retrieved from the database.
 */
export function validateStopPlaceIds<T extends { placeId: string }>(
  stops: T[],
  candidateIds: string[],
): { valid: T[]; dropped: string[] } {
  const allowed = new Set(candidateIds);
  const valid: T[] = [];
  const dropped: string[] = [];
  for (const stop of stops) {
    if (allowed.has(stop.placeId)) {
      if (!valid.some((s) => s.placeId === stop.placeId)) valid.push(stop);
    } else {
      dropped.push(stop.placeId);
    }
  }
  return { valid, dropped };
}
