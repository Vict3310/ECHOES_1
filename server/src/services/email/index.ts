/**
 * Outbound email.
 *
 * ECHOES sends transactional mail (password resets today, booking receipts and
 * moderation outcomes next), so the transport sits behind a small interface rather
 * than being called inline. Four behaviours matter and all four are explicit:
 *
 *   - an unconfigured transport never pretends to have delivered anything;
 *   - the development transport logs the whole message, including any link, so a
 *     reset flow can be completed without a provider account;
 *   - **a sandbox send is reported as sandboxed, not delivered.** SendByte's
 *     `sk_test_` keys capture mail instead of delivering it, and calling that a
 *     delivery would be exactly the kind of quiet overstatement this codebase
 *     avoids elsewhere;
 *   - provider failures are surfaced to the caller instead of being swallowed.
 *
 * Provider reference: POST https://api.sendbyte.africa/v1/emails
 * (https://docs.sendbyte.africa/api-reference/emails).
 */
import { env } from '../../env';
import { logger } from '../../lib/logger';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body. SendByte recommends it alongside HTML for deliverability. */
  text: string;
  html?: string;
  /**
   * Stable key for one logical send, so a retry after a timeout cannot produce a
   * duplicate receipt. SendByte returns the original email for a repeated key.
   */
  idempotencyKey?: string;
}

export type MailTransport = 'log' | 'sendbyte' | 'none';

export interface MailResult {
  /** The transport took the message. For the log transport this means it was written. */
  accepted: boolean;
  /** It left for a real inbox. Always false for a sandbox send and for the log transport. */
  delivered: boolean;
  transport: MailTransport;
  /** True when a SendByte sandbox key captured the message instead of delivering it. */
  sandbox: boolean;
  /** Why it was not delivered, when it was not. */
  reason?: string;
  providerId?: string;
}

interface SendByteResponse {
  id?: string;
  status?: string;
  sandbox?: boolean;
  message?: string;
  error?: string;
  code?: string;
  errors?: Array<{ field?: string; message?: string }>;
}

function redact(address: string): string {
  const [local, domain] = address.split('@');
  if (!local || !domain) return '<invalid address>';
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(local.length - 1, 0))}@${domain}`;
}

/**
 * The message, not the log line: a developer completing a reset flow from the
 * terminal needs the link that was sent, and tests assert on it.
 */
function logMessage(message: MailMessage): void {
  logger.info(
    { to: redact(message.to), subject: message.subject },
    'email (development transport) — written to the log, not sent to a provider',
  );
  logger.info({ body: message.text }, 'email body');
}

/** Turns a SendByte error response into one sentence an operator can act on. */
function describeFailure(status: number, body: SendByteResponse | null): string {
  if (body?.code === 'domain_not_verified') {
    return `The domain in EMAIL_FROM is not verified in SendByte: ${body.message ?? 'domain_not_verified'}.`;
  }
  if (body?.code === 'suppressed_recipient') {
    return `SendByte suppressed that recipient after a bounce or complaint: ${body.message ?? 'suppressed_recipient'}.`;
  }
  if (status === 429) {
    return `SendByte rate limit exceeded${body?.message ? `: ${body.message}` : ''}. Back off and retry.`;
  }
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    return body.errors
      .map((entry) => `${entry.field ?? 'request'}: ${entry.message ?? 'invalid'}`)
      .join('; ');
  }
  return body?.message ?? body?.error ?? `SendByte responded with HTTP ${status}.`;
}

async function sendViaSendByte(message: MailMessage, apiKey: string): Promise<MailResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const endpoint = `${env.email.sendbyteBaseUrl.replace(/\/$/, '')}/v1/emails`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: env.email.from,
        // SendByte accepts a single address or an array.
        to: [message.to],
        subject: message.subject,
        html: message.html ?? `<p>${message.text.replace(/\n/g, '<br>')}</p>`,
        text: message.text,
        ...(message.idempotencyKey ? { idempotency_key: message.idempotencyKey } : {}),
      }),
    });

    const body = (await response.json().catch(() => null)) as SendByteResponse | null;

    if (!response.ok) {
      const reason = describeFailure(response.status, body);
      logger.error({ to: redact(message.to), status: response.status, reason }, 'email delivery failed');
      return { accepted: false, delivered: false, transport: 'sendbyte', sandbox: false, reason };
    }

    // SendByte answers 201 with the queued email. A sandbox key captures the message
    // rather than delivering it, so that is reported separately from acceptance.
    const sandbox = body?.sandbox === true || apiKey.startsWith('sk_test_');
    return {
      accepted: true,
      delivered: !sandbox,
      transport: 'sendbyte',
      sandbox,
      ...(sandbox ? { reason: 'SendByte sandbox key: the message was captured, not delivered.' } : {}),
      ...(body?.id ? { providerId: body.id } : {}),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown email transport failure.';
    logger.error({ err: error, to: redact(message.to) }, 'email delivery failed');
    return { accepted: false, delivered: false, transport: 'sendbyte', sandbox: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const to = message.to.trim();
  if (!to) {
    return {
      accepted: false,
      delivered: false,
      transport: env.email.transport,
      sandbox: false,
      reason: 'No recipient address.',
    };
  }

  switch (env.email.transport) {
    case 'none':
      return {
        accepted: false,
        delivered: false,
        transport: 'none',
        sandbox: false,
        reason: 'MAIL_TRANSPORT=none — email sending is disabled in this environment.',
      };
    case 'sendbyte': {
      if (!env.email.sendbyteApiKey) {
        return {
          accepted: false,
          delivered: false,
          transport: 'sendbyte',
          sandbox: false,
          reason: 'MAIL_TRANSPORT=sendbyte but SENDBYTE_API_KEY is empty.',
        };
      }
      return sendViaSendByte({ ...message, to }, env.email.sendbyteApiKey);
    }
    case 'log':
    default: {
      logMessage({ ...message, to });
      return {
        accepted: true,
        // Written to a log is not delivered to a person; saying otherwise would be
        // the same lie as a sandbox send reported as delivered.
        delivered: false,
        transport: 'log',
        sandbox: false,
        reason: 'Development transport: written to the API log, not delivered.',
      };
    }
  }
}

/** Whether a real provider is configured, for the health endpoint. */
export function emailStatus(): {
  transport: MailTransport;
  from: string;
  configured: boolean;
  /** True when the configured key can only simulate delivery. */
  sandbox: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (env.email.transport === 'sendbyte' && !env.email.sendbyteApiKey) missing.push('SENDBYTE_API_KEY');
  if (!env.email.from) missing.push('EMAIL_FROM');

  return {
    transport: env.email.transport,
    from: env.email.from,
    configured: missing.length === 0 && env.email.transport !== 'none',
    sandbox: env.email.transport === 'sendbyte' && env.email.sendbyteApiKey.startsWith('sk_test_'),
    missing,
  };
}
