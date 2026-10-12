import { Router } from 'express';
import type { GuideProfile } from '../domain/types';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createRepository } from '../repo';
import { guideProfileSchema } from '../schemas';

function serializeGuide(guide: GuideProfile) {
  return {
    id: guide.id,
    name: guide.name,
    role: guide.role,
    city: guide.city,
    rating: guide.rating,
    specialties: guide.specialties,
    bio: guide.bio,
    availability: guide.availability,
    priceFrom: guide.priceFrom,
    avatarUrl: guide.avatarUrl,
    status: guide.status,
    moderationNote: guide.moderationNote,
    reviewedBy: guide.reviewedBy,
    reviewedAt: guide.reviewedAt,
    createdAt: guide.createdAt,
    updatedAt: guide.updatedAt,
  };
}

export const guidesRouter = Router();

guidesRouter.get(
  '/guides',
  asyncHandler(async (_req, res) => {
    const repo = createRepository();
    const guides = await repo.listGuideProfiles('approved');
    ok(res, { guides: guides.map(serializeGuide) });
  }),
);

guidesRouter.get(
  '/guides/:id',
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const guide = await repo.getGuideProfile(req.params.id!);
    if (!guide) throw ApiError.notFound('No guide profile matches that id.');
    if (guide.status !== 'approved') {
      throw ApiError.notFound('This guide profile is not yet approved for public listing.');
    }
    ok(res, { guide: serializeGuide(guide) });
  }),
);

guidesRouter.post(
  '/guides',
  requireAuth,
  validateBody(guideProfileSchema),
  asyncHandler(async (req, res) => {
    if (req.user?.role !== 'organizer' && req.user?.role !== 'admin') {
      throw ApiError.forbidden('Only approved guide organizers can create guide profiles.');
    }

    const repo = createRepository();
    const guide = await repo.createGuideProfile({
      name: req.body.name,
      email: req.user?.email ?? null,
      role: req.body.role,
      city: req.body.city,
      specialties: req.body.specialties,
      bio: req.body.bio,
      availability: req.body.availability ?? 'Flexible',
      priceFrom: req.body.priceFrom ?? '₦15,000',
      avatarUrl: req.body.avatarUrl ?? null,
      status: 'pending',
    });

    ok(res, { guide: serializeGuide(guide) }, 201);
  }),
);
