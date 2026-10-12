import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { resetRepository } from '../src/repo';

const app = createApp();
const ADMIN = { 'x-admin-token': 'test-admin-token' };

beforeEach(() => {
  // Fresh in-memory store per test, and no outbound network calls.
  resetRepository();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('outbound network is disabled in tests');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('service surface', () => {
  it('describes itself at the root', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('ECHOES API');
    expect(res.body.primaryModel).toBe('Gemma');
  });

  it('reports integration status without leaking credentials', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.store).toBe('memory');
    expect(res.body.data.integrations.gemma.primaryModel).toBe('Gemma');
    expect(res.body.data.integrations.gemma.configured).toBe(false);
    // Only the NAMES of missing variables are reported — never their values.
    expect(res.body.data.integrations.gemma).not.toHaveProperty('googleApiKey');
    expect(res.body.data.integrations.alatpay).not.toHaveProperty('secretKey');
    expect(res.body.data.integrations.alatpay.missing).toContain('ALATPAY_SECRET_KEY');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|Bearer\s|\b(sk|pk)_[A-Za-z0-9]/);
  });
});

describe('place discovery', () => {
  it('lists curated places with provenance and explainable coverage', async () => {
    const res = await request(app).get('/api/places');
    expect(res.status).toBe(200);
    expect(res.body.data.places.length).toBeGreaterThanOrEqual(12);
    const first = res.body.data.places[0];
    expect(first.sources.length).toBeGreaterThan(0);
    expect(first.sources[0].url).toMatch(/^https?:\/\//);
    expect(first.knowledge.totalDimensions).toBeGreaterThanOrEqual(7);
    expect(res.body.data.disclaimer).toMatch(/not evidence that a place lacks history/i);
  });

  it('filters by category and by research need', async () => {
    const museums = await request(app).get('/api/places?category=museum');
    expect(museums.body.data.places.length).toBeGreaterThan(0);
    for (const place of museums.body.data.places) expect(place.category).toBe('museum');

    const research = await request(app).get('/api/places?needsResearch=true');
    for (const place of research.body.data.places) {
      expect(place.knowledge.needsResearch).toBe(true);
    }
  });

  it('searches by keyword and neighbourhood', async () => {
    const search = await request(app).get('/api/places?q=afrobeat');
    expect(search.body.data.places.length).toBeGreaterThan(0);

    const hood = await request(app).get('/api/places?neighbourhood=Badagry');
    expect(hood.body.data.places.length).toBeGreaterThan(0);
    for (const place of hood.body.data.places) expect(place.neighbourhood).toBe('Badagry');
  });

  it('returns categories derived from real records', async () => {
    const res = await request(app).get('/api/places/categories');
    const total = res.body.data.categories.reduce((sum: number, c: { count: number }) => sum + c.count, 0);
    const all = await request(app).get('/api/places');
    expect(total).toBe(all.body.data.places.length);
  });

  it('returns nearby places with distances', async () => {
    const res = await request(app).get('/api/places/nearby?lat=6.4505&lng=3.3953&radiusKm=4');
    expect(res.status).toBe(200);
    const ids = res.body.data.places.map((p: { id: string }) => p.id);
    expect(ids).toContain('freedom-park-lagos');
    for (const place of res.body.data.places) {
      expect(place.distanceKm).toBeLessThanOrEqual(4);
    }
  });

  it('serves a full place profile with nearby links and sources', async () => {
    const res = await request(app).get('/api/places/freedom-park-lagos');
    expect(res.status).toBe(200);
    expect(res.body.data.place.name).toBe('Freedom Park Lagos');
    expect(res.body.data.nearby.length).toBeGreaterThan(0);
    expect(res.body.data.place.knowledge.gaps.length).toBeGreaterThan(0);
    expect(res.body.data.sourcesChecked.length).toBeGreaterThan(0);
  });

  it('404s on an unknown place', async () => {
    const res = await request(app).get('/api/places/not-a-place');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('community contributions', () => {
  const submission = {
    placeId: 'freedom-park-lagos',
    body: 'A family account of the Broad Street Prison grounds, told to me by relatives who lived nearby during that period.',
    sourceContext: 'Family oral account recorded in 2019.',
    period: '1960s',
    attribution: 'pseudonym',
    contributorName: 'Island resident',
    contributorEmail: 'resident@example.com',
    consentPublication: true,
    consentTerms: true,
    mediaUrls: [],
  };

  it('rejects a submission without publication consent', async () => {
    const res = await request(app)
      .post('/api/stories')
      .send({ ...submission, consentPublication: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('rejects input that is too short or missing a source context', async () => {
    const res = await request(app).post('/api/stories').send({ ...submission, body: 'too short', sourceContext: '' });
    expect(res.status).toBe(400);
  });

  it('accepts a valid submission and does not publish it immediately', async () => {
    const created = await request(app).post('/api/stories').send(submission);
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('pending');
    expect(created.body.data.reference).toMatch(/^ECH-ST-/);

    const published = await request(app).get('/api/places/freedom-park-lagos/stories');
    expect(published.body.data.stories).toHaveLength(0);

    const place = await request(app).get('/api/places/freedom-park-lagos');
    expect(place.body.data.place.knowledge.statuses.communityStory).toBe('awaiting_review');
  });

  it('protects the moderation queue and publishes only after approval', async () => {
    await request(app).post('/api/stories').send(submission);

    const forbidden = await request(app).get('/api/admin/stories?status=pending');
    expect(forbidden.status).toBe(403);

    const queue = await request(app).get('/api/admin/stories?status=pending').set(ADMIN);
    expect(queue.status).toBe(200);
    const storyId = queue.body.data.stories[0].id;

    const approved = await request(app)
      .post(`/api/admin/stories/${storyId}/moderate`)
      .set(ADMIN)
      .send({ status: 'approved', moderationNote: 'Published as community testimony.' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.story.status).toBe('approved');
    expect(approved.body.data.story.reviewedBy).toBe('admin-token');

    const published = await request(app).get('/api/places/freedom-park-lagos/stories');
    expect(published.body.data.stories).toHaveLength(1);
    expect(published.body.data.stories[0].contributor).toBe('Island resident');
    expect(published.body.data.notice).toMatch(/not historically verified fact/i);

    const place = await request(app).get('/api/places/freedom-park-lagos');
    expect(place.body.data.place.knowledge.statuses.communityStory).toBe('available');
  });

  it('hides the body of a submission from anyone who does not own it', async () => {
    const created = await request(app).post('/api/stories').send(submission);
    const reference = created.body.data.reference;

    const stranger = await request(app).get(`/api/stories/${reference}`);
    expect(stranger.status).toBe(200);
    expect(stranger.body.data).not.toHaveProperty('body');

    const owner = await request(app).get(`/api/stories/${reference}?email=resident@example.com`);
    expect(owner.body.data.body).toMatch(/Broad Street Prison/);
  });

  it('refuses to approve sensitive content through the standard path', async () => {
    const created = await request(app)
      .post('/api/stories')
      .send({ ...submission, placeId: 'makoko', sensitivity: 'sensitive' });
    expect(created.status).toBe(201);

    const queue = await request(app).get('/api/admin/stories?status=pending').set(ADMIN);
    const storyId = queue.body.data.stories[0].id;
    const res = await request(app)
      .post(`/api/admin/stories/${storyId}/moderate`)
      .set(ADMIN)
      .send({ status: 'approved' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/sensitive or restricted/i);
  });
});

describe('bookings and payments', () => {
  const booking = {
    experienceId: 'sample-afrobeat-walk',
    scheduleId: 'sun-1500',
    participants: 2,
    customerName: 'Ada Obi',
    customerEmail: 'ada@example.com',
  };

  it('reports the catalog as sample data that cannot be sold as genuine', async () => {
    const res = await request(app).get('/api/experiences');
    expect(res.status).toBe(200);
    for (const experience of res.body.data.experiences) {
      expect(experience.isSampleData).toBe(true);
    }
    expect(res.body.data.notice).toMatch(/cannot be sold/i);
  });

  it('refuses to oversell a sold-out date', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ ...booking, scheduleId: 'sat-1600' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('rejects an invalid booking payload', async () => {
    const res = await request(app).post('/api/bookings').send({ ...booking, participants: 0 });
    expect(res.status).toBe(400);
  });

  it('creates a booking, issues a checkout and confirms it only after verification', async () => {
    const created = await request(app).post('/api/bookings').send(booking);
    expect(created.status).toBe(201);
    expect(created.body.data.booking.status).toBe('pending_payment');
    expect(created.body.data.booking.totalMinor).toBe(3_000_000);
    expect(created.body.data.payment.mode).toBe('simulated');
    expect(created.body.data.next).toMatch(/SIMULATED/);

    const reference = created.body.data.payment.reference;

    const confirmed = await request(app)
      .post(`/api/payments/simulate/${reference}`)
      .send({ outcome: 'successful' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.verified).toBe(true);
    expect(confirmed.body.data.booking.status).toBe('confirmed');
    expect(confirmed.body.data.warning).toMatch(/No real transaction/i);

    const lookup = await request(app).get(
      `/api/bookings/${created.body.data.booking.reference}?email=ada@example.com`,
    );
    expect(lookup.status).toBe(200);
    expect(lookup.body.data.booking.status).toBe('confirmed');
  });

  it('refuses to confirm a simulated amount mismatch', async () => {
    const created = await request(app).post('/api/bookings').send(booking);
    const reference = created.body.data.payment.reference;
    const res = await request(app)
      .post(`/api/payments/simulate/${reference}`)
      .send({ outcome: 'amount_mismatch' });
    expect(res.body.data.verified).toBe(false);
    expect(res.body.data.reason).toBe('amount_mismatch');
    expect(res.body.data.booking.status).toBe('pending_payment');
  });

  it('refuses to confirm a simulated currency mismatch', async () => {
    const created = await request(app).post('/api/bookings').send(booking);
    const res = await request(app)
      .post(`/api/payments/simulate/${created.body.data.payment.reference}`)
      .send({ outcome: 'currency_mismatch' });
    expect(res.body.data.reason).toBe('currency_mismatch');
    expect(res.body.data.booking.status).toBe('pending_payment');
  });

  it('is idempotent across repeated callbacks', async () => {
    const created = await request(app).post('/api/bookings').send(booking);
    const reference = created.body.data.payment.reference;
    const first = await request(app).post(`/api/payments/simulate/${reference}`).send({ outcome: 'successful' });
    const second = await request(app).post(`/api/payments/simulate/${reference}`).send({ outcome: 'successful' });
    expect(first.body.data.booking.status).toBe('confirmed');
    expect(second.body.data.booking.status).toBe('confirmed');
  });

  it('refuses to serve verification when merchant credentials are absent', async () => {
    const created = await request(app).post('/api/bookings').send(booking);
    const reference = created.body.data.payment.reference;
    const res = await request(app).get(`/api/payments/verify/${reference}`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('alatpay_not_configured');
    expect(res.body.error.details.missing).toContain('ALATPAY_SECRET_KEY');
    expect(res.body.error.details.missing).toContain('ALATPAY_SECRET_KEY');
  });

  it('rejects an unsigned payment webhook', async () => {
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ reference: 'ECH-PAY-X', status: 'successful' }));
    expect([403, 503]).toContain(res.status);
  });

  it('requires the booking owner’s email to read a booking', async () => {
    const created = await request(app).post('/api/bookings').send(booking);
    const res = await request(app).get(
      `/api/bookings/${created.body.data.booking.reference}?email=someone.else@example.com`,
    );
    expect(res.status).toBe(403);
  });

  it('shows all bookings to organizers while travellers only see their own', async () => {
    const organizer = await request(app).post('/api/auth/register').send({
      email: 'organizer@example.com',
      name: 'Guide Lead',
      password: 'supersecretpass',
      role: 'organizer',
    });
    const traveller = await request(app).post('/api/auth/register').send({
      email: 'traveller@example.com',
      name: 'Tourist Person',
      password: 'supersecretpass',
      role: 'visitor',
    });

    await request(app).post('/api/bookings').send({ ...booking, customerEmail: 'ada@example.com' });
    await request(app).post('/api/bookings').send({
      ...booking,
      customerEmail: 'travel@example.com',
      participants: 1,
      customerName: 'Zoey M',
    });

    const organizerList = await request(app)
      .get('/api/bookings')
      .set('Cookie', `echoes_session=${organizer.body.data.token}`);

    const travellerList = await request(app)
      .get('/api/bookings')
      .set('Cookie', `echoes_session=${traveller.body.data.token}`);

    expect(organizerList.status).toBe(200);
    expect(organizerList.body.data.bookings.length).toBeGreaterThanOrEqual(2);
    expect(travellerList.status).toBe(200);
    expect(travellerList.body.data.bookings.every((entry: { customerEmail: string }) => entry.customerEmail === 'traveller@example.com')).toBe(true);
  });
});

describe('guide approvals', () => {
  it('keeps newly submitted guide profiles pending until review', async () => {
    const organizer = await request(app).post('/api/auth/register').send({
      email: 'guide-owner@example.com',
      name: 'Nneka Guide',
      password: 'supersecretpass',
      role: 'organizer',
    });

    const created = await request(app)
      .post('/api/guides')
      .set('Cookie', `echoes_session=${organizer.body.data.token}`)
      .send({
        name: 'Nneka Guide',
        role: 'Heritage storyteller',
        city: 'Lagos Island',
        specialties: ['History', 'Food tours'],
        bio: 'I host slow, story-led neighbourhood walks through the old city and market routes.',
        availability: 'Fri-Sun',
        priceFrom: '₦18,000',
      });

    expect(created.status).toBe(201);
    expect(created.body.data.guide.status).toBe('pending');

    const publicList = await request(app).get('/api/guides');
    expect(publicList.body.data.guides.find((guide: { id: string }) => guide.id === created.body.data.guide.id)).toBeUndefined();

    const queue = await request(app).get('/api/admin/guides?status=pending').set(ADMIN);
    expect(queue.status).toBe(200);
    expect(queue.body.data.guides.some((guide: { id: string }) => guide.id === created.body.data.guide.id)).toBe(true);
  });

  it('approves a reviewed guide and makes it public', async () => {
    const organizer = await request(app).post('/api/auth/register').send({
      email: 'guide-owner-2@example.com',
      name: 'Olumide Story',
      password: 'supersecretpass',
      role: 'organizer',
    });

    const created = await request(app)
      .post('/api/guides')
      .set('Cookie', `echoes_session=${organizer.body.data.token}`)
      .send({
        name: 'Olumide Story',
        role: 'Culture guide',
        city: 'Yaba',
        specialties: ['Art', 'Film'],
        bio: 'I connect travellers to short, thoughtful cultural walks across the city and local creative spaces.',
        availability: 'Wed-Mon',
        priceFrom: '₦16,000',
      });

    const queue = await request(app).get('/api/admin/guides?status=pending').set(ADMIN);
    const guide = queue.body.data.guides.find((item: { id: string }) => item.id === created.body.data.guide.id);

    const approved = await request(app)
      .post(`/api/admin/guides/${guide.id}/moderate`)
      .set(ADMIN)
      .send({ status: 'approved', moderationNote: 'Profile is complete and fits the community standard.' });

    expect(approved.status).toBe(200);
    expect(approved.body.data.guide.status).toBe('approved');

    const publicList = await request(app).get('/api/guides');
    expect(publicList.body.data.guides.some((item: { id: string }) => item.id === guide.id)).toBe(true);
  });
});

describe('AI and routing surfaces', () => {
  it('answers from records with citations when no model is configured', async () => {
    const res = await request(app)
      .post('/api/ai/answer')
      .send({ question: 'What makes Freedom Park historically important?', placeId: 'freedom-park-lagos' });
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('retrieval-only');
    expect(res.body.data.citations.length).toBeGreaterThan(0);
    expect(res.body.data.citations.some((c: { url?: string }) => Boolean(c.url))).toBe(true);
    expect(res.body.data.limitations.join(' ')).toMatch(/no language model|Gemma is not available/i);
  });

  it('rejects a question that is too short', async () => {
    const res = await request(app).post('/api/ai/answer').send({ question: 'hi' });
    expect(res.status).toBe(400);
  });

  it('produces a narration script from stored records without a TTS provider', async () => {
    const res = await request(app).post('/api/ai/narration').send({ placeId: 'kalakuta-museum' });
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('records');
    expect(res.body.data.script).toMatch(/Kalakuta/i);
    expect(res.body.data.audio.provider).toBe('browser-speech-synthesis');
  });

  it('reports routing failure honestly instead of fabricating a route', async () => {
    const res = await request(app)
      .post('/api/directions')
      .send({ from: { lat: 6.45, lng: 3.39 }, to: { lat: 6.47, lng: 3.37 }, mode: 'walking' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('routing_unavailable');
  });

  it('plans an itinerary with no travel estimate when routing is unavailable', async () => {
    const res = await request(app).post('/api/itineraries/plan').send({
      start: { lat: 6.4505, lng: 3.3953, label: 'Freedom Park' },
      interests: ['history', 'museum'],
      availableMinutes: 180,
      transportMode: 'walking',
      maxStops: 3,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.stops.length).toBeGreaterThan(0);
    expect(res.body.data.totals.distanceMeters).toBeNull();
    expect(res.body.data.limitations.join(' ')).toMatch(/could not be calculated/i);
    expect(res.body.data.notes.liveTraffic).toMatch(/do not include live traffic/i);
  });

  it('validates itinerary preferences', async () => {
    const res = await request(app).post('/api/itineraries/plan').send({ interests: [] });
    expect(res.status).toBe(400);
  });
});

describe('administration', () => {
  it('refuses admin access without a token', async () => {
    const res = await request(app).get('/api/admin/overview');
    expect(res.status).toBe(403);
  });

  it('refuses admin access with a wrong token', async () => {
    const res = await request(app).get('/api/admin/overview').set({ 'x-admin-token': 'nope' });
    expect(res.status).toBe(403);
  });

  it('exposes moderation, payment reconciliation and data-quality views', async () => {
    const overview = await request(app).get('/api/admin/overview').set(ADMIN);
    expect(overview.status).toBe(200);
    expect(overview.body.data.counts.places).toBeGreaterThanOrEqual(12);
    expect(overview.body.data.counts.probableDuplicates).toBe(0);

    const quality = await request(app).get('/api/admin/data-quality').set(ADMIN);
    expect(quality.status).toBe(200);
    expect(quality.body.data.places.length).toBeGreaterThan(0);
    expect(quality.body.data.duplicatePolicy).toMatch(/never merges/i);

    const payments = await request(app).get('/api/admin/payments').set(ADMIN);
    expect(payments.status).toBe(200);
    expect(payments.body.data.provider.configured).toBe(false);

    const audit = await request(app).get('/api/admin/audit').set(ADMIN);
    expect(audit.status).toBe(200);
    expect(Array.isArray(audit.body.data.audit)).toBe(true);
  });
});

describe('unmatched routes', () => {
  it('returns a structured 404', async () => {
    const res = await request(app).get('/api/definitely-not-here');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
