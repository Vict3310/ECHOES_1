import rateLimit from 'express-rate-limit';
import { env } from '../env';

const disabled = env.isTest;

function limiter(options: { windowMs: number; max: number; message: string }) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => disabled,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'rate_limited', message: options.message },
      });
    },
  });
}

export const generalLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: 'Too many requests from this address. Please slow down.',
});

/** Model calls are expensive — keep them tightly bounded. */
export const aiLimiter = limiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'The cultural assistant is receiving a lot of requests. Please try again shortly.',
});

export const storyLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: 'Too many story submissions from this address. Please try again later.',
});

export const paymentLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many checkout attempts. Please try again shortly.',
});

/**
 * The tracker batches, so a busy visit still sends few requests. The ceiling is
 * generous enough not to lose real sessions and low enough that the endpoint
 * cannot be used as a write amplifier.
 */
export const analyticsLimiter = limiter({
  windowMs: 5 * 60 * 1000,
  max: 120,
  message: 'Too many analytics requests from this address.',
});

export const authLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts. Please try again later.',
});
