import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Send, ShieldCheck } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { usePlaces } from '../lib/hooks';
import { Notice, SectionHeading } from '../components/ui';
import { Reveal } from '../components/layout';
import { track } from '../lib/tracker';

const ATTRIBUTION_OPTIONS = [
  {
    value: 'full_name',
    label: 'Show my name',
    detail: 'Your name is published with the account.',
  },
  {
    value: 'pseudonym',
    label: 'Use a pseudonym',
    detail: 'A name you choose is shown instead of your real one.',
  },
  {
    value: 'anonymous',
    label: 'Publish anonymously',
    detail: 'Nothing identifying you is shown. You can still receive the submission reference.',
  },
] as const;

export default function Contribute() {
  const [params] = useSearchParams();
  const { places } = usePlaces();

  useEffect(() => {
    track('story_submission_started');
  }, []);

  const [placeId, setPlaceId] = useState(params.get('place') ?? '');
  const [suggestedPlaceName, setSuggestedPlaceName] = useState('');
  const [body, setBody] = useState('');
  const [sourceContext, setSourceContext] = useState('');
  const [period, setPeriod] = useState('');
  const [attribution, setAttribution] = useState<'full_name' | 'pseudonym' | 'anonymous'>('pseudonym');
  const [contributorName, setContributorName] = useState('');
  const [contributorEmail, setContributorEmail] = useState('');
  const [consentPublication, setConsentPublication] = useState(false);
  const [consentTerms, setConsentTerms] = useState(false);
  const [sensitivity, setSensitivity] = useState<'standard' | 'sensitive' | 'restricted'>('standard');

  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [response, setResponse] = useState<{ message: string; reviewProcess: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Array<{ path: string; message: string }>>([]);

  const [statusReference, setStatusReference] = useState('');
  const [statusEmail, setStatusEmail] = useState('');
  const [statusResult, setStatusResult] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors([]);
    setSubmitting(true);

    try {
      const result = await api.submitStory({
        placeId: placeId || null,
        suggestedPlaceName: suggestedPlaceName.trim() || null,
        body: body.trim(),
        sourceContext: sourceContext.trim(),
        period: period.trim() || null,
        attribution,
        contributorName: attribution === 'anonymous' ? null : contributorName.trim() || null,
        contributorEmail: contributorEmail.trim() || null,
        consentPublication,
        consentTerms,
        sensitivity,
        mediaUrls: [],
      });
      setReference(result.reference);
      setResponse({ message: result.message, reviewProcess: result.reviewProcess });
      // The story's text is never sent here — only that a submission happened.
      track('story_submitted', { hasPlace: Boolean(placeId) }, placeId || null);
    } catch (submissionError) {
      if (submissionError instanceof ApiClientError) {
        setError(submissionError.message);
        if (Array.isArray(submissionError.details)) {
          setFieldErrors(submissionError.details as Array<{ path: string; message: string }>);
        }
      } else {
        setError('The contribution could not be submitted.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function checkStatus(event: React.FormEvent) {
    event.preventDefault();
    setStatusError(null);
    setStatusResult(null);
    try {
      const result = await api.storyStatus(statusReference.trim(), statusEmail.trim() || undefined);
      setStatusResult(
        `${result.reference} — status: ${result.status}${
          result.moderationNote ? ` · note from the reviewer: ${result.moderationNote}` : ''
        }${result.note ? ` · ${result.note}` : ''}`,
      );
    } catch (statusFailure) {
      setStatusError(
        statusFailure instanceof ApiClientError ? statusFailure.message : 'That reference could not be found.',
      );
    }
  }

  return (
    <div className="pt-32 sm:pt-40">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading
          eyebrow="Community preservation"
          title="Add the account the checked sources are"
          accent="missing."
          description="Submissions are reviewed by a moderator before anything is published. You choose how you are credited, and you can ask for a change or a removal at any time by quoting your reference."
        />
      </div>

      <div className="mx-auto mt-10 grid max-w-7xl grid-cols-1 gap-10 px-6 pb-24 sm:px-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {reference && response ? (
            <Reveal>
              <div className="card p-6">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-deep" aria-hidden="true" />
                  <div>
                    <p className="text-xs uppercase tracking-widest text-black/40">Submission reference</p>
                    <p className="font-display text-2xl tracking-tight">{reference}</p>
                    <p className="mt-3 text-sm leading-relaxed text-black/65">{response.message}</p>
                  </div>
                </div>

                <div className="mt-6">
                  <p className="mb-2 text-xs uppercase tracking-widest text-black/40">What happens next</p>
                  <ol className="space-y-2 text-sm text-black/60">
                    {response.reviewProcess.map((step, index) => (
                      <li key={step} className="flex gap-3">
                        <span className="text-xs text-black/35">{index + 1}</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="mt-6 rounded-2xl border border-black/10 bg-white/60 p-4">
                  <p className="text-sm text-black/60">
                    Keep your reference. Use the box on the right to check the moderation status at any time.
                  </p>
                </div>
              </div>
            </Reveal>
          ) : (
            <Reveal>
              <form onSubmit={submit} className="card space-y-6 p-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label>
                    <span className="field-label">Existing place</span>
                    <select
                      className="field-input"
                      value={placeId}
                      onChange={(event) => setPlaceId(event.target.value)}
                    >
                      <option value="">Not listed — I will suggest a place</option>
                      {places.map((place) => (
                        <option key={place.id} value={place.id}>
                          {place.name} — {place.neighbourhood}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="field-label">Or suggest a new place</span>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="Name of the place"
                      value={suggestedPlaceName}
                      onChange={(event) => setSuggestedPlaceName(event.target.value)}
                      maxLength={160}
                    />
                  </label>
                </div>

                <label>
                  <span className="field-label">Your account</span>
                  <textarea
                    rows={7}
                    className="field-input resize-none"
                    placeholder="Write the account in your own words — what happened here, who told you, and what it means to the community."
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    maxLength={6000}
                    required
                  />
                  <span className="mt-1 block text-xs text-black/40">
                    {body.trim().length}/6000 characters — at least 40 required.
                  </span>
                </label>

                <label>
                  <span className="field-label">Where does this account come from?</span>
                  <textarea
                    rows={3}
                    className="field-input resize-none"
                    placeholder="Family recollection, a local book, an interview, an archive… Reviewers need this to assess the submission."
                    value={sourceContext}
                    onChange={(event) => setSourceContext(event.target.value)}
                    maxLength={2000}
                    required
                  />
                </label>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label>
                    <span className="field-label">Period (optional)</span>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="e.g. 1950s, or “before 1990”"
                      value={period}
                      onChange={(event) => setPeriod(event.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <label>
                    <span className="field-label">Sensitivity</span>
                    <select
                      className="field-input"
                      value={sensitivity}
                      onChange={(event) =>
                        setSensitivity(event.target.value as 'standard' | 'sensitive' | 'restricted')
                      }
                    >
                      <option value="standard">Standard review</option>
                      <option value="sensitive">Sensitive — needs care</option>
                      <option value="restricted">Restricted — do not publish without an explicit review</option>
                    </select>
                  </label>
                </div>

                <fieldset>
                  <legend className="field-label">How should you be credited?</legend>
                  <div className="space-y-2">
                    {ATTRIBUTION_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors ${
                          attribution === option.value
                            ? 'border-brand-deep/40 bg-brand-soft/40'
                            : 'border-black/10 bg-white/60 hover:bg-black/[0.02]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="attribution"
                          value={option.value}
                          checked={attribution === option.value}
                          onChange={() => setAttribution(option.value)}
                          className="mt-1"
                        />
                        <span>
                          <span className="block text-ink">{option.label}</span>
                          <span className="block text-xs text-black/50">{option.detail}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {attribution !== 'anonymous' && (
                  <label>
                    <span className="field-label">
                      {attribution === 'pseudonym' ? 'Pseudonym to display' : 'Name to display'}
                    </span>
                    <input
                      type="text"
                      className="field-input"
                      value={contributorName}
                      onChange={(event) => setContributorName(event.target.value)}
                      maxLength={120}
                    />
                  </label>
                )}

                <label>
                  <span className="field-label">Email (optional — used to look up your submission)</span>
                  <input
                    type="email"
                    className="field-input"
                    value={contributorEmail}
                    onChange={(event) => setContributorEmail(event.target.value)}
                  />
                  <span className="mt-1 block text-xs text-black/40">
                    Only your name or pseudonym is ever displayed publicly.
                  </span>
                </label>

                <fieldset className="space-y-3">
                  <legend className="field-label">Consent</legend>
                  <label className="flex items-start gap-3 text-sm text-black/65">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={consentPublication}
                      onChange={(event) => setConsentPublication(event.target.checked)}
                      required
                    />
                    <span>
                      I agree that, if a moderator approves this submission, it may be published on ECHOES with the
                      attribution I chose above.
                    </span>
                  </label>
                  <label className="flex items-start gap-3 text-sm text-black/65">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={consentTerms}
                      onChange={(event) => setConsentTerms(event.target.checked)}
                      required
                    />
                    <span>
                      I understand ECHOES may store this account, display its moderation status, and that I can
                      request a correction or removal by quoting my reference.
                    </span>
                  </label>
                </fieldset>

                {error && (
                  <div className="rounded-2xl border border-[#B4432A]/25 bg-[#B4432A]/[0.06] px-4 py-3 text-sm text-[#7A2C1B]">
                    {error}
                    {fieldErrors.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {fieldErrors.map((fieldError) => (
                          <li key={`${fieldError.path}-${fieldError.message}`}>
                            <span className="font-medium">{fieldError.path}</span>: {fieldError.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <button type="submit" className="btn-primary w-full justify-center" disabled={submitting}>
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                  {submitting ? 'Submitting for review…' : 'Submit for review'}
                </button>
              </form>
            </Reveal>
          )}
        </div>

        <aside className="space-y-5 lg:col-span-5">
          <Reveal>
            <div className="card p-6">
              <h2 className="font-display text-xl tracking-tight">Check a submission</h2>
              <p className="mt-2 text-sm leading-relaxed text-black/55">
                Enter your reference to see the moderation status. Add the email you used to see the full detail.
              </p>
              <form className="mt-4 space-y-4" onSubmit={checkStatus}>
                <label>
                  <span className="field-label">Reference</span>
                  <input
                    type="text"
                    className="field-input"
                    placeholder="ECH-ST-XXXXXXXX"
                    value={statusReference}
                    onChange={(event) => setStatusReference(event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span className="field-label">Email used</span>
                  <input
                    type="email"
                    className="field-input"
                    value={statusEmail}
                    onChange={(event) => setStatusEmail(event.target.value)}
                  />
                </label>
                <button type="submit" className="btn-secondary w-full justify-center">
                  Check status
                </button>
              </form>
              {statusResult && (
                <div className="mt-4">
                  <Notice tone="brand">{statusResult}</Notice>
                </div>
              )}
              {statusError && (
                <div className="mt-4">
                  <Notice tone="warn">{statusError}</Notice>
                </div>
              )}
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="card p-6">
              <h2 className="font-display text-xl tracking-tight">What ECHOES will and will not do</h2>
              <ul className="mt-3 space-y-3 text-sm leading-relaxed text-black/60">
                <li>• Nothing is published automatically. Every submission is reviewed by a person first.</li>
                <li>
                  • Sensitive and restricted material is not published through the standard moderation path — places
                  such as Makoko and heritage sites around the slave trade are routed to the sensitive-content review.
                </li>
                <li>• Anonymous contributions keep your name and email private; only the account is shown.</li>
                <li>
                  • AI is never used to declare a community account historically verified. A plausible-sounding story
                  is not evidence.
                </li>
                <li>
                  • Missing information in a database is never treated as proof that a place or community lacks its
                  own history.
                </li>
              </ul>
            </div>
          </Reveal>
        </aside>
      </div>
    </div>
  );
}
