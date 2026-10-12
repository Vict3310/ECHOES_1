import { Router } from 'express';
import { EVENT_SPECS, EVENT_NAMES, SESSION_INACTIVITY_MINUTES } from '../domain/analytics';
import { env } from '../env';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { analyticsLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { createRepository } from '../repo';
import { analyticsIngestSchema, analyticsOptOutSchema } from '../schemas';
import { collectEvents } from '../services/analytics/collect';

/**
 * First-party analytics collection.
 *
 * The endpoint accepts beacons from our own pages only, stores nothing that
 * identifies a person, and refuses anything not on the event allowlist. It is
 * intentionally dull: the interesting rules live in the collection service.
 */
export const trackRouter = Router();

/**
 * What the browser tracker needs to behave correctly: whether consent is
 * required, how long a session may idle, and how the batch should be shaped.
 */
trackRouter.get('/analytics/config', (_req, res) => {
  ok(res, {
    enabled: true,
    requireConsent: env.analytics.requireConsent,
    sessionTimeoutMinutes: SESSION_INACTIVITY_MINUTES,
    maxBatchSize: 20,
    flushIntervalMs: 10_000,
    // The allowlist is published rather than duplicated in the client bundle, so
    // there is one definition of what a browser is permitted to report.
    events: EVENT_NAMES.filter((name) => EVENT_SPECS[name].authoritative !== 'server'),
    note:
      'Collection is first-party. Visitor and session identifiers are random values stored in your browser; no messages, credentials or precise locations are ever sent.',
  });
});

trackRouter.post(
  '/analytics/events',
  analyticsLimiter,
  (req, _res, next) => {
    // A cross-site form post is not a legitimate beacon: require JSON explicitly
    // so a browser form cannot write events into an authenticated session.
    if (!req.is('application/json')) {
      next(ApiError.badRequest('Analytics events must be posted as application/json.'));
      return;
    }
    next();
  },
  validateBody(analyticsIngestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as { visitorId?: string; events: unknown[] };
    const repo = createRepository();

    const isStaff = req.user?.role === 'admin' || req.user?.role === 'moderator';
    const result = await collectEvents(repo, body, {
      userId: req.user?.id ?? null,
      userAgent: req.header('user-agent') ?? null,
      ip: req.ip ?? null,
      // Staff traffic is flagged so it can be excluded from audience figures.
      internal: isStaff || Boolean(req.header('x-admin-token')),
    });

    ok(res, {
      accepted: result.accepted,
      duplicates: result.duplicates,
      rejected: result.rejected,
      // A short reason list helps a developer fix a bad beacon without the
      // endpoint becoming an oracle for what is stored.
      reasons: result.reasons,
    });
  }),
);

/**
 * Withdraws consent for one visitor: every raw event stored under that
 * identifier is erased. This is the counterpart of asking for consent at all.
 */
trackRouter.post(
  '/analytics/opt-out',
  analyticsLimiter,
  validateBody(analyticsOptOutSchema),
  asyncHandler(async (req, res) => {
    const { visitorId } = req.body as { visitorId: string };
    const erased = await createRepository().deleteAnalyticsEventsForVisitor(visitorId);
    ok(res, {
      erased,
      message:
        'Stored events for that visitor identifier have been deleted. Aggregate counts recomputed from now on will not include them.',
    });
  }),
);
