import crypto from 'node:crypto';
import { env } from '../../env';
import { ApiError } from '../../lib/errors';
import { logger } from '../../lib/logger';

/**
 * ALATPay integration.
 *
 * IMPORTANT: the exact REST paths and payload shapes below are supplied through
 * configuration (ALATPAY_INIT_PATH, ALATPAY_VERIFY_PATH) rather than hard-coded,
 * because they must be taken from the current ALATPay documentation at
 * https://docs.alatpay.ng/ for the merchant account actually in use. This module
 * never invents an endpoint: if the paths or the merchant credentials are absent
 * it reports precisely what is missing instead of pretending to charge anyone.
 */

export interface AlatpayStatus {
  environment: 'sandbox' | 'live';
  configured: boolean;
  missing: string[];
  simulationAllowed: boolean;
  transportReady: boolean;
}

export function alatpayStatus(): AlatpayStatus {
  const missing: string[] = [];
  if (!env.alatpay.publicKey) missing.push('ALATPAY_PUBLIC_KEY');
  if (!env.alatpay.secretKey) missing.push('ALATPAY_SECRET_KEY');
  if (!env.alatpay.businessId) missing.push('ALATPAY_BUSINESS_ID');
  if (!env.alatpay.initPath) missing.push('ALATPAY_INIT_PATH');
  if (!env.alatpay.verifyPath) missing.push('ALATPAY_VERIFY_PATH');

  const configured = missing.length === 0;
  return {
    environment: env.alatpay.environment,
    configured,
    missing,
    simulationAllowed: simulationAllowed(),
    transportReady: configured,
  };
}

/**
 * Simulation is a development-only affordance so the full booking journey can be
 * exercised without merchant credentials. It is never available when
 * ALATPAY_ENV=live, and it always reports itself as simulated.
 */
export function simulationAllowed(): boolean {
  if (env.alatpay.environment === 'live') return false;
  if (env.alatpay.allowSimulation) return true;
  return !env.isProduction;
}

export interface CheckoutInitInput {
  reference: string;
  amountMinor: number;
  currency: string;
  description: string;
  customer: { name: string; email: string; phone?: string | null };
}

export interface CheckoutInitResult {
  mode: 'provider' | 'simulated';
  checkoutUrl: string;
  providerReference: string | null;
  raw: unknown;
}

export async function initialiseCheckout(input: CheckoutInitInput): Promise<CheckoutInitResult> {
  const status = alatpayStatus();

  if (!status.transportReady) {
    if (!status.simulationAllowed) {
      throw ApiError.serviceUnavailable(
        'alatpay_not_configured',
        `ALATPay is not configured and payment simulation is disabled. Missing: ${status.missing.join(', ')}.`,
        { missing: status.missing, environment: status.environment },
      );
    }
    logger.warn(
      { reference: input.reference, missing: status.missing },
      'ALATPay not configured — issuing a SIMULATED checkout for local development.',
    );
    return {
      mode: 'simulated',
      checkoutUrl: `/api/payments/simulate/${encodeURIComponent(input.reference)}`,
      providerReference: null,
      raw: { simulated: true, missing: status.missing },
    };
  }

  const url = `${env.alatpay.baseUrl.replace(/\/$/, '')}${env.alatpay.initPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-public-key': env.alatpay.publicKey,
        authorization: `Bearer ${env.alatpay.secretKey}`,
      },
      body: JSON.stringify({
        businessId: env.alatpay.businessId,
        reference: input.reference,
        amount: (input.amountMinor / 100).toFixed(2),
        currency: input.currency,
        description: input.description,
        callbackUrl: env.alatpay.callbackUrl,
        customer: input.customer,
      }),
    });

    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep raw text */
    }

    if (!response.ok) {
      throw ApiError.serviceUnavailable(
        'alatpay_checkout_failed',
        `ALATPay checkout initialisation failed with HTTP ${response.status}.`,
        { body: text.slice(0, 300) },
      );
    }

    const record = body as { checkoutUrl?: string; paymentUrl?: string; data?: { checkoutUrl?: string; paymentUrl?: string; id?: string; reference?: string } };
    const checkoutUrl =
      record.checkoutUrl ?? record.paymentUrl ?? record.data?.checkoutUrl ?? record.data?.paymentUrl ?? '';
    if (!checkoutUrl) {
      throw ApiError.serviceUnavailable(
        'alatpay_checkout_failed',
        'ALATPay did not return a checkout URL. Verify the field mapping for your account against the current documentation.',
        { body: text.slice(0, 300) },
      );
    }

    return {
      mode: 'provider',
      checkoutUrl,
      providerReference: record.data?.id ?? record.data?.reference ?? null,
      raw: body,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.serviceUnavailable(
      'alatpay_unreachable',
      error instanceof Error ? `Could not reach ALATPay: ${error.message}` : 'Could not reach ALATPay.',
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface ProviderTransaction {
  reference: string;
  status: string;
  amountMinor: number | null;
  currency: string | null;
  providerReference: string | null;
  raw: unknown;
}

/** Server-side query of a transaction. This is the only trusted source of truth. */
export async function queryTransaction(reference: string): Promise<ProviderTransaction | null> {
  const status = alatpayStatus();
  if (!status.transportReady) return null;

  const path = env.alatpay.verifyPath.replace(':reference', encodeURIComponent(reference));
  const url = `${env.alatpay.baseUrl.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'x-public-key': env.alatpay.publicKey,
        authorization: `Bearer ${env.alatpay.secretKey}`,
      },
    });
    if (!response.ok) {
      logger.warn({ reference, status: response.status }, 'ALATPay transaction query failed.');
      return null;
    }
    const body = (await response.json()) as {
      data?: Record<string, unknown>;
    } & Record<string, unknown>;
    const data = (body.data ?? body) as Record<string, unknown>;
    const amountRaw = data.amount ?? data.amountMinor;
    const amountMinor =
      typeof amountRaw === 'number'
        ? amountRaw > 100000
          ? amountRaw
          : Math.round(amountRaw * 100)
        : typeof amountRaw === 'string'
          ? Math.round(Number.parseFloat(amountRaw) * 100)
          : null;

    return {
      reference: String(data.reference ?? reference),
      status: String(data.status ?? data.paymentStatus ?? 'unknown').toLowerCase(),
      amountMinor,
      currency: data.currency ? String(data.currency).toUpperCase() : null,
      providerReference: data.id ? String(data.id) : data.transactionId ? String(data.transactionId) : null,
      raw: body,
    };
  } catch (error) {
    logger.warn({ err: error, reference }, 'ALATPay transaction query errored.');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Constant-time HMAC check of an inbound webhook body. Returns false when no
 * shared secret is configured, so an unverified webhook is never trusted.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!env.alatpay.webhookSecret) return false;
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', env.alatpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
