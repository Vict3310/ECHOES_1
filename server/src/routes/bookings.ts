import { Router } from 'express';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { paymentReference } from '../lib/ids';
import { logger } from '../lib/logger';
import { paymentLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { createRepository } from '../repo';
import { bookingSchema } from '../schemas';
import { initialiseCheckout, alatpayStatus } from '../services/payments/alatpay';
import { recordServerEvent } from '../services/analytics/collect';

export const bookingsRouter = Router();

bookingsRouter.get(
  '/bookings',
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    const sessionEmail = req.user?.email?.trim().toLowerCase() ?? '';
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'moderator';
    const isOrganizer = req.user?.role === 'organizer';

    if (!isStaff && !isOrganizer && !sessionEmail && !email) {
      throw ApiError.unauthorized('Sign in to view your bookings.');
    }

    if (!isStaff && !isOrganizer && sessionEmail && email && email !== sessionEmail) {
      throw ApiError.forbidden('You can only view your own bookings.');
    }

    const targetEmail = isStaff || isOrganizer ? '' : (email || sessionEmail);
    let bookings = await repo.listBookings();

    if (!isStaff && !isOrganizer && targetEmail) {
      bookings = bookings.filter((booking) => booking.customerEmail.toLowerCase() === targetEmail);
    }

    const enriched = await Promise.all(
      bookings.map(async (booking) => {
        const experience = await repo.getExperience(booking.experienceId);
        return {
          id: booking.id,
          reference: booking.reference,
          status: booking.status,
          experienceId: booking.experienceId,
          experienceTitle: experience?.title ?? 'Experience',
          scheduleId: booking.scheduleId,
          participants: booking.participants,
          totalMinor: booking.totalMinor,
          currency: booking.currency,
          customerName: booking.customerName,
          customerEmail: booking.customerEmail,
          createdAt: booking.createdAt,
          updatedAt: booking.updatedAt,
        };
      }),
    );

    ok(res, { bookings: enriched });
  }),
);

bookingsRouter.post(
  '/bookings',
  paymentLimiter,
  validateBody(bookingSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as {
      experienceId: string;
      scheduleId: string;
      participants: number;
      customerName: string;
      customerEmail: string;
      customerPhone?: string | null;
      notes?: string | null;
    };

    const repo = createRepository();
    const experience = await repo.getExperience(input.experienceId);
    if (!experience) throw ApiError.notFound('No experience matches that id.');

    // Capacity is validated inside the repository under a lock / advisory lock,
    // so two simultaneous checkouts cannot oversell a date.
    const booking = await repo.createBooking({
      experienceId: experience.id,
      scheduleId: input.scheduleId,
      participants: input.participants,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone ?? null,
      notes: input.notes ?? null,
    });

    const reference = paymentReference();
    const attempt = await repo.createPaymentAttempt({
      bookingId: booking.id,
      reference,
      amountMinor: booking.totalMinor,
      currency: booking.currency,
      status: 'initialised',
      checkoutUrl: null,
    });

    let checkout;
    try {
      checkout = await initialiseCheckout({
        reference,
        amountMinor: booking.totalMinor,
        currency: booking.currency,
        description: `${experience.title} — ${booking.participants} participant(s)`,
        customer: {
          name: booking.customerName,
          email: booking.customerEmail,
          phone: booking.customerPhone,
        },
      });
    } catch (error) {
      await repo.updatePaymentAttempt(attempt.id, {
        status: 'failed',
        providerStatus: 'initialisation_failed',
      });
      await repo.updateBookingStatus(booking.id, 'failed');
      throw error;
    }

    await repo.updatePaymentAttempt(attempt.id, {
      status: 'pending',
      checkoutUrl: checkout.checkoutUrl,
      providerReference: checkout.providerReference,
      payload: checkout.raw,
    });

    await repo.appendAudit({
      actor: booking.customerEmail,
      action: 'booking.created',
      entityType: 'booking',
      entityId: booking.id,
      details: { reference, mode: checkout.mode, amountMinor: booking.totalMinor },
    });

    // Recorded server-side, so a booking that exists is always counted even if
    // the visitor never returns to a page that could report it.
    await recordServerEvent(repo, 'booking_started', {
      userId: req.user?.id ?? null,
      resourceId: experience.id,
      path: '/bookings',
      props: {
        experienceId: experience.id,
        participants: Math.min(Math.max(booking.participants, 1), 100),
      },
    });

    logger.info(
      { booking: booking.reference, payment: reference, mode: checkout.mode },
      'Booking created and checkout initialised',
    );

    ok(
      res,
      {
        booking: {
          reference: booking.reference,
          status: booking.status,
          experienceId: booking.experienceId,
          scheduleId: booking.scheduleId,
          participants: booking.participants,
          totalMinor: booking.totalMinor,
          currency: booking.currency,
        },
        payment: {
          reference,
          mode: checkout.mode,
          checkoutUrl: checkout.checkoutUrl,
          status: 'pending',
          simulated: checkout.mode === 'simulated',
        },
        next:
          checkout.mode === 'simulated'
            ? 'ALATPay is not configured, so this checkout is SIMULATED. No payment is taken. Complete it from the payment page to exercise the flow.'
            : 'Complete the payment on the ALATPay checkout page. The booking is confirmed only after the server verifies the transaction.',
        provider: alatpayStatus(),
      },
      201,
    );
  }),
);

bookingsRouter.get(
  '/bookings/:reference',
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const booking = await repo.getBookingByReference(req.params.reference!);
    if (!booking) throw ApiError.notFound('No booking matches that reference.');

    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    const sessionEmail = req.user?.email?.trim().toLowerCase() ?? '';
    const owns = Boolean(email || sessionEmail) && booking.customerEmail.toLowerCase() === (email || sessionEmail);
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'moderator';
    const isOrganizer = req.user?.role === 'organizer';
    if (!owns && !isStaff && !isOrganizer) {
      throw ApiError.forbidden('Provide the email used for this booking to view it.');
    }

    const payments = await repo.listPaymentAttempts(booking.id);
    const experience = await repo.getExperience(booking.experienceId);

    ok(res, {
      booking,
      experienceTitle: experience?.title ?? null,
      payments: payments.map((p) => ({
        reference: p.reference,
        status: p.status,
        providerStatus: p.providerStatus,
        amountMinor: p.amountMinor,
        currency: p.currency,
        createdAt: p.createdAt,
      })),
    });
  }),
);
