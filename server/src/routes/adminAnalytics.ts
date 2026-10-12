import { Router, type NextFunction, type Request, type Response } from 'express';
import { env } from '../env';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAdmin } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { createRepository } from '../repo';
import {
  adminUserStatusSchema,
  adminUsersQuerySchema,
  analyticsExportQuerySchema,
  analyticsRangeSchema,
} from '../schemas';
import { toCsv, type CsvColumn } from '../services/analytics/csv';
import {
  buildAiSection,
  buildCommerceSection,
  buildDiscovery,
  buildHealthSection,
  buildOverview,
  buildUsersSection,
} from '../services/analytics/dashboard';
import {
  loadAi,
  loadAllUsers,
  loadCommerce,
  loadCulture,
  loadPlatform,
  loadRange,
  loadUsers,
} from '../services/analytics/load';
import { resolveRange, type ResolvedRange } from '../services/analytics/range';
import { databaseConfigured } from '../env';
import { analysePlace } from '../services/knowledge';
import { alatpayStatus } from '../services/payments/alatpay';

export const adminAnalyticsRouter = Router();

/**
 * Two gates, not one.
 *
 * `requireAdmin` accepts the shared operator token or a moderator/admin session.
 * When ADMIN_EMAILS is configured, a *session* must additionally belong to one of
 * those addresses, so a stolen admin cookie is not by itself enough to read the
 * analytics or change an account. The token remains the break-glass path.
 */
function requireAnalyticsAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAdmin(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    if (req.user && env.adminEmails.length > 0) {
      const email = req.user.email.trim().toLowerCase();
      if (!env.adminEmails.includes(email)) {
        logger.warn({ actor: email, path: req.path }, 'analytics access refused by ADMIN_EMAILS allowlist');
        next(
          ApiError.forbidden(
            'This account is signed in as an administrator but is not on the ADMIN_EMAILS allowlist for analytics and account management.',
          ),
        );
        return;
      }
    }
    next();
  });
}

adminAnalyticsRouter.use(requireAnalyticsAdmin);

function actorOf(req: Request): string {
  return req.user?.email ?? 'admin-token';
}

function rangeFrom(req: Request): ResolvedRange {
  const query = req.query as { preset?: string; from?: string; to?: string };
  return resolveRange({ preset: query.preset, from: query.from, to: query.to });
}

/** Reads the small facts every section needs, once per request. */
async function coverageOf() {
  return createRepository().analyticsCoverage();
}

adminAnalyticsRouter.get(
  '/overview',
  validateQuery(analyticsRangeSchema),
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const range = rangeFrom(req);
    const [scan, coverage, commerce, culture, users, platform] = await Promise.all([
      loadRange(repo, range),
      coverageOf(),
      loadCommerce(repo),
      loadCulture(repo),
      loadAllUsers(repo),
      loadPlatform(repo, range),
    ]);

    ok(res, buildOverview({ scan, coverage, commerce, culture, users, platform }));
  }),
);

adminAnalyticsRouter.get(
  '/discovery',
  validateQuery(analyticsRangeSchema),
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const range = rangeFrom(req);
    const [scan, coverage, culture] = await Promise.all([
      loadRange(repo, range),
      coverageOf(),
      loadCulture(repo),
    ]);
    ok(res, buildDiscovery({ scan, culture, coverage }));
  }),
);

adminAnalyticsRouter.get(
  '/ai',
  validateQuery(analyticsRangeSchema),
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const range = rangeFrom(req);
    const [ai, scan, coverage] = await Promise.all([
      loadAi(repo, range),
      loadRange(repo, range),
      coverageOf(),
    ]);
    ok(res, buildAiSection({ ai, scan, coverage }));
  }),
);

adminAnalyticsRouter.get(
  '/commerce',
  validateQuery(analyticsRangeSchema),
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const range = rangeFrom(req);
    const [scan, coverage, commerce] = await Promise.all([
      loadRange(repo, range),
      coverageOf(),
      loadCommerce(repo),
    ]);
    ok(res, buildCommerceSection({ commerce, scan, coverage }));
  }),
);

adminAnalyticsRouter.get(
  '/health',
  validateQuery(analyticsRangeSchema),
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const range = rangeFrom(req);
    const [scan, coverage, platform, ai] = await Promise.all([
      loadRange(repo, range),
      coverageOf(),
      loadPlatform(repo, range),
      loadAi(repo, range),
    ]);

    ok(
      res,
      buildHealthSection({
        platform,
        ai,
        scan,
        coverage,
        store: databaseConfigured() ? 'postgres' : 'memory',
        uploadsNote:
          'Guide photographs are written to local disk. A multi-instance deployment needs object storage, and disk usage is not measured here.',
      }),
    );
  }),
);

adminAnalyticsRouter.get(
  '/users',
  validateQuery(adminUsersQuerySchema.extend(analyticsRangeSchema.shape)),
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const range = rangeFrom(req);
    const query = req.query as unknown as {
      q?: string;
      role?: 'visitor' | 'contributor' | 'organizer' | 'moderator' | 'admin';
      status?: 'active' | 'suspended';
      sort?: 'createdAt' | 'name' | 'email' | 'role';
      direction?: 'asc' | 'desc';
      page?: number;
      perPage?: number;
    };

    const perPage = query.perPage ?? 25;
    const page = query.page ?? 1;

    const [scan, coverage, all, directory] = await Promise.all([
      loadRange(repo, range),
      coverageOf(),
      loadAllUsers(repo),
      loadUsers(repo, {
        q: query.q ?? null,
        role: query.role ?? null,
        status: query.status ?? null,
        sort: query.sort ?? 'createdAt',
        direction: query.direction ?? 'desc',
        limit: perPage,
        offset: (page - 1) * perPage,
      }),
    ]);

    ok(
      res,
      buildUsersSection({ users: all, scan, coverage, page: { users: directory.users, total: directory.total } }),
    );
  }),
);

adminAnalyticsRouter.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const user = await repo.getUserById(req.params.id!);
    if (!user) throw ApiError.notFound('No account matches that id.');

    const range = resolveRange({ preset: '90d' });
    const [events, audit] = await Promise.all([
      repo.listAnalyticsEvents({
        from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString(),
      }),
      repo.listAudit(200),
    ]);

    const mine = events.filter((event) => event.userId === user.id);
    const byName = mine.reduce<Record<string, number>>((counts, event) => {
      counts[event.name] = (counts[event.name] ?? 0) + 1;
      return counts;
    }, {});

    ok(res, {
      range: { preset: '90d', from: range.from, to: range.to },
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        suspendedAt: user.suspendedAt,
        createdAt: user.createdAt,
      },
      activity: {
        events: mine.length,
        sessions: new Set(mine.map((event) => event.sessionId).filter(Boolean)).size,
        lastActiveAt: mine.reduce<string | null>(
          (latest, event) => (latest === null || event.occurredAt > latest ? event.occurredAt : latest),
          null,
        ),
        byName,
        recent: mine
          .slice()
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
          .slice(0, 25)
          .map((event) => ({
            name: event.name,
            at: event.occurredAt,
            path: event.path,
            device: event.device,
          })),
        note:
          mine.length === 0
            ? 'No events in the last 90 days. The account may predate collection, or may not have been used.'
            : null,
      },
      audit: audit.filter((entry) => entry.entityType === 'user' && entry.entityId === user.id).slice(0, 25),
      privacy: {
        note: 'Password hashes and reset tokens are never returned by this API.',
      },
    });
  }),
);

/**
 * Suspend or reactivate an account.
 *
 * Least privilege is enforced server-side: the role can only be changed by direct
 * database work, never through this API, so an administrator cannot promote
 * themselves or anyone else. Every change is written to the append-only audit log
 * with the actor and the reason.
 */
adminAnalyticsRouter.post(
  '/users/:id/status',
  validateBody(adminUserStatusSchema),
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body as { status: 'active' | 'suspended'; reason?: string };
    const repo = createRepository();
    const before = await repo.getUserById(req.params.id!);
    if (!before) throw ApiError.notFound('No account matches that id.');

    if (before.id === req.user?.id) {
      throw ApiError.forbidden('You cannot change the status of the account you are signed in with.');
    }

    const updated = await repo.updateUserStatus(before.id, status);
    if (!updated) throw ApiError.notFound('No account matches that id.');

    await repo.appendAudit({
      actor: actorOf(req),
      action: `user.${status === 'suspended' ? 'suspended' : 'reactivated'}`,
      entityType: 'user',
      entityId: updated.id,
      details: { previousStatus: before.status, reason: reason ?? null },
    });

    ok(res, {
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        status: updated.status,
        suspendedAt: updated.suspendedAt,
      },
      note:
        status === 'suspended'
          ? 'The account can no longer sign in. Sessions already issued remain valid until their token expires, because sessions are stateless.'
          : 'The account can sign in again.',
    });
  }),
);

adminAnalyticsRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number.parseInt(String(req.query.limit ?? '100'), 10) || 100, 500);
    ok(res, {
      audit: await createRepository().listAudit(limit),
      note: 'Audit rows are append-only: the database refuses to update or delete them.',
    });
  }),
);

/** Per-place detail behind the discovery rankings. */
adminAnalyticsRouter.get(
  '/places/:id',
  validateQuery(analyticsRangeSchema),
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const range = rangeFrom(req);
    const place = await repo.getPlace(req.params.id!);
    if (!place) throw ApiError.notFound('No cultural place matches that id.');

    const [events, stories] = await Promise.all([
      repo.listAnalyticsEvents({ from: range.from, to: range.to }),
      repo.listStoriesForPlace(place.id),
    ]);

    const views = events.filter(
      (event) => event.name === 'cultural_place_viewed' && event.resourceId === place.id,
    );
    const analysis = analysePlace(place);

    ok(res, {
      range: { from: range.from, to: range.to, label: range.label },
      place: {
        id: place.id,
        name: place.name,
        category: place.category,
        neighbourhood: place.neighbourhood ?? null,
        sources: place.sources.length,
        coverage: {
          coveredDimensions: analysis.coveredDimensions,
          totalDimensions: analysis.totalDimensions,
          needsResearch: analysis.needsResearch,
          gaps: analysis.gaps,
        },
      },
      views: {
        total: views.length,
        visitors: new Set(views.map((event) => event.visitorId).filter(Boolean)).size,
        byDevice: views.reduce<Record<string, number>>((counts, event) => {
          counts[event.device] = (counts[event.device] ?? 0) + 1;
          return counts;
        }, {}),
      },
      stories: {
        total: stories.length,
        approved: stories.filter((story) => story.status === 'approved').length,
        pending: stories.filter((story) => story.status === 'pending').length,
      },
      integrity: {
        note: 'Low or absent view counts describe what ECHOES has published and verified, not whether the place matters.',
      },
    });
  }),
);

// --- CSV export -------------------------------------------------------------

interface ExportDataset {
  columns: CsvColumn[];
  rows: Array<Record<string, unknown>>;
}

async function buildExport(dataset: string, range: ResolvedRange): Promise<ExportDataset> {
  const repo = createRepository();

  if (dataset === 'users') {
    const users = await loadAllUsers(repo);
    const scan = await loadRange(repo, range);
    const activity = new Map<string, { lastActiveAt: string | null; events: number }>();
    for (const event of scan.events) {
      if (!event.userId) continue;
      const entry = activity.get(event.userId) ?? { lastActiveAt: null, events: 0 };
      entry.events += 1;
      if (!entry.lastActiveAt || event.occurredAt > entry.lastActiveAt) entry.lastActiveAt = event.occurredAt;
      activity.set(event.userId, entry);
    }
    return {
      columns: [
        { key: 'id', header: 'id' },
        { key: 'name', header: 'name' },
        { key: 'email', header: 'email' },
        { key: 'role', header: 'role' },
        { key: 'status', header: 'status' },
        { key: 'createdAt', header: 'created_at' },
        { key: 'lastActiveAt', header: 'last_active_at' },
        { key: 'events', header: 'events_in_period' },
      ],
      rows: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        lastActiveAt: activity.get(user.id)?.lastActiveAt ?? '',
        events: activity.get(user.id)?.events ?? 0,
      })),
    };
  }

  if (dataset === 'ai') {
    const requests = await repo.listAiRequests({ from: range.from, to: range.to });
    return {
      columns: [
        { key: 'createdAt', header: 'created_at' },
        { key: 'feature', header: 'feature' },
        { key: 'model', header: 'model' },
        { key: 'ok', header: 'ok' },
        { key: 'status', header: 'status' },
        { key: 'latencyMs', header: 'latency_ms' },
        { key: 'promptTokens', header: 'prompt_tokens' },
        { key: 'completionTokens', header: 'completion_tokens' },
        { key: 'estimatedCostMicros', header: 'estimated_cost_usd_micros' },
        { key: 'errorKind', header: 'error_kind' },
      ],
      rows: requests.map((request) => ({
        createdAt: request.createdAt,
        feature: request.feature,
        model: request.model,
        ok: request.ok,
        status: request.status,
        latencyMs: request.latencyMs,
        promptTokens: request.promptTokens,
        completionTokens: request.completionTokens,
        estimatedCostMicros: request.estimatedCostMicros,
        errorKind: request.errorKind,
      })),
    };
  }

  if (dataset === 'audit') {
    const audit = await repo.listAudit(500);
    return {
      columns: [
        { key: 'createdAt', header: 'created_at' },
        { key: 'actor', header: 'actor' },
        { key: 'action', header: 'action' },
        { key: 'entityType', header: 'entity_type' },
        { key: 'entityId', header: 'entity_id' },
        { key: 'details', header: 'details' },
      ],
      rows: audit.map((entry) => ({
        createdAt: entry.createdAt,
        actor: entry.actor,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        details: entry.details ?? '',
      })),
    };
  }

  if (dataset === 'bookings') {
    const [bookings, experiences] = await Promise.all([repo.listBookings(), repo.listExperiences()]);
    const inRange = bookings.filter(
      (booking) => booking.createdAt >= range.from && booking.createdAt <= range.to,
    );
    return {
      columns: [
        { key: 'reference', header: 'reference' },
        { key: 'status', header: 'status' },
        { key: 'experienceTitle', header: 'experience' },
        { key: 'participants', header: 'participants' },
        { key: 'totalMinor', header: 'total_minor' },
        { key: 'currency', header: 'currency' },
        { key: 'createdAt', header: 'created_at' },
      ],
      rows: inRange.map((booking) => ({
        reference: booking.reference,
        status: booking.status,
        experienceTitle: experiences.find((e) => e.id === booking.experienceId)?.title ?? '',
        participants: booking.participants,
        totalMinor: booking.totalMinor,
        currency: booking.currency,
        createdAt: booking.createdAt,
      })),
    };
  }

  if (dataset === 'discovery') {
    const [culture, scan] = await Promise.all([loadCulture(repo), loadRange(repo, range)]);
    const counts = new Map<string, number>();
    for (const event of scan.events) {
      if (event.name !== 'cultural_place_viewed' || !event.resourceId) continue;
      counts.set(event.resourceId, (counts.get(event.resourceId) ?? 0) + 1);
    }
    return {
      columns: [
        { key: 'id', header: 'place_id' },
        { key: 'name', header: 'name' },
        { key: 'category', header: 'category' },
        { key: 'views', header: 'views_in_period' },
        { key: 'needsResearch', header: 'needs_research' },
      ],
      rows: culture.places.map((place) => ({
        id: place.id,
        name: place.name,
        category: place.category,
        views: counts.get(place.id) ?? 0,
        needsResearch: analysePlace(place).needsResearch,
      })),
    };
  }

  // overview: the KPI table itself, which is what an operator pastes into a report.
  const [scan, coverage, commerce, culture, users, platform] = await Promise.all([
    loadRange(repo, range),
    coverageOf(),
    loadCommerce(repo),
    loadCulture(repo),
    loadAllUsers(repo),
    loadPlatform(repo, range),
  ]);
  const overview = buildOverview({ scan, coverage, commerce, culture, users, platform });
  return {
    columns: [
      { key: 'id', header: 'metric' },
      { key: 'label', header: 'label' },
      { key: 'value', header: 'value' },
      { key: 'previous', header: 'previous_period' },
      { key: 'absoluteChange', header: 'absolute_change' },
      { key: 'percentChange', header: 'percent_change' },
      { key: 'unit', header: 'unit' },
      { key: 'freshness', header: 'freshness' },
      { key: 'source', header: 'source' },
      { key: 'definition', header: 'definition' },
    ],
    rows: overview.kpis.map((entry) => ({
      id: entry.id,
      label: entry.label,
      value: entry.value,
      previous: entry.previous,
      absoluteChange: entry.absoluteChange,
      percentChange: entry.percentChange,
      unit: entry.unit,
      freshness: entry.freshness,
      source: entry.source,
      definition: entry.definition,
    })),
  };
}

adminAnalyticsRouter.get(
  '/export',
  validateQuery(analyticsExportQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as { dataset: string; preset?: string; from?: string; to?: string };
    const range = resolveRange({ preset: query.preset, from: query.from, to: query.to });
    const dataset = await buildExport(query.dataset, range);

    // An export leaves the system, so it is recorded with who took it and when.
    await createRepository().appendAudit({
      actor: actorOf(req),
      action: 'analytics.exported',
      entityType: 'analytics',
      entityId: query.dataset,
      details: { from: range.from, to: range.to, rows: dataset.rows.length },
    });

    const filename = `echoes-${query.dataset}-${range.from.slice(0, 10)}-to-${range.to.slice(0, 10)}.csv`;
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('cache-control', 'no-store');
    res.send(toCsv(dataset.columns, dataset.rows));
  }),
);

/** Configuration facts the console shows without guessing. */
adminAnalyticsRouter.get('/meta', (_req, res) => {
  ok(res, {
    timezone: env.analytics.timezone,
    retentionDays: env.analytics.retentionDays,
    requireConsent: env.analytics.requireConsent,
    adminEmailsConfigured: env.adminEmails.length > 0,
    payments: alatpayStatus(),
    store: databaseConfigured() ? 'postgres' : 'memory',
  });
});
