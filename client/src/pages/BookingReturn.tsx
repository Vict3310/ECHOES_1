import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { Notice, SectionHeading } from '../components/ui';

interface VerifyOutcome {
  verified: boolean;
  reason: string;
  message: string;
  booking: { reference: string; status: string };
}

export default function BookingReturn() {
  const [params] = useSearchParams();
  const reference = params.get('reference') ?? '';
  const email = params.get('email') ?? '';

  const [state, setState] = useState<'idle' | 'verifying' | 'done' | 'unavailable'>('idle');
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [simulating, setSimulating] = useState<string | null>(null);

  async function verify() {
    if (!reference) return;
    setState('verifying');
    setMessage(null);
    try {
      const result = await api.verifyPayment(reference);
      setOutcome(result);
      setState('done');
    } catch (error) {
      if (error instanceof ApiClientError) {
        setMessage(error.message);
        const details = error.details as { missing?: string[] } | undefined;
        setMissing(details?.missing ?? []);
      } else {
        setMessage('The payment could not be verified.');
      }
      setState('unavailable');
    }
  }

  useEffect(() => {
    if (reference) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);

  async function simulate(outcomeCode: string) {
    setSimulating(outcomeCode);
    setMessage(null);
    try {
      const result = await api.simulatePayment(reference, outcomeCode);
      setOutcome({
        verified: result.verified,
        reason: result.reason,
        message: `${result.message} (simulated)`,
        booking: result.booking,
      });
      setState('done');
    } catch (error) {
      setMessage(
        error instanceof ApiClientError ? error.message : 'The simulated checkout could not be applied.',
      );
    } finally {
      setSimulating(null);
    }
  }

  if (!reference) {
    return (
      <div className="mx-auto max-w-3xl px-6 pt-40 sm:px-10">
        <Notice tone="warn" title="No payment reference">
          This page expects an ALATPay callback with a <code>reference</code> query parameter.{' '}
          <Link to="/experiences" className="underline">
            Back to experiences
          </Link>
          .
        </Notice>
      </div>
    );
  }

  return (
    <div className="pt-32 sm:pt-40">
      <div className="mx-auto max-w-4xl px-6 pb-24 sm:px-10">
        <SectionHeading
          eyebrow="Payment verification"
          title="Confirming your booking with the"
          accent="payment provider."
          description="Nothing is confirmed because a page said so. The server queries the provider and checks the reference, amount and currency against the booking before changing its status."
        />

        <div className="mt-10 space-y-5">
          <div className="card p-6">
            <p className="text-xs uppercase tracking-widest text-black/40">Payment reference</p>
            <p className="font-mono text-lg">{reference}</p>

            {state === 'verifying' && (
              <div className="mt-5 flex items-center gap-3 text-sm text-black/60">
                <Loader2 className="h-4 w-4 animate-spin text-brand-deep" aria-hidden="true" />
                Asking the server to verify this transaction…
              </div>
            )}

            {outcome && (
              <div className="mt-5">
                <div
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-4 text-sm ${
                    outcome.verified
                      ? 'border-brand-deep/20 bg-brand-soft/60 text-brand-deep'
                      : 'border-[#B4432A]/25 bg-[#B4432A]/[0.06] text-[#7A2C1B]'
                  }`}
                  role="status"
                >
                  {outcome.verified ? (
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <div>
                    <p className="font-medium">
                      {outcome.verified ? 'Payment verified — booking confirmed' : 'Not confirmed'}
                    </p>
                    <p className="mt-1 leading-relaxed">{outcome.message}</p>
                    <p className="mt-2 text-xs">
                      Booking {outcome.booking.reference} · status {outcome.booking.status} · reason{' '}
                      {outcome.reason}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {state === 'unavailable' && (
              <div className="mt-5 space-y-4">
                <Notice tone="warn" title="Provider verification is not available">
                  {message}
                  {missing.length > 0 && (
                    <>
                      {' '}
                      Missing configuration: <span className="font-mono text-xs">{missing.join(', ')}</span>.
                    </>
                  )}{' '}
                  The booking status has not been changed.
                </Notice>

                <div className="rounded-2xl border border-black/10 bg-white/60 p-5">
                  <p className="text-xs uppercase tracking-widest text-black/40">Development simulation</p>
                  <p className="mt-2 text-sm leading-relaxed text-black/60">
                    Because no merchant credentials are configured, the checkout for this reference can be simulated
                    so the verification rules can be observed. Simulated outcomes never touch real money and are
                    labelled everywhere.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {[
                      { code: 'successful', label: 'Successful payment' },
                      { code: 'pending', label: 'Still pending' },
                      { code: 'failed', label: 'Failed payment' },
                      { code: 'cancelled', label: 'Cancelled payment' },
                      { code: 'amount_mismatch', label: 'Amount mismatch' },
                      { code: 'currency_mismatch', label: 'Currency mismatch' },
                    ].map((option) => (
                      <button
                        key={option.code}
                        type="button"
                        className="btn-secondary"
                        disabled={simulating !== null}
                        onClick={() => void simulate(option.code)}
                      >
                        {simulating === option.code && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        )}
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" className="btn-secondary" onClick={() => void verify()}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Re-check with the server
              </button>
              {email && (
                <Link
                  to={`/experiences/booking/return?reference=${encodeURIComponent(reference)}&email=${encodeURIComponent(email)}`}
                  className="btn-secondary"
                  onClick={(event) => event.preventDefault()}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Booking owner: {email}
                </Link>
              )}
              <Link to="/experiences" className="btn-secondary">
                Back to experiences
              </Link>
            </div>
          </div>

          <Notice>
            Webhook processing is idempotent: replaying the same callback cannot confirm a booking twice, cannot
            revive a cancelled booking, and cannot downgrade a confirmed one.
          </Notice>
        </div>
      </div>
    </div>
  );
}
