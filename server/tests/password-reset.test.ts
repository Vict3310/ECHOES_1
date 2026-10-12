import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { createRepository, resetRepository } from '../src/repo';

/**
 * The mailer is mocked so the flow can be asserted through the message a real
 * recipient would receive — including the link — rather than through internals.
 * The service's own behaviour (log transport, refusal to send without a
 * recipient) is covered separately in email.test.ts.
 */
const sent: Array<{ to: string; subject: string; text: string }> = [];

vi.mock('../src/services/email', () => ({
  sendMail: vi.fn(async (message: { to: string; subject: string; text: string }) => {
    sent.push(message);
    return { accepted: true, delivered: false, transport: 'log' as const, sandbox: false };
  }),
  emailStatus: () => ({
    transport: 'log' as const,
    from: 'test@example.org',
    configured: true,
    sandbox: false,
    missing: [],
  }),
}));

const app = createApp();

function tokenFromLastEmail(): string {
  const message = sent.at(-1);
  expect(message, 'no email was sent').toBeDefined();
  const match = /token=([A-Za-z0-9_-]+)/.exec(message!.text);
  expect(match, 'the email contained no reset link').not.toBeNull();
  return match![1]!;
}

const credentials = { email: 'ada@example.com', name: 'Ada', password: 'original-password-1' };

async function registerAndReset(): Promise<string> {
  await request(app).post('/api/auth/register').send(credentials).expect(201);
  await request(app).post('/api/auth/password-reset/request').send({ email: credentials.email }).expect(200);
  return tokenFromLastEmail();
}

beforeEach(() => {
  sent.length = 0;
  resetRepository();
});

describe('password reset', () => {
  it('sends a single-use link and accepts it once', async () => {
    const token = await registerAndReset();
    expect(sent.at(-1)?.to).toBe(credentials.email);

    const changed = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ token, password: 'replacement-password-2' });
    expect(changed.status).toBe(200);

    // The new password works...
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: 'replacement-password-2' });
    expect(login.status).toBe(200);

    // ...the old one does not...
    const old = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    expect(old.status).toBe(401);

    // ...and the link cannot be replayed.
    const replay = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ token, password: 'another-password-3' });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('reset_token_used');
  });

  it('invalidates other outstanding links once a new password is set', async () => {
    await request(app).post('/api/auth/register').send(credentials).expect(201);

    await request(app).post('/api/auth/password-reset/request').send({ email: credentials.email }).expect(200);
    const first = tokenFromLastEmail();
    await request(app).post('/api/auth/password-reset/request').send({ email: credentials.email }).expect(200);
    const second = tokenFromLastEmail();
    expect(second).not.toBe(first);

    await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ token: second, password: 'chosen-password-9' })
      .expect(200);

    const stale = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ token: first, password: 'sneaky-password-9' });
    expect(stale.status).toBe(400);
    expect(stale.body.error.code).toBe('reset_token_used');
  });

  it('never reveals whether an address has an account', async () => {
    const unknown = await request(app)
      .post('/api/auth/password-reset/request')
      .send({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(200);

    await request(app).post('/api/auth/register').send(credentials).expect(201);
    const known = await request(app)
      .post('/api/auth/password-reset/request')
      .send({ email: credentials.email });
    expect(known.status).toBe(200);

    // Same shape, same wording, and nothing sent to the unknown address.
    expect(unknown.body.data.message).toBe(known.body.data.message);
    expect(sent.map((message) => message.to)).toEqual([credentials.email]);
  });

  it('rejects unknown, malformed and weak reset attempts', async () => {
    const unknownToken = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ token: 'x'.repeat(32), password: 'long-enough-password' });
    expect(unknownToken.status).toBe(400);
    expect(unknownToken.body.error.code).toBe('invalid_reset_token');

    const token = await registerAndReset();
    const weak = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ token, password: 'short' });
    expect(weak.status).toBe(400);
  });

  it('stores only a hash of the token, never the token itself', async () => {
    const token = await registerAndReset();
    const repo = createRepository();

    // Looking up by the token's hash is the contract; the raw token is absent.
    const stored = await repo.getPasswordReset(createHash('sha256').update(token).digest('hex'));
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('expires a link that is too old to use', async () => {
    const token = await registerAndReset();

    // Age the stored record rather than waiting an hour for it to expire.
    const repo = createRepository();
    const stored = await repo.getPasswordReset(createHash('sha256').update(token).digest('hex'));
    expect(stored).not.toBeNull();
    stored!.expiresAt = new Date(Date.now() - 60_000).toISOString();

    const expired = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ token, password: 'too-late-password-1' });
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('reset_token_expired');
  });
});
