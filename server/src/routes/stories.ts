import { Router } from 'express';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { validateBody } from '../middleware/validate';
import { storyLimiter } from '../middleware/rateLimit';
import { createRepository } from '../repo';
import { storySubmissionSchema } from '../schemas';
import { logger } from '../lib/logger';

export const storiesRouter = Router();

storiesRouter.post(
  '/stories',
  storyLimiter,
  validateBody(storySubmissionSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as ReturnType<typeof storySubmissionSchema.parse>;
    const repo = createRepository();

    if (input.placeId) {
      const place = await repo.getPlace(input.placeId);
      if (!place) throw ApiError.badRequest('That place does not exist in ECHOES.');
    }

    const place = input.placeId ? await repo.getPlace(input.placeId) : null;

    // Contributions about places carrying sensitive or restricted subject matter
    // are routed through the sensitive-content review path.
    const sensitiveCategories = new Set(['traditional-site', 'market']);
    const sensitivity =
      place && sensitiveCategories.has(place.category) && input.sensitivity === 'standard'
        ? 'sensitive'
        : input.sensitivity;

    const story = await repo.createStory({
      placeId: input.placeId ?? null,
      suggestedPlaceName: input.suggestedPlaceName ?? null,
      body: input.body,
      sourceContext: input.sourceContext,
      period: input.period ?? null,
      attribution: input.attribution,
      contributorName: input.contributorName ?? null,
      contributorEmail: input.contributorEmail ?? null,
      consentPublication: input.consentPublication,
      consentTerms: input.consentTerms,
      sensitivity,
      mediaUrls: input.mediaUrls,
    });

    await repo.appendAudit({
      actor: input.contributorEmail ?? 'anonymous-contributor',
      action: 'story.submitted',
      entityType: 'story',
      entityId: story.id,
      details: { placeId: story.placeId, sensitivity },
    });

    logger.info({ reference: story.reference, sensitivity }, 'Story submitted for moderation');

    ok(
      res,
      {
        reference: story.reference,
        status: story.status,
        sensitivity: story.sensitivity,
        message:
          story.sensitivity === 'restricted'
            ? 'Thank you. This contribution is restricted content and will not be published without an explicit review.'
            : 'Thank you. A moderator will review this contribution before anything is published.',
        reviewProcess: [
          'A moderator reads the submission and the source context.',
          'You may be asked for corrections or for a citation.',
          'If approved, the account is published with the attribution you chose.',
          'You can request a change or removal by quoting your reference.',
        ],
      },
      201,
    );
  }),
);

storiesRouter.get(
  '/stories/:reference',
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const story = await repo.getStory(req.params.reference!);
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';

    if (!story) throw ApiError.notFound('No submission matches that reference.');

    const owns = Boolean(email) && (story.contributorEmail ?? '').toLowerCase() === email;
    if (!owns && !req.user) {
      // Do not leak submission contents; confirm the reference exists only.
      ok(res, {
        reference: story.reference,
        status: story.status,
        note: 'Provide the email used for the submission to see its detail.',
      });
      return;
    }

    ok(res, {
      reference: story.reference,
      status: story.status,
      moderationNote: story.moderationNote,
      reviewedAt: story.reviewedAt,
      submittedAt: story.createdAt,
      placeId: story.placeId,
      body: story.body,
      attribution: story.attribution,
      sensitivity: story.sensitivity,
    });
  }),
);
