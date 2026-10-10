import { describe, expect, it } from 'vitest';
import {
  answerSchema,
  extractJson,
  itinerarySchema,
  parseStructured,
  validateCitations,
  validateStopPlaceIds,
} from '../src/services/gemma/validate';

describe('structured model output', () => {
  it('extracts JSON from fenced and unfenced responses', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('here you go: {"a":1} thanks')).toBe('{"a":1}');
    expect(extractJson('no json here')).toBeNull();
  });

  it('accepts a well-formed answer', () => {
    const result = parseStructured(
      JSON.stringify({
        answer: 'Freedom Park occupies the former Broad Street Prison [S1].',
        citationIds: ['S1'],
        evidenceStatus: 'sufficient',
        followUpQuestions: ['What else is nearby?'],
      }),
      answerSchema,
    );
    expect(result.ok).toBe(true);
    expect(result.data?.citationIds).toEqual(['S1']);
  });

  it('rejects malformed answers instead of trusting them', () => {
    expect(parseStructured('not json', answerSchema).ok).toBe(false);
    expect(parseStructured(JSON.stringify({ answer: '' }), answerSchema).ok).toBe(false);
    expect(
      parseStructured(JSON.stringify({ answer: 'x', evidenceStatus: 'definitely' }), answerSchema).ok,
    ).toBe(false);
  });

  it('drops citations that were never retrieved, so no link can be fabricated', () => {
    const { valid, dropped } = validateCitations(['S1', 'S9', 'S2', 'S1'], ['S1', 'S2']);
    expect(valid).toEqual(['S1', 'S2']);
    expect(dropped).toEqual(['S9']);
  });

  it('rejects itinerary stops whose place ids are not in the database', () => {
    const { valid, dropped } = validateStopPlaceIds(
      [
        { placeId: 'freedom-park-lagos', reason: 'a', suggestedVisitMinutes: 30 },
        { placeId: 'invented-place', reason: 'b', suggestedVisitMinutes: 30 },
      ],
      ['freedom-park-lagos', 'nike-art-gallery'],
    );
    expect(valid.map((s) => s.placeId)).toEqual(['freedom-park-lagos']);
    expect(dropped).toEqual(['invented-place']);
  });

  it('rejects itineraries with zero stops or out-of-range durations', () => {
    expect(
      parseStructured(JSON.stringify({ title: 't', summary: 's', stops: [] }), itinerarySchema).ok,
    ).toBe(false);
    expect(
      parseStructured(
        JSON.stringify({
          title: 't',
          summary: 's',
          stops: [{ placeId: 'p', reason: 'r', suggestedVisitMinutes: 5000 }],
        }),
        itinerarySchema,
      ).ok,
    ).toBe(false);
  });
});
