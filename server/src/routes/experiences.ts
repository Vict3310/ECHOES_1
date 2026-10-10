import { Router } from 'express';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { createRepository } from '../repo';
import { alatpayStatus } from '../services/payments/alatpay';

function availability(schedule: { id: string; startsAt: string; capacity: number; booked: number }, bookedNow: number) {
  const taken = schedule.booked + bookedNow;
  return {
    scheduleId: schedule.id,
    startsAt: schedule.startsAt,
    capacity: schedule.capacity,
    remaining: Math.max(0, schedule.capacity - taken),
    soldOut: taken >= schedule.capacity,
  };
}

export const experiencesRouter = Router();

experiencesRouter.get(
  '/experiences',
  asyncHandler(async (_req, res) => {
    const repo = createRepository();
    const experiences = await repo.listExperiences();
    const places = await repo.listPlaces({});

    const enriched = await Promise.all(
      experiences.map(async (experience) => {
        const place = places.find((p) => p.id === experience.placeId);
        const schedules = await Promise.all(
          experience.schedules.map(async (schedule) =>
            availability(schedule, await repo.seatsBooked(schedule.id)),
          ),
        );
        return {
          ...experience,
          placeName: place?.name ?? null,
          neighbourhood: place?.neighbourhood ?? null,
          sourceLinks: place?.sources ?? [],
          schedules,
          bookedOut: schedules.every((s) => s.soldOut),
        };
      }),
    );

    ok(res, {
      experiences: enriched,
      provider: alatpayStatus(),
      notice:
        'Every listing marked isSampleData is placeholder content, not a real operator, and cannot be sold. Real listings require a verified operator with written consent.',
    });
  }),
);

experiencesRouter.get(
  '/experiences/:id',
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const experience = await repo.getExperience(req.params.id!);
    if (!experience) throw ApiError.notFound('No experience matches that id.');
    const place = await repo.getPlace(experience.placeId);
    const schedules = await Promise.all(
      experience.schedules.map(async (schedule) => availability(schedule, await repo.seatsBooked(schedule.id))),
    );

    ok(res, {
      experience: {
        ...experience,
        placeName: place?.name ?? null,
        placeSummary: place?.summary ?? null,
        sourceLinks: place?.sources ?? [],
        schedules,
      },
      provider: alatpayStatus(),
    });
  }),
);
