import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, CornerDownLeft, ExternalLink, Info, Loader2, Sparkles, User } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { categoryLabel } from '../lib/format';
import { usePlaces } from '../lib/hooks';
import type { AnswerResult } from '../lib/types';
import { Chip, Notice, SectionHeading } from '../components/ui';
import { Reveal } from '../components/layout';

interface Turn {
  id: string;
  question: string;
  result?: AnswerResult;
  error?: string;
}

const SUGGESTIONS = [
  'What makes Freedom Park historically important?',
  'Which cultural places are worth visiting on Lagos Island?',
  'Which places have incomplete digital records?',
  'Tell me the story behind the New Afrika Shrine.',
  'Explain Kalakuta Museum in simple language.',
  'Which places have verified guided experiences?',
];

const EVIDENCE_TONE: Record<AnswerResult['evidenceStatus'], string> = {
  sufficient: 'border-brand-deep/20 bg-brand-soft/60 text-brand-deep',
  insufficient: 'border-[#C8973F]/30 bg-[#C8973F]/12 text-[#7A5518]',
  conflicting: 'border-[#B4432A]/30 bg-[#B4432A]/12 text-[#8E3320]',
};

export default function Assistant() {
  const [params, setParams] = useSearchParams();
  const placeId = params.get('place');
  const { places } = usePlaces();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const activePlace = useMemo(() => places.find((place) => place.id === placeId) ?? null, [places, placeId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, loading]);

  async function ask(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (trimmed.length < 3) return;

    const turn: Turn = { id: `${Date.now()}-${turns.length}`, question: trimmed };
    setTurns((current) => [...current, turn]);
    setQuestion('');
    setLoading(true);

    try {
      const result = await api.ask(trimmed, placeId);
      setTurns((current) =>
        current.map((item) => (item.id === turn.id ? { ...item, result } : item)),
      );
    } catch (error) {
      setTurns((current) =>
        current.map((item) =>
          item.id === turn.id
            ? {
                ...item,
                error:
                  error instanceof ApiClientError
                    ? error.message
                    : 'The assistant could not answer that question.',
              }
            : item,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pt-32 sm:pt-40">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading
          eyebrow="Cultural assistant — Gemma"
          title="Answers grounded in the records, with the"
          accent="evidence attached."
          description="Every answer is assembled from ECHOES records and their cited sources. Gemma writes the explanation; the records supply the facts, and citations that do not match a retrieved record are discarded on the server."
        />
      </div>

      <div className="mx-auto mt-10 grid max-w-7xl grid-cols-1 gap-8 px-6 pb-24 sm:px-10 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Reveal>
            <div className="card p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="min-w-[240px] flex-1">
                  <span className="field-label">Focus on a place (optional)</span>
                  <select
                    className="field-input"
                    value={placeId ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value) setParams({ place: value });
                      else setParams({});
                    }}
                  >
                    <option value="">No specific place</option>
                    {(places.length ? places : []).map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.name} — {place.neighbourhood}
                      </option>
                    ))}
                  </select>
                </label>
                {activePlace && (
                  <Link to={`/places/${activePlace.id}`} className="btn-secondary">
                    Open {activePlace.name}
                  </Link>
                )}
              </div>

              <form
                className="mt-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void ask(question);
                }}
              >
                <label className="field-label" htmlFor="question">
                  Your question
                </label>
                <textarea
                  id="question"
                  rows={3}
                  className="field-input resize-none"
                  placeholder="Ask about a place, a neighbourhood, or what the records are missing…"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={600}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void ask(question);
                    }
                  }}
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="submit" className="btn-primary" disabled={loading || question.trim().length < 3}>
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                    )}
                    Ask ECHOES
                  </button>
                  <span className="inline-flex items-center gap-1.5 text-xs text-black/40">
                    <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
                    Ctrl/⌘ + Enter to send
                  </span>
                </div>
              </form>

              <div className="mt-5">
                <p className="mb-2 text-xs uppercase tracking-widest text-black/40">Suggested questions</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void ask(suggestion)}
                      disabled={loading}
                      className="rounded-full border border-black/15 px-3 py-1.5 text-left text-xs text-black/60 transition-colors hover:border-brand-deep/40 hover:text-ink disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>

          <div className="mt-6 space-y-6">
            {turns.map((turn) => (
              <div key={turn.id} className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-cream">
                    <User className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <p className="pt-1 text-sm font-medium">{turn.question}</p>
                </div>

                {!turn.result && !turn.error && (
                  <div className="flex items-center gap-3 pl-10 text-sm text-black/50">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-deep" aria-hidden="true" />
                    Retrieving records and writing the answer…
                  </div>
                )}

                {turn.error && (
                  <div className="pl-10">
                    <Notice tone="warn" title="The assistant could not answer">
                      {turn.error}
                    </Notice>
                  </div>
                )}

                {turn.result && (
                  <div className="rounded-2xl border border-black/10 bg-white/60 p-5">
                    <div className="mb-3 flex items-start gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-deep text-white">
                        <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${EVIDENCE_TONE[turn.result.evidenceStatus]}`}
                        >
                          Evidence: {turn.result.evidenceStatus}
                        </span>
                        <span className="rounded-full border border-black/15 px-2.5 py-0.5 text-[11px] text-black/55">
                          {turn.result.mode === 'gemma' ? `Gemma · ${turn.result.model}` : 'Retrieval-only'}
                        </span>
                        {turn.result.latencyMs > 0 && (
                          <span className="text-[11px] text-black/35">{turn.result.latencyMs} ms</span>
                        )}
                      </div>
                    </div>

                    <div className="whitespace-pre-line pl-10 text-sm leading-relaxed text-black/75">
                      {turn.result.answer}
                    </div>

                    {turn.result.citations.length > 0 && (
                      <div className="mt-5 pl-10">
                        <p className="mb-2 text-xs uppercase tracking-widest text-black/40">Sources cited</p>
                        <ul className="space-y-2">
                          {turn.result.citations.map((citation) => (
                            <li
                              key={citation.id}
                              className="rounded-xl border border-black/10 bg-cream/70 px-3 py-2"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <span className="text-xs">
                                  <span className="mr-2 rounded bg-brand-deep/10 px-1.5 py-0.5 font-mono text-[10px] text-brand-deep">
                                    {citation.id}
                                  </span>
                                  <span className="text-ink">{citation.title}</span>
                                  {citation.publisher && (
                                    <span className="ml-1 text-black/40">— {citation.publisher}</span>
                                  )}
                                  {citation.retrievedAt && (
                                    <span className="ml-1 text-black/30">· retrieved {citation.retrievedAt}</span>
                                  )}
                                </span>
                                {citation.url && (
                                  <a
                                    href={citation.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="shrink-0 text-black/35 hover:text-brand-deep"
                                    aria-label={`Open source: ${citation.title}`}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                  </a>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {turn.result.placesUsed.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2 pl-10">
                        {turn.result.placesUsed.map((place) => (
                          <Link key={place.id} to={`/places/${place.id}`}>
                            <Chip>{categoryLabel(place.category)}: {place.name}</Chip>
                          </Link>
                        ))}
                      </div>
                    )}

                    {turn.result.limitations.length > 0 && (
                      <ul className="mt-4 space-y-1 pl-10 text-xs leading-relaxed text-black/45">
                        {turn.result.limitations.map((limitation) => (
                          <li key={limitation}>• {limitation}</li>
                        ))}
                      </ul>
                    )}

                    {turn.result.followUpQuestions.length > 0 && (
                      <div className="mt-5 pl-10">
                        <p className="mb-2 text-xs uppercase tracking-widest text-black/40">Follow-up</p>
                        <div className="flex flex-wrap gap-2">
                          {turn.result.followUpQuestions.map((followUp) => (
                            <button
                              key={followUp}
                              type="button"
                              onClick={() => void ask(followUp)}
                              disabled={loading}
                              className="rounded-full border border-brand-deep/25 bg-brand-soft/40 px-3 py-1.5 text-left text-xs text-brand-deep transition-colors hover:bg-brand-soft disabled:opacity-50"
                            >
                              {followUp}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        <aside className="space-y-5 lg:col-span-4">
          <Reveal>
            <div className="card p-5">
              <p className="mb-3 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-black/40">
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                How this assistant behaves
              </p>
              <ul className="space-y-3 text-sm leading-relaxed text-black/60">
                <li>
                  Gemma is the primary model. If it is unavailable, ECHOES still answers — assembled directly from
                  the stored records, with citations intact and clearly labelled as retrieval-only.
                </li>
                <li>
                  Citations that do not match a retrieved record are removed on the server, so a displayed link
                  always corresponds to a record in the database.
                </li>
                <li>
                  Community accounts are labelled as unverified testimony. Coverage notes describe the sources
                  checked — never whether a place “has history”.
                </li>
                <li>
                  Retrieved text is treated as untrusted data, not as instructions, so content inside a record
                  cannot redirect the assistant.
                </li>
                <li>
                  There is no claim that Gemma knows the complete history of Lagos. Questions the records cannot
                  answer come back as insufficient evidence.
                </li>
              </ul>
            </div>
          </Reveal>

          {activePlace && (
            <Reveal delay={0.1}>
              <div className="card p-5">
                <p className="text-xs uppercase tracking-widest text-black/40">Focused place</p>
                <p className="mt-1 font-display text-lg tracking-tight">{activePlace.name}</p>
                <p className="mt-2 text-sm leading-relaxed text-black/60">{activePlace.summary}</p>
                {activePlace.knowledge && (
                  <p className="mt-3 text-xs leading-relaxed text-black/45">
                    {activePlace.knowledge.coveredDimensions} of {activePlace.knowledge.totalDimensions} dimensions
                    are covered by the checked sources.
                  </p>
                )}
              </div>
            </Reveal>
          )}
        </aside>
      </div>
    </div>
  );
}
