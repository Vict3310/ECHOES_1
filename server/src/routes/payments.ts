import { Router } from 'express';
import { env } from '../env';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { logger } from '../lib/logger';
import { createRepository } from '../repo';
import {
  queryTransaction,
  simulationAllowed,
  alatpayStatus,
  verifyWebhookSignature,
  type ProviderTransaction,
} from '../services/payments/alatpay';
import { applyVerification } from '../services/payments/verify';

export const paymentsRouter = Router();

/**
 * Applies trusted transaction facts to a booking. Every entry point below
 * funnels through here, so confirmation rules are identical whether the trigger
 * is a webhook, a redirect callback or a provider query.
 */
async function applyFacts(reference: string, facts: ProviderTransaction, actor: string) {
  const repo = createRepository();
  const attempt = await repo.getPaymentAttemptByReference(reference);
  if (!attempt) throw ApiError.notFound('No payment attempt matches that reference.');

  const booking = await repo.getBooking(attempt.bookingId);
  if (!booking) throw ApiError.notFound('The booking for that payment no longer exists.');

  const { outcome, booking: updated, applied } = await applyVerification(repo, attempt, booking, {
    reference: facts.reference,
    status: facts.status,
    amountMinor: facts.amountMinor,
    currency: facts.currency,
    providerReference: facts.providerReference,
  });

  await repo.appendAudit({
    actor,
    action: `payment.${outcome.ok ? 'verified' : outcome.reason}`,
    entityType: 'booking',
    entityId: booking.id,
    details: {
      reference,
      providerStatus: facts.status,
      reason: outcome.reason,
      applied,
    },
  });

  return { outcome, booking: updated, applied };
}

/** ALATPay webhook. Signature is mandatory — an unsigned webhook is rejected. */
paymentsRouter.post(
  '/payments/webhook',
  asyncHandler(async (req, res) => {
    const rawBody =
      Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body ?? {});
    const signature =
      (req.header('x-alatpay-signature') ?? req.header('x-payment-signature') ?? undefined)?.trim();

    if (!env.alatpay.webhookSecret) {
      logger.warn('Rejected a payment webhook: ALATPAY_WEBHOOK_SECRET is not configured.');
      throw ApiError.serviceUnavailable(
        'webhook_not_configured',
        'Webhook processing is disabled until ALATPAY_WEBHOOK_SECRET is configured.',
      );
    }
    if (!verifyWebhookSignature(rawBody, signature)) {
      logger.warn('Rejected a payment webhook with an invalid signature.');
      throw ApiError.forbidden('The webhook signature could not be verified.');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw ApiError.badRequest('The webhook body was not valid JSON.');
    }

    const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
    const reference = String(data.reference ?? data.paymentReference ?? '');
    if (!reference) throw ApiError.badRequest('The webhook did not contain a payment reference.');

    // Prefer the provider's own query result; the webhook body is only a trigger.
    const facts = (await queryTransaction(reference)) ?? {
      reference,
      status: String(data.status ?? 'pending'),
      amountMinor:
        typeof data.amount === 'number'
          ? Math.round(data.amount * 100)
          : typeof data.amount === 'string'
            ? Math.round(Number.parseFloat(data.amount) * 100)
            : null,
      currency: data.currency ? String(data.currency).toUpperCase() : null,
      providerReference: data.id ? String(data.id) : null,
      raw: payload,
    };

    const result = await applyFacts(reference, facts, 'alatpay-webhook');
    ok(res, {
      received: true,
      applied: result.applied,
      bookingStatus: result.booking.status,
      reason: result.outcome.reason,
      message: result.outcome.message,
    });
  }),
);

/** Trusted server-side verification. Called by the return page after checkout. */
paymentsRouter.get(
  '/payments/verify/:reference',
  asyncHandler(async (req, res) => {
    const reference = req.params.reference!;
    const status = alatpayStatus();

    if (!status.transportReady) {
      throw ApiError.serviceUnavailable(
        'alatpay_not_configured',
        `Server-side verification needs ALATPay merchant credentials. Missing: ${status.missing.join(', ') || 'none'}.`,
        { missing: status.missing, environment: status.environment, simulationAllowed: status.simulationAllowed },
      );
    }

    const facts = await queryTransaction(reference);
    if (!facts) {
      throw ApiError.serviceUnavailable(
        'verification_unavailable',
        'ALATPay could not be queried for that reference. The booking status is unchanged.',
      );
    }

    const result = await applyFacts(reference, facts, 'server-verification');
    ok(res, {
      verified: result.outcome.ok,
      reason: result.outcome.reason,
      message: result.outcome.message,
      booking: {
        reference: result.booking.reference,
        status: result.booking.status,
        totalMinor: result.booking.totalMinor,
        currency: result.booking.currency,
      },
    });
  }),
);

/**
 * Simulated checkout, development only. It exists so the booking journey can be
 * exercised without merchant credentials, and it labels itself everywhere.
 */
paymentsRouter.post(
  '/payments/simulate/:reference',
  asyncHandler(async (req, res) => {
    if (!simulationAllowed()) {
      throw ApiError.forbidden(
        'Simulated payments are disabled. Configure ALATPay credentials, or set ALATPAY_ALLOW_SIMULATION=true outside a live environment.',
      );
    }

    const outcome = String((req.body as { outcome?: string })?.outcome ?? 'successful');
    const repo = createRepository();
    const attempt = await repo.getPaymentAttemptByReference(req.params.reference!);
    if (!attempt) throw ApiError.notFound('No payment attempt matches that reference.');
    const booking = await repo.getBooking(attempt.bookingId);
    if (!booking) throw ApiError.notFound('The booking for that payment no longer exists.');

    const statusMap: Record<string, string> = {
      successful: 'successful',
      failed: 'failed',
      cancelled: 'cancelled',
      pending: 'pending',
      expired: 'expired',
      amount_mismatch: 'successful',
      currency_mismatch: 'successful',
    };
    const providerStatus = statusMap[outcome] ?? 'failed';

    // Deliberately inject a wrong amount/currency for the mismatch scenarios so
    // verification is proven to reject them.
    const amountMinor =
      outcome === 'amount_mismatch' ? booking.totalMinor + 100 : booking.totalMinor;
    const currency =
      outcome === 'currency_mismatch' ? (booking.currency === 'NGN' ? 'USD' : 'NGN') : booking.currency;

    const result = await applyFacts(
      attempt.reference,
      {
        reference: attempt.reference,
        status: providerStatus,
        amountMinor,
        currency,
        providerReference: `SIMULATED-${attempt.reference}`,
        raw: { simulated: true, requestedOutcome: outcome },
      },
      'simulated-checkout',
    );

    logger.warn({ reference: attempt.reference, outcome }, 'SIMULATED payment applied (no real money moved)');

    ok(res, {
      simulated: true,
      requestedOutcome: outcome,
      verified: result.outcome.ok,
      reason: result.outcome.reason,
      message: result.outcome.message,
      booking: {
        reference: result.booking.reference,
        status: result.booking.status,
        totalMinor: result.booking.totalMinor,
        currency: result.booking.currency,
      },
      warning: 'SIMULATED payment. No real transaction took place.',
    });
  }),
);
