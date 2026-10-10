import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepository } from '../src/repo/memory';
import { applyVerification, evaluateTransaction } from '../src/services/payments/verify';
import type { Booking } from '../src/domain/types';

const REFERENCE = 'ECH-PAY-TEST000001';

async function fixture() {
  const repo = new MemoryRepository();
  const booking = await repo.createBooking({
    experienceId: 'sample-afrobeat-walk',
    scheduleId: 'sun-1500',
    participants: 2,
    customerName: 'Ada Obi',
    customerEmail: 'ada@example.com',
    customerPhone: null,
    notes: null,
  });
  const attempt = await repo.createPaymentAttempt({
    bookingId: booking.id,
    reference: REFERENCE,
    amountMinor: booking.totalMinor,
    currency: booking.currency,
    status: 'pending',
    checkoutUrl: 'https://example.invalid/checkout',
  });
  return { repo, booking, attempt };
}

function facts(overrides: Partial<{ reference: string; status: string; amountMinor: number | null; currency: string | null; providerReference: string | null }> = {}) {
  return {
    reference: REFERENCE,
    status: 'successful',
    amountMinor: 3_000_000,
    currency: 'NGN',
    providerReference: 'PROV-1',
    ...overrides,
  };
}

describe('payment verification rules', () => {
  let ctx: Awaited<ReturnType<typeof fixture>>;

  beforeEach(async () => {
    ctx = await fixture();
  });

  it('confirms a booking only when the reference, amount and currency all match', () => {
    const outcome = evaluateTransaction(ctx.attempt, ctx.booking, facts());
    expect(outcome.ok).toBe(true);
    expect(outcome.bookingStatus).toBe('confirmed');
    expect(outcome.paymentStatus).toBe('successful');
  });

  it('rejects a reference that does not belong to the attempt', () => {
    const outcome = evaluateTransaction(ctx.attempt, ctx.booking, facts({ reference: 'ECH-PAY-OTHER' }));
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('reference_mismatch');
  });

  it('rejects an amount mismatch', () => {
    const outcome = evaluateTransaction(ctx.attempt, ctx.booking, facts({ amountMinor: 100 }));
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('amount_mismatch');
    expect(outcome.bookingStatus).toBe('pending_payment');
  });

  it('rejects a currency mismatch', () => {
    const outcome = evaluateTransaction(ctx.attempt, ctx.booking, facts({ currency: 'USD' }));
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('currency_mismatch');
  });

  it('refuses to confirm when the provider does not report an amount', () => {
    const outcome = evaluateTransaction(ctx.attempt, ctx.booking, facts({ amountMinor: null }));
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('amount_unavailable');
  });

  it('maps pending, cancelled, expired and failed provider states', () => {
    expect(evaluateTransaction(ctx.attempt, ctx.booking, facts({ status: 'pending' })).paymentStatus).toBe('pending');
    expect(evaluateTransaction(ctx.attempt, ctx.booking, facts({ status: 'cancelled' })).paymentStatus).toBe('cancelled');
    expect(evaluateTransaction(ctx.attempt, ctx.booking, facts({ status: 'expired' })).paymentStatus).toBe('expired');
    expect(evaluateTransaction(ctx.attempt, ctx.booking, facts({ status: 'declined' })).paymentStatus).toBe('failed');
  });

  it('a redirect-style success status is not enough — the amount still has to match', () => {
    const outcome = evaluateTransaction(ctx.attempt, ctx.booking, facts({ status: 'success', amountMinor: 1 }));
    expect(outcome.ok).toBe(false);
  });
});

describe('payment application', () => {
  it('confirms the booking and records the provider status', async () => {
    const ctx = await fixture();
    const result = await applyVerification(ctx.repo, ctx.attempt, ctx.booking, facts());
    expect(result.applied).toBe(true);
    expect(result.booking.status).toBe('confirmed');
    const attempt = await ctx.repo.getPaymentAttemptByReference(REFERENCE);
    expect(attempt?.status).toBe('successful');
    expect(attempt?.providerReference).toBe('PROV-1');
  });

  it('is idempotent: replaying the same transaction does not confirm twice', async () => {
    const ctx = await fixture();
    await applyVerification(ctx.repo, ctx.attempt, ctx.booking, facts());
    const reloadedBooking = (await ctx.repo.getBooking(ctx.booking.id)) as Booking;
    const reloadedAttempt = (await ctx.repo.getPaymentAttemptByReference(REFERENCE))!;
    const replay = await applyVerification(ctx.repo, reloadedAttempt, reloadedBooking, facts());
    expect(replay.applied).toBe(false);
    expect(replay.booking.status).toBe('confirmed');
  });

  it('does not resurrect a cancelled booking when a late success arrives', async () => {
    const ctx = await fixture();
    await ctx.repo.updateBookingStatus(ctx.booking.id, 'cancelled');
    const cancelled = (await ctx.repo.getBooking(ctx.booking.id)) as Booking;
    const attempt = (await ctx.repo.getPaymentAttemptByReference(REFERENCE))!;
    const result = await applyVerification(ctx.repo, attempt, cancelled, facts());
    expect(result.applied).toBe(false);
    expect(result.booking.status).toBe('cancelled');
  });

  it('leaves the booking unconfirmed on an amount mismatch', async () => {
    const ctx = await fixture();
    const result = await applyVerification(ctx.repo, ctx.attempt, ctx.booking, facts({ amountMinor: 5 }));
    expect(result.booking.status).toBe('pending_payment');
    const attempt = await ctx.repo.getPaymentAttemptByReference(REFERENCE);
    expect(attempt?.status).toBe('mismatched');
  });
});
