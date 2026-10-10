import type { Booking, BookingStatus, PaymentAttempt, PaymentStatus } from '../../domain/types';

export interface TransactionFacts {
  reference: string;
  status: string;
  amountMinor: number | null;
  currency: string | null;
  providerReference: string | null;
}

export type VerificationReason =
  | 'verified'
  | 'reference_mismatch'
  | 'amount_unavailable'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'pending'
  | 'not_successful';

export interface VerificationOutcome {
  ok: boolean;
  reason: VerificationReason;
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
  message: string;
}

const SUCCESS_STATES = new Set(['successful', 'success', 'completed', 'complete', 'paid', 'approved', 'confirmed']);
const PENDING_STATES = new Set(['pending', 'processing', 'initialised', 'initialized', 'awaiting_payment', 'in_progress']);
const CANCELLED_STATES = new Set(['cancelled', 'canceled', 'abandoned', 'reversed']);
const EXPIRED_STATES = new Set(['expired', 'timed_out', 'timeout']);

/**
 * Decides what a provider transaction means for a booking. A redirect URL with
 * a success parameter is never trusted — only these checks on server-fetched
 * transaction facts can confirm a booking.
 */
export function evaluateTransaction(
  attempt: PaymentAttempt,
  booking: Booking,
  facts: TransactionFacts,
): VerificationOutcome {
  if (!facts.reference || facts.reference !== attempt.reference) {
    return {
      ok: false,
      reason: 'reference_mismatch',
      paymentStatus: 'mismatched',
      bookingStatus: 'failed',
      message: 'The transaction reference does not match this booking attempt.',
    };
  }

  const status = facts.status.toLowerCase();

  if (PENDING_STATES.has(status)) {
    return {
      ok: false,
      reason: 'pending',
      paymentStatus: 'pending',
      bookingStatus: 'pending_payment',
      message: 'The transaction is still pending at the provider.',
    };
  }
  if (CANCELLED_STATES.has(status)) {
    return {
      ok: false,
      reason: 'not_successful',
      paymentStatus: 'cancelled',
      bookingStatus: 'cancelled',
      message: 'The transaction was cancelled.',
    };
  }
  if (EXPIRED_STATES.has(status)) {
    return {
      ok: false,
      reason: 'not_successful',
      paymentStatus: 'expired',
      bookingStatus: 'expired',
      message: 'The transaction expired before payment completed.',
    };
  }
  if (!SUCCESS_STATES.has(status)) {
    return {
      ok: false,
      reason: 'not_successful',
      paymentStatus: 'failed',
      bookingStatus: 'failed',
      message: `The provider reported status "${facts.status}".`,
    };
  }

  if (facts.amountMinor === null || !Number.isFinite(facts.amountMinor)) {
    return {
      ok: false,
      reason: 'amount_unavailable',
      paymentStatus: 'mismatched',
      bookingStatus: 'pending_payment',
      message: 'The provider did not report a verifiable amount; the booking stays unconfirmed.',
    };
  }
  if (facts.amountMinor !== booking.totalMinor) {
    return {
      ok: false,
      reason: 'amount_mismatch',
      paymentStatus: 'mismatched',
      bookingStatus: 'pending_payment',
      message: `Amount mismatch: provider reported ${facts.amountMinor}, booking expects ${booking.totalMinor}.`,
    };
  }
  if (!facts.currency || facts.currency.toUpperCase() !== booking.currency.toUpperCase()) {
    return {
      ok: false,
      reason: 'currency_mismatch',
      paymentStatus: 'mismatched',
      bookingStatus: 'pending_payment',
      message: `Currency mismatch: provider reported ${facts.currency ?? 'none'}, booking expects ${booking.currency}.`,
    };
  }

  return {
    ok: true,
    reason: 'verified',
    paymentStatus: 'successful',
    bookingStatus: 'confirmed',
    message: 'Payment verified against the booking amount and currency.',
  };
}

/**
 * Idempotent transition. Replaying the same webhook or callback cannot confirm a
 * booking twice, cannot resurrect a cancelled booking, and cannot downgrade a
 * confirmed one.
 */
export async function applyVerification(
  repo: {
    getBooking(id: string): Promise<Booking | null>;
    updateBookingStatus(id: string, status: BookingStatus): Promise<Booking>;
    updatePaymentAttempt(
      id: string,
      patch: Partial<Pick<PaymentAttempt, 'status' | 'providerStatus' | 'providerReference' | 'payload'>>,
    ): Promise<PaymentAttempt>;
  },
  attempt: PaymentAttempt,
  booking: Booking,
  facts: TransactionFacts,
): Promise<{ outcome: VerificationOutcome; booking: Booking; applied: boolean }> {
  const outcome = evaluateTransaction(attempt, booking, facts);

  const alreadyFinal =
    booking.status === 'confirmed' || booking.status === 'cancelled' || booking.status === 'failed';

  await repo.updatePaymentAttempt(attempt.id, {
    status: outcome.paymentStatus,
    providerStatus: facts.status,
    providerReference: facts.providerReference,
    payload: facts as unknown,
  });

  if (alreadyFinal && booking.status !== 'pending_payment') {
    return { outcome, booking, applied: false };
  }

  const updated = await repo.updateBookingStatus(booking.id, outcome.bookingStatus);
  return { outcome, booking: updated, applied: true };
}
