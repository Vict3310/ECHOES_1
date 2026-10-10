import { Router } from 'express';
import { env } from '../env';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { aiLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { createRepository } from '../repo';
import { directionsSchema, itinerarySchemaInput } from '../schemas';
import { planItinerary } from '../services/itinerary';
import { calculateRoute, googleMapsDirectionsUrl } from '../services/routing';

export const itineraryRouter = Router();

itineraryRouter.post(
  '/directions',
  validateBody(directionsSchema),
  asyncHandler(async (req, res) => {
    const { from, to, mode } = req.body as {
      from: { lat: number; lng: number };
      to: { lat: number; lng: number };
      mode: 'walking' | 'driving';
    };

    const route = await calculateRoute(from, to, mode);
    ok(res, {
      ...route,
      googleMapsUrl: googleMapsDirectionsUrl(from, to, mode),
      navigationNote:
        'Turn-by-turn navigation is performed by Google Maps when you open that link. ECHOES displays the route geometry and the provider’s own distance and duration.',
    });
  }),
);

itineraryRouter.post(
  '/itineraries/plan',
  aiLimiter,
  validateBody(itinerarySchemaInput),
  asyncHandler(async (req, res) => {
    const input = req.body as {
      start: { lat: number; lng: number; label: string };
      interests: string[];
      availableMinutes: number;
      transportMode: 'walking' | 'driving';
      maxStops: number;
      accessibilityNotes?: string;
      budgetMinor?: number | null;
    };

    const repo = createRepository();
    const places = await repo.listPlaces({});
    if (places.length === 0) {
      throw ApiError.serviceUnavailable('no_places', 'No cultural places are loaded, so no itinerary can be built.');
    }

    const result = await planItinerary(
      {
        start: input.start,
        interests: input.interests,
        availableMinutes: input.availableMinutes,
        transportMode: input.transportMode,
        maxStops: input.maxStops,
        accessibilityNotes: input.accessibilityNotes,
        budgetMinor: input.budgetMinor ?? null,
        currency: env.currency,
      },
      places,
    );

    ok(res, {
      ...result,
      notes: {
        travelTimeSource:
          result.totals.travelSeconds === null
            ? 'unavailable'
            : `${env.routing.provider} (${input.transportMode})`,
        visitDurationsAreSuggestions: true,
        openingHours: 'Opening hours are not stored in ECHOES, so no opening-hours feasibility claim is made.',
        liveTraffic: 'Travel estimates do not include live traffic.',
      },
    });
  }),
);
