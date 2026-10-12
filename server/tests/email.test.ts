import { afterEach, describe, expect, it, vi } from 'vitest';
import { emailStatus, sendMail } from '../src/services/email';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('outbound email', () => {
  it('refuses to send without a recipient instead of reporting success', async () => {
    const result = await sendMail({ to: '   ', subject: 'x', text: 'y' });
    expect(result.accepted).toBe(false);
    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/no recipient/i);
  });

  it('uses the development transport without touching the network', async () => {
    // Tests run with MAIL_TRANSPORT=log, so a provider call here would be a bug.
    const fetchSpy = vi.fn(async () => {
      throw new Error('outbound network is disabled in tests');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await sendMail({
      to: 'ada@example.com',
      subject: 'Reset your ECHOES password',
      text: 'open https://example.org/reset-password?token=abc',
    });

    expect(result.accepted).toBe(true);
    expect(result.transport).toBe('log');
    expect(fetchSpy).not.toHaveBeenCalled();
    // Written to a log is not delivered to a person, and must not be reported as if
    // it were — the same standard a sandbox send is held to.
    expect(result.delivered).toBe(false);
    expect(result.sandbox).toBe(false);
    expect(result.reason).toMatch(/not delivered/i);
  });

  it('reports its configuration without leaking secrets', () => {
    const status = emailStatus();
    expect(status.transport).toBe('log');
    expect(status.missing).toEqual([]);
    expect(status.sandbox).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/apiKey|secret|key_/i);
  });
});

describe('the SendByte transport', () => {
  /**
   * Every case below switches the transport and re-imports the module, because the
   * transport is read once at start-up. Requests go to a stubbed provider, so the
   * request that would be sent is checked without sending real mail.
   */
  function jsonResponse(status: number, body: unknown): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
  }

  it('posts to the documented endpoint and reports a live send as delivered', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.resetModules();
    process.env.MAIL_TRANSPORT = 'sendbyte';
    process.env.SENDBYTE_API_KEY = 'sk_live_test_key';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse(201, { id: 'em_01j', status: 'queued', sandbox: false });
    });

    try {
      const { sendMail: freshSendMail } = await import('../src/services/email');
      const result = await freshSendMail({ to: 'ada@example.com', subject: 'Hi', text: 'Body' });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe('https://api.sendbyte.africa/v1/emails');
      expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
        'Bearer sk_live_test_key',
      );

      const body = JSON.parse(String(calls[0]!.init.body)) as {
        from: string;
        to: string[];
        subject: string;
        text: string;
      };
      expect(body.to).toEqual(['ada@example.com']);
      expect(body.subject).toBe('Hi');
      expect(body.text).toBe('Body');

      expect(result.accepted).toBe(true);
      expect(result.delivered).toBe(true);
      expect(result.sandbox).toBe(false);
      expect(result.providerId).toBe('em_01j');
    } finally {
      vi.unstubAllGlobals();
      process.env.MAIL_TRANSPORT = 'log';
      delete process.env.SENDBYTE_API_KEY;
      vi.resetModules();
    }
  });

  it('never reports a sandbox send as delivered', async () => {
    vi.resetModules();
    process.env.MAIL_TRANSPORT = 'sendbyte';
    process.env.SENDBYTE_API_KEY = 'sk_test_sandbox_key';
    vi.stubGlobal('fetch', async () => jsonResponse(201, { id: 'em_01k', status: 'queued', sandbox: true }));

    try {
      const { sendMail: freshSendMail } = await import('../src/services/email');
      const result = await freshSendMail({ to: 'ada@example.com', subject: 'Hi', text: 'Body' });

      expect(result.accepted).toBe(true);
      expect(result.sandbox).toBe(true);
      expect(result.delivered).toBe(false);
      expect(result.reason).toMatch(/sandbox/i);
    } finally {
      vi.unstubAllGlobals();
      process.env.MAIL_TRANSPORT = 'log';
      delete process.env.SENDBYTE_API_KEY;
      vi.resetModules();
    }
  });

  it('explains an unverified sending domain instead of failing silently', async () => {
    vi.resetModules();
    process.env.MAIL_TRANSPORT = 'sendbyte';
    process.env.SENDBYTE_API_KEY = 'sk_live_test_key';
    vi.stubGlobal('fetch', async () =>
      jsonResponse(403, { code: 'domain_not_verified', message: 'verify example.org' }),
    );

    try {
      const { sendMail: freshSendMail } = await import('../src/services/email');
      const result = await freshSendMail({ to: 'ada@example.com', subject: 'Hi', text: 'Body' });

      expect(result.accepted).toBe(false);
      expect(result.delivered).toBe(false);
      expect(result.reason).toMatch(/not verified/i);
    } finally {
      vi.unstubAllGlobals();
      process.env.MAIL_TRANSPORT = 'log';
      delete process.env.SENDBYTE_API_KEY;
      vi.resetModules();
    }
  });

  it('surfaces a throttled send with the advice to back off', async () => {
    vi.resetModules();
    process.env.MAIL_TRANSPORT = 'sendbyte';
    process.env.SENDBYTE_API_KEY = 'sk_live_test_key';
    vi.stubGlobal('fetch', async () => jsonResponse(429, { code: 'rate_limit_exceeded' }));

    try {
      const { sendMail: freshSendMail } = await import('../src/services/email');
      const result = await freshSendMail({ to: 'ada@example.com', subject: 'Hi', text: 'Body' });

      expect(result.accepted).toBe(false);
      expect(result.reason).toMatch(/rate limit/i);
    } finally {
      vi.unstubAllGlobals();
      process.env.MAIL_TRANSPORT = 'log';
      delete process.env.SENDBYTE_API_KEY;
      vi.resetModules();
    }
  });

  it('reports a transport failure rather than assuming success', async () => {
    vi.resetModules();
    process.env.MAIL_TRANSPORT = 'sendbyte';
    process.env.SENDBYTE_API_KEY = 'sk_live_test_key';
    vi.stubGlobal('fetch', async () => {
      throw new Error('ETIMEDOUT');
    });

    try {
      const { sendMail: freshSendMail } = await import('../src/services/email');
      const result = await freshSendMail({ to: 'ada@example.com', subject: 'Hi', text: 'Body' });

      expect(result.accepted).toBe(false);
      expect(result.reason).toMatch(/ETIMEDOUT/);
    } finally {
      vi.unstubAllGlobals();
      process.env.MAIL_TRANSPORT = 'log';
      delete process.env.SENDBYTE_API_KEY;
      vi.resetModules();
    }
  });
});
