import { z } from 'zod';

export const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const placeCategorySchema = z.enum([
  'historical-architecture',
  'heritage-site',
  'cultural-landmark',
  'museum',
  'market',
  'public-art',
  'traditional-site',
]);

export const placesQuerySchema = z.object({
  category: placeCategorySchema.optional(),
  neighbourhood: z.string().max(80).optional(),
  q: z.string().max(160).optional(),
  needsResearch: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional(),
});

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const storySubmissionSchema = z
  .object({
    placeId: z.string().min(1).max(80).nullable().optional(),
    suggestedPlaceName: z.string().min(2).max(160).nullable().optional(),
    body: z.string().min(40, 'Please write at least 40 characters.').max(6000),
    sourceContext: z.string().min(10, 'Tell reviewers where this account comes from.').max(2000),
    period: z.string().max(120).nullable().optional(),
    attribution: z.enum(['full_name', 'pseudonym', 'anonymous']),
    contributorName: z.string().max(120).nullable().optional(),
    contributorEmail: z.string().email().max(200).nullable().optional(),
    consentPublication: z.literal(true, {
      errorMap: () => ({ message: 'Publication consent is required before a story can be reviewed.' }),
    }),
    consentTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the contribution terms.' }),
    }),
    sensitivity: z.enum(['standard', 'sensitive', 'restricted']).default('standard'),
    mediaUrls: z.array(z.string().url().max(500)).max(6).default([]),
  })
  .refine((value) => Boolean(value.placeId || value.suggestedPlaceName), {
    message: 'Choose an existing place or suggest a new one.',
    path: ['placeId'],
  });

export const moderationSchema = z.object({
  status: z.enum(['approved', 'rejected', 'needs_correction', 'pending']),
  moderationNote: z.string().max(2000).nullable().optional(),
  reviewedBy: z.string().email().max(200).optional(),
});

export const bookingSchema = z.object({
  experienceId: z.string().min(1).max(80),
  scheduleId: z.string().min(1).max(80),
  participants: z.number().int().min(1).max(20),
  customerName: z.string().min(2).max(120),
  customerEmail: z.string().email().max(200),
  customerPhone: z.string().max(40).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const askSchema = z.object({
  question: z.string().min(3).max(600),
  placeId: z.string().max(80).nullable().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      }),
    )
    .max(10)
    .optional(),
});

export const narrationSchema = z.object({
  placeId: z.string().min(1).max(80),
});

export const directionsSchema = z.object({
  from: coordinateSchema,
  to: coordinateSchema,
  mode: z.enum(['walking', 'driving']).default('driving'),
});

export const itinerarySchemaInput = z.object({
  start: coordinateSchema.extend({ label: z.string().min(1).max(160) }),
  interests: z.array(z.string().max(60)).max(10).default([]),
  availableMinutes: z.number().int().min(45).max(1440),
  transportMode: z.enum(['walking', 'driving']).default('walking'),
  maxStops: z.number().int().min(1).max(8).default(4),
  accessibilityNotes: z.string().max(400).optional(),
  budgetMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
});

export const registerSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(2).max(120),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
});

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
