import { Router } from 'express';
import { asyncHandler, ok } from '../lib/http';
import { ApiError } from '../lib/errors';
import { requireAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createRepository } from '../repo';
import { moderationSchema } from '../schemas';
import { analysePlace, SOURCES_CHECKED } from '../services/knowledge';
import { findPotentialDuplicates } from '../services/quality';
import { alatpayStatus } from '../services/payments/alatpay';
import { augmentCoverage } from './places';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const repo = createRepository();
    const places = await repo.listPlaces({});
    const pendingStories = await repo.listStories('pending');
    const pendingGuides = await repo.listGuideProfiles('pending');
    const bookings = await repo.listBookings();
    const payments = await repo.listPaymentAttempts();

    const needingResearch = places.filter((place) => analysePlace(place).needsResearch);
    const unresolvedPayments = payments.filter(
      (payment) => payment.status === 'pending' || payment.status === 'mismatched' || payment.status === 'initialised',
    );

    ok(res, {
      counts: {
        places: places.length,
        placesNeedingResearch: needingResearch.length,
        storiesPending: pendingStories.length,
        guidesPending: pendingGuides.length,
        bookings: bookings.length,
        paymentsUnresolved: unresolvedPayments.length,
        probableDuplicates: findPotentialDuplicates(places).length,
      },
      paymentsProvider: alatpayStatus(),
      sourcesChecked: SOURCES_CHECKED,
    });
  }),
);

adminRouter.get(
  '/stories',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? (req.query.status as never) : undefined;
    const stories = await createRepository().listStories(status);
    ok(res, { stories });
  }),
);

adminRouter.get(
  '/guides',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? (req.query.status as never) : undefined;
    const guides = await createRepository().listGuideProfiles(status);
    ok(res, { guides });
  }),
);

adminRouter.post(
  '/stories/:id/moderate',
  validateBody(moderationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      status: 'approved' | 'rejected' | 'needs_correction' | 'pending';
      moderationNote?: string | null;
      reviewedBy?: string;
    };
    const repo = createRepository();
    const story = await repo.getStory(req.params.id!);
    if (!story) throw ApiError.notFound('No submission matches that id.');

    if (body.status === 'approved' && story.sensitivity !== 'standard') {
      throw ApiError.unprocessable(
        'This contribution is marked as sensitive or restricted content. It cannot be approved through the standard moderation path.',
        { sensitivity: story.sensitivity },
      );
    }

    const reviewer = req.user?.email ?? body.reviewedBy ?? 'admin-token';
    const updated = await repo.moderateStory(story.id, {
      status: body.status,
      moderationNote: body.moderationNote ?? null,
      reviewedBy: reviewer,
    });

    await repo.appendAudit({
      actor: reviewer,
      action: `story.${body.status}`,
      entityType: 'story',
      entityId: updated.id,
      details: { note: body.moderationNote ?? null, previousStatus: story.status },
    });

    ok(res, { story: updated });
  }),
);

adminRouter.post(
  '/guides/:id/moderate',
  validateBody(moderationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      status: 'approved' | 'rejected' | 'needs_correction' | 'pending';
      moderationNote?: string | null;
      reviewedBy?: string;
    };
    const repo = createRepository();
    const guide = await repo.getGuideProfile(req.params.id!);
    if (!guide) throw ApiError.notFound('No guide profile matches that id.');

    const reviewer = req.user?.email ?? body.reviewedBy ?? 'admin-token';
    const updated = await repo.moderateGuideProfile(guide.id, {
      status: body.status,
      moderationNote: body.moderationNote ?? null,
      reviewedBy: reviewer,
    });

    await repo.appendAudit({
      actor: reviewer,
      action: `guide.${body.status}`,
      entityType: 'guide_profile',
      entityId: updated.id,
      details: { note: body.moderationNote ?? null, previousStatus: guide.status },
    });

    ok(res, { guide: updated });
  }),
);

adminRouter.get(
  '/bookings',
  asyncHandler(async (_req, res) => {
    const repo = createRepository();
    const bookings = await repo.listBookings();
    const experiences = await repo.listExperiences();
    ok(res, {
      bookings: bookings.map((booking) => ({
        ...booking,
        experienceTitle: experiences.find((e) => e.id === booking.experienceId)?.title ?? null,
        isSampleData: experiences.find((e) => e.id === booking.experienceId)?.isSampleData ?? true,
      })),
    });
  }),
);

adminRouter.get(
  '/payments',
  asyncHandler(async (_req, res) => {
    const repo = createRepository();
    const payments = await repo.listPaymentAttempts();
    const bookings = await repo.listBookings();
    ok(res, {
      // Safe reconciliation metadata only — never card data.
      payments: payments.map((payment) => {
        const booking = bookings.find((b) => b.id === payment.bookingId);
        return {
          reference: payment.reference,
          status: payment.status,
          providerStatus: payment.providerStatus,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          bookingReference: booking?.reference ?? null,
          bookingStatus: booking?.status ?? null,
          amountMatchesBooking: booking ? booking.totalMinor === payment.amountMinor : null,
          unresolved: payment.status === 'pending' || payment.status === 'mismatched',
        };
      }),
      provider: alatpayStatus(),
    });
  }),
);

adminRouter.get(
  '/data-quality',
  asyncHandler(async (_req, res) => {
    const repo = createRepository();
    const places = await repo.listPlaces({});

    const withState = await Promise.all(
      places.map(async (place) => {
        const approved = await repo.listStoriesForPlace(place.id, 'approved');
        const pending = await repo.listStoriesForPlace(place.id, 'pending');
        const augmented = augmentCoverage(place, approved.length, pending.length);
        const analysis = analysePlace(augmented);
        return {
          id: place.id,
          name: place.name,
          category: place.category,
          needsResearch: analysis.needsResearch,
          coveredDimensions: analysis.coveredDimensions,
          totalDimensions: analysis.totalDimensions,
          statuses: analysis.statuses,
          gaps: analysis.gaps,
        };
      }),
    );

    ok(res, {
      places: withState.sort((a, b) => a.coveredDimensions - b.coveredDimensions),
      probableDuplicates: findPotentialDuplicates(places),
      duplicatePolicy:
        'Flagged for human review only. ECHOES never merges or deletes records automatically based on name similarity.',
      sourcesChecked: SOURCES_CHECKED,
    });
  }),
);

adminRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number.parseInt(String(req.query.limit ?? '100'), 10) || 100, 500);
    ok(res, { audit: await createRepository().listAudit(limit) });
  }),
);
