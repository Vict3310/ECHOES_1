import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';

/** Shared shell so both halves of the flow look like the rest of the app. */
function ResetShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-xl px-6 pt-32 sm:px-10 sm:pt-36">
      <div className="card p-8">
        <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">{eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink">{title}</h1>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<{ message: string; expiresInMinutes: number } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // The server answers identically for unknown addresses, so this page never
      // reveals whether an email is registered.
      setSent(await api.auth.requestPasswordReset({ email }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The request could not be sent.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <ResetShell eyebrow="Password reset" title="Check your inbox.">
        <div className="flex gap-3 rounded-2xl border border-black/10 bg-white/60 px-5 py-4 text-sm leading-relaxed text-black/65">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand-deep" aria-hidden="true" />
          <span>
            {sent.message} The link works once and expires in {sent.expiresInMinutes} minutes.
          </span>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-black/55">
          Nothing arrived? In development builds the message is written to the API log instead of being
          delivered by a provider, so check the server output. Otherwise request another link below.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="btn-secondary" onClick={() => setSent(null)}>
            Send another link
          </button>
          <Link to="/auth" className="btn-primary">
            Back to sign in
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </ResetShell>
    );
  }

  return (
    <ResetShell eyebrow="Password reset" title="Forgot your password?">
      <p className="text-sm leading-relaxed text-black/60">
        Enter the address you signed up with and a single-use link will be sent to it.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block">
          <span className="field-label">Email</span>
          <span className="relative mt-2 flex items-center">
            <Mail className="pointer-events-none absolute left-4 h-4 w-4 text-black/35" aria-hidden="true" />
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-black/10 bg-white/70 py-3 pl-11 pr-4 text-sm outline-none focus:border-brand-deep/40"
            />
          </span>
        </label>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
          {loading ? 'Please wait…' : 'Send reset link'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      <p className="mt-6 text-sm text-black/55">
        Remembered it?{' '}
        <Link to="/auth" className="text-brand-deep underline underline-offset-4">
          Sign in
        </Link>
        .
      </p>
    </ResetShell>
  );
}

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await api.auth.confirmPasswordReset({ token, password });
      setDone(result.message);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'The password could not be changed.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <ResetShell eyebrow="Password reset" title="This link is incomplete.">
        <p className="text-sm leading-relaxed text-black/60">
          The reset link is missing its token. Request a new one — links cannot be reused.
        </p>
        <Link to="/forgot-password" className="btn-primary mt-6 justify-center">
          Request a new link
          <ArrowRight className="h-4 w-4" />
        </Link>
      </ResetShell>
    );
  }

  if (done) {
    return (
      <ResetShell eyebrow="Password reset" title="Password changed.">
        <div className="flex gap-3 rounded-2xl border border-black/10 bg-white/60 px-5 py-4 text-sm leading-relaxed text-black/65">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-deep" aria-hidden="true" />
          <span>{done}</span>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-black/55">
          Any other reset link for this account has now been invalidated. Sessions that were already
          signed in elsewhere stay active until they expire.
        </p>
        <button type="button" className="btn-primary mt-6 justify-center" onClick={() => navigate('/auth')}>
          Go to sign in
          <ArrowRight className="h-4 w-4" />
        </button>
      </ResetShell>
    );
  }

  return (
    <ResetShell eyebrow="Password reset" title="Choose a new password.">
      <form onSubmit={handleSubmit} className="space-y-4">
        {[
          { label: 'New password', value: password, set: setPassword, autoComplete: 'new-password' },
          { label: 'Repeat password', value: confirm, set: setConfirm, autoComplete: 'new-password' },
        ].map((field) => (
          <label key={field.label} className="block">
            <span className="field-label">{field.label}</span>
            <span className="relative mt-2 flex items-center">
              <KeyRound className="pointer-events-none absolute left-4 h-4 w-4 text-black/35" aria-hidden="true" />
              <input
                type="password"
                required
                minLength={10}
                autoComplete={field.autoComplete}
                value={field.value}
                onChange={(event) => field.set(event.target.value)}
                className="w-full rounded-2xl border border-black/10 bg-white/70 py-3 pl-11 pr-4 text-sm outline-none focus:border-brand-deep/40"
              />
            </span>
          </label>
        ))}

        <p className="text-xs leading-relaxed text-black/45">Use at least 10 characters.</p>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
          {loading ? 'Please wait…' : 'Set new password'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>
    </ResetShell>
  );
}
