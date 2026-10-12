import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { clearStoredSession, readStoredSession, writeStoredSession } from '../lib/auth';

export default function Auth() {
  const session = readStoredSession();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [role, setRole] = useState<'visitor' | 'organizer'>('visitor');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedRole = params.get('role');
    if (requestedRole === 'organizer') {
      setMode('register');
      setRole('organizer');
    }
  }, [location.search]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (mode === 'register' && !consentChecked) {
      setError('Please confirm the details you have provided and that you have read the Privacy Policy and Terms & Conditions.');
      return;
    }

    setLoading(true);

    try {
      const result =
        mode === 'login'
          ? await api.auth.login({ email, password })
          : await api.auth.register({ name, email, password, role });

      writeStoredSession(result);
      navigate(result.user.role === 'organizer' ? '/guide-dashboard' : '/account');
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : 'Authentication failed.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function signOut() {
    clearStoredSession();
    window.location.href = '/auth';
  }

  if (session) {
    return (
      <div className="mx-auto max-w-4xl px-6 pt-32 sm:px-10">
        <div className="card p-8">
          <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Signed in</p>
          <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink">Welcome back, {session.user.name}</h1>
          <p className="mt-3 text-base text-black/60">{session.user.email}</p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-black/10 bg-[#f7f2eb] p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-black/40">Role</p>
              <p className="mt-2 font-display text-2xl tracking-tighter text-ink">{session.user.role}</p>
            </div>
            <div className="rounded-2xl border border-black/10 bg-[#f7f2eb] p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-black/40">Status</p>
              <p className="mt-2 font-display text-2xl tracking-tighter text-ink">Active</p>
            </div>
            <div className="rounded-2xl border border-black/10 bg-[#f7f2eb] p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-black/40">Access</p>
              <p className="mt-2 font-display text-2xl tracking-tighter text-ink">Ready</p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/account" className="btn-primary">
              View my trips
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/guide-dashboard" className="btn-secondary">
              Guide dashboard
            </Link>
            <button type="button" onClick={signOut} className="border border-black/10 px-4 py-2.5 text-sm font-medium text-ink">
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 pt-32 sm:px-10">
      <div className="card p-8 sm:p-10">
        <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">ECHOES access</p>
        <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink sm:text-5xl">
          {mode === 'login' ? 'Welcome back' : 'Create your travel account'}
        </h1>
        <p className="mt-3 text-base text-black/60">
          Access your saved trips, start planning routes, and manage your guide or guest profile.
        </p>

        <div className="mt-8 flex gap-2 rounded-full border border-black/10 bg-[#f7f2eb] p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium ${mode === 'login' ? 'bg-brand-deep text-white' : 'text-black/60'}`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium ${mode === 'register' ? 'bg-brand-deep text-white' : 'text-black/60'}`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          {mode === 'register' && (
            <>
              <label className="block">
                <span className="field-label">Full name</span>
                <span className="relative block">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/35" />
                  <input className="field-input pl-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Okafor" required />
                </span>
              </label>

              <label className="block">
                <span className="field-label">Account type</span>
                <select
                  className="field-input"
                  value={role}
                  onChange={(event) => setRole(event.target.value === 'organizer' ? 'organizer' : 'visitor')}
                >
                  <option value="visitor">Traveller</option>
                  <option value="organizer">Guide / organizer</option>
                </select>
              </label>
            </>
          )}

          <label className="block">
            <span className="field-label">Email</span>
            <span className="relative block">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/35" />
              <input className="field-input pl-10" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
            </span>
          </label>

          <label className="block">
            <span className="field-label">Password</span>
            <span className="relative block">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/35" />
              <input
                className="field-input pl-10 pr-12"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 10 characters"
                required
                minLength={10}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-3 flex items-center text-black/50 transition hover:text-black"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>

          {mode === 'register' && (
            <label className="flex items-start gap-3 rounded-2xl border border-black/10 bg-[#f7f2eb] p-3 text-sm leading-relaxed text-black/70">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(event) => setConsentChecked(event.target.checked)}
                required
                className="mt-1 h-4 w-4 rounded border-black/20 text-brand-deep focus:ring-brand-deep"
              />
              <span>
                I confirm the details I have provided are correct and that I have read the{' '}
                <Link to="/privacy" className="text-brand-deep underline underline-offset-4">
                  Privacy Policy
                </Link>{' '}
                and{' '}
                <Link to="/terms" className="text-brand-deep underline underline-offset-4">
                  Terms & Conditions
                </Link>.
              </span>
            </label>
          )}

          {mode === 'login' && (
            <p className="text-right text-xs text-black/50">
              <Link to="/forgot-password" className="text-brand-deep underline underline-offset-4">
                Forgot your password?
              </Link>
            </p>
          )}

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Login to ECHOES' : 'Create account'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
