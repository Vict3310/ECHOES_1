import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { env } from '../env';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { storyLimiter } from '../middleware/rateLimit';
import { storeImage, uploadSingleImage } from '../services/uploads';

export const uploadsRouter = Router();

/**
 * Multer reports size and field failures through its own error type, which the
 * shared error handler would otherwise turn into a 500. Translated here so the
 * caller learns what was actually wrong.
 */
const acceptSingleImage: RequestHandler = (req, res, next) => {
  uploadSingleImage.single('image')(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        const mb = Math.round((env.uploads.maxBytes / (1024 * 1024)) * 10) / 10;
        next(ApiError.badRequest(`Images must be smaller than ${mb} MB.`));
        return;
      }
      next(ApiError.badRequest(`Upload rejected: ${error.code}.`));
      return;
    }

    next(error);
  });
};

/**
 * Stores one image and returns its public URL. Authentication is required because
 * anonymous uploads are an obvious way to fill somebody's disk.
 */
uploadsRouter.post(
  '/uploads',
  storyLimiter,
  requireAuth,
  acceptSingleImage,
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      throw ApiError.badRequest('Attach an image in the "image" field.');
    }

    // The bytes decide what this is; the client's filename and declared type do not.
    const stored = await storeImage(file.buffer);
    ok(res, stored, 201);
  }),
);
