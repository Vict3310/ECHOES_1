import { Router } from 'express';
import type { Place } from '../domain/types';
import { distanceKm } from '../lib/geo';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { validateQuery } from '../middleware/validate';
import { createRepository } from '../repo';
import { nearbyQuerySchema, placesQuerySchema } from '../schemas';
import { analysePlace, SOURCES_CHECKED } from '../services/knowledge';

/**
 * Coverage for community dimensions is computed at read time from what is
 * actually published, so the map never shows stale moderation state.
 */
export function augmentCoverage(place: Place, approved: number, pending: number): Place {
  const coverage = { ...place.coverage };
  if (approved > 0) {
    coverage.communityStory = {
      status: 'available',
      evidence: `${approved} community account${approved === 1 ? '' : 's'} published after moderation review.`,
    };
  } else if (pending > 0) {
    coverage.communityStory = {
      status: 'awaiting_review',
      evidence: `${pending} submission${pending === 1 ? '' : 's'} awaiting moderation.`,
    };
  }
  return { ...place, coverage };
}

async function decorate(place: Place) {
  const repo = createRepository();
  const approved = await repo.listStoriesForPlace(place.id, 'approved');
  const pending = await repo.listStoriesForPlace(place.id, 'pending');
  const augmented = augmentCoverage(place, approved.length, pending.length);
  return {
    ...augmented,
    knowledge: analysePlace(augmented),
    publishedStories: approved.length,
    pendingStories: pending.length,
  };
}

export const placesRouter = Router();

placesRouter.get(
  '/places',
  validateQuery(placesQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as {
      category?: Place['category'];
      neighbourhood?: string;
      q?: string;
      needsResearch?: boolean;
      limit?: number;
      offset?: number;
    };
    const repo = createRepository();
    const places = await repo.listPlaces({
      category: query.category,
      neighbourhood: query.neighbourhood,
      query: query.q,
      needsResearch: query.needsResearch,
      limit: query.limit,
      offset: query.offset,
    });
    const decorated = await Promise.all(places.map(decorate));
    ok(res, {
      total: decorated.length,
      sourcesChecked: SOURCES_CHECKED,
      disclaimer:
        'Coverage describes the sources that were checked. A missing entry is not evidence that a place lacks history or that its community does not hold knowledge about it.',
      places: decorated,
    });
  }),
);

placesRouter.get(
  '/places/categories',
  asyncHandler(async (_req, res) => {
    const places = await createRepository().listPlaces({});
    const counts = new Map<string, number>();
    for (const place of places) {
      counts.set(place.category, (counts.get(place.category) ?? 0) + 1);
    }
    ok(res, {
      categories: [...counts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => a.category.localeCompare(b.category)),
    });
  }),
);

placesRouter.get(
  '/places/neighbourhoods',
  asyncHandler(async (_req, res) => {
    const places = await createRepository().listPlaces({});
    const counts = new Map<string, number>();
    for (const place of places) {
      counts.set(place.neighbourhood, (counts.get(place.neighbourhood) ?? 0) + 1);
    }
    ok(res, {
      neighbourhoods: [...counts.entries()]
        .map(([neighbourhood, count]) => ({ neighbourhood, count }))
        .sort((a, b) => a.neighbourhood.localeCompare(b.neighbourhood)),
    });
  }),
);

placesRouter.get(
  '/places/nearby',
  validateQuery(nearbyQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as { lat: number; lng: number; radiusKm?: number; limit?: number };
    const radiusKm = query.radiusKm ?? 5;
    const origin = { lat: query.lat, lng: query.lng };
    const places = await createRepository().listPlaces({});
    const nearby = places
      .map((place) => ({ place, distance: distanceKm(origin, place.coordinates) }))
      .filter((entry) => entry.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, query.limit ?? 20)
      .map((entry) => ({ ...entry.place, distanceKm: Number(entry.distance.toFixed(3)) }));
    ok(res, { centre: origin, radiusKm, places: nearby });
  }),
);

placesRouter.get(
  '/places/:id',
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const place = await repo.getPlace(req.params.id!);
    if (!place) throw ApiError.notFound('No cultural place matches that id.');

    const decorated = await decorate(place);
    const experiences = (await repo.listExperiences()).filter((e) => e.placeId === place.id);
    const all = await repo.listPlaces({});
    const nearby = all
      .filter((p) => p.id !== place.id)
      .map((p) => ({ place: p, distance: distanceKm(place.coordinates, p.coordinates) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5)
      .map((entry) => ({
        id: entry.place.id,
        name: entry.place.name,
        category: entry.place.category,
        distanceKm: Number(entry.distance.toFixed(2)),
      }));

    ok(res, {
      place: decorated,
      communityStories: await repo.listStoriesForPlace(place.id, 'approved'),
      experiences: experiences.map((experience) => ({
        ...experience,
        seatsRemaining: experience.schedules.map((schedule) => ({
          scheduleId: schedule.id,
          startsAt: schedule.startsAt,
          remaining: Math.max(0, schedule.capacity - schedule.booked),
        })),
      })),
      nearby,
      sourcesChecked: SOURCES_CHECKED,
    });
  }),
);

placesRouter.get(
  '/places/:id/knowledge',
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const place = await repo.getPlace(req.params.id!);
    if (!place) throw ApiError.notFound('No cultural place matches that id.');
    const approved = await repo.listStoriesForPlace(place.id, 'approved');
    const pending = await repo.listStoriesForPlace(place.id, 'pending');
    const augmented = augmentCoverage(place, approved.length, pending.length);
    ok(res, {
      analysis: analysePlace(augmented),
      sourcesChecked: SOURCES_CHECKED,
      framing:
        'These classifications describe the checked datasets only. They must never be read as a verdict on a community’s own knowledge of its history.',
    });
  }),
);

placesRouter.get(
  '/places/:id/stories',
  asyncHandler(async (req, res) => {
    const stories = await createRepository().listStoriesForPlace(req.params.id!, 'approved');
    ok(res, {
      stories: stories.map((story) => ({
        id: story.id,
        reference: story.reference,
        body: story.body,
        period: story.period,
        sourceContext: story.sourceContext,
        attribution: story.attribution,
        contributor:
          story.attribution === 'anonymous'
            ? 'Anonymous contributor'
            : story.attribution === 'pseudonym'
              ? (story.contributorName ?? 'Pseudonymous contributor')
              : (story.contributorName ?? 'Contributor'),
        reviewedAt: story.reviewedAt,
        status: story.status,
      })),
      notice:
        'Community accounts are published after moderation. They are community testimony, not historically verified fact.',
    });
  }),
);
