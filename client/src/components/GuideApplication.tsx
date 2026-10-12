import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Loader2, Send, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Guide application.
 *
 * The photo is uploaded first, through the API's own endpoint, and only the path
 * it returns is submitted with the application — the server verifies the bytes and
 * refuses any other path shape. The application then stays pending until a
 * moderator reviews it, which the copy says plainly rather than implying instant
 * publication.
 */
export function GuideApplication({ token, defaultName }: { token: string; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [role, setRole] = useState('');
  const [city, setCity] = useState('Lagos');
  const [specialties, setSpecialties] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const stored = await api.uploads.image(file, token);
      setAvatarUrl(stored.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The photo could not be uploaded.');
    } finally {
      setUploading(false);
      // Let the same file be re-picked after a rejection.
      event.target.value = '';
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!consentChecked) {
      setError('Please confirm the details you have provided and that you have read the Privacy Policy and Terms & Conditions.');
      return;
    }

    setSubmitting(true);
    try {
      await api.applyAsGuide(token, {
        name,
        role,
        city,
        specialties: specialties
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 6),
        bio,
        avatarUrl,
      });
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The application could not be sent.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="card p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Application received</p>
        <h2 className="mt-3 font-display text-3xl tracking-tighter text-ink">
          Your profile is waiting for review.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-black/60">
          Nothing is published yet. A moderator reviews the application first, and the profile appears in
          the guide marketplace only after it is approved.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card p-6 sm:p-8">
      <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Guide application</p>
      <h2 className="mt-3 font-display text-3xl tracking-tighter text-ink">Offer a cultural experience</h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-black/60">
        Applications are reviewed before publication. Coordinates, prices and claims made in your profile
        are not verified by ECHOES — travellers see what you write.
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Your name</span>
          <input className="field-input mt-2" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <label className="block">
          <span className="field-label">What you guide</span>
          <input
            className="field-input mt-2"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Heritage storyteller"
            required
            minLength={2}
          />
        </label>
        <label className="block">
          <span className="field-label">City</span>
          <input className="field-input mt-2" value={city} onChange={(e) => setCity(e.target.value)} required minLength={2} />
        </label>
        <label className="block">
          <span className="field-label">Specialties (comma separated, up to 6)</span>
          <input
            className="field-input mt-2"
            value={specialties}
            onChange={(e) => setSpecialties(e.target.value)}
            placeholder="Colonial history, Food routes"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="field-label">About your work</span>
          <textarea
            className="field-input mt-2 min-h-[120px]"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="What travellers should expect, and what you know best."
            required
            minLength={20}
            maxLength={800}
          />
        </label>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <label className="btn-secondary cursor-pointer">
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Camera className="h-4 w-4" aria-hidden="true" />
          )}
          {uploading ? 'Uploading…' : avatarUrl ? 'Replace photo' : 'Add a photo'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="sr-only"
            onChange={handleFile}
            disabled={uploading}
          />
        </label>

        {avatarUrl && (
          <span className="flex items-center gap-3">
            <img
              src={avatarUrl}
              alt="Your uploaded photo"
              className="h-14 w-14 rounded-2xl object-cover"
            />
            <span className="text-xs text-black/50">
              Stored by this server. Its type was checked from the file&apos;s own bytes.
            </span>
          </span>
        )}
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-black/50">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Uploaded photos are served back from this API under <code>/uploads</code>. Never upload an image
        you do not have the right to publish.
      </p>

      <label className="mt-6 flex items-start gap-3 rounded-2xl border border-black/10 bg-[#f7f2eb] p-3 text-sm leading-relaxed text-black/70">
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

      {error && (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary mt-6" disabled={submitting || uploading || !consentChecked}>
        {submitting ? 'Sending…' : 'Submit for review'}
        <Send className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}
