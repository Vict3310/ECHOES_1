import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './env';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { generalLimiter } from './middleware/rateLimit';
import { optionalAuth } from './middleware/auth';
import { aiRouter } from './routes/ai';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { bookingsRouter } from './routes/bookings';
import { experiencesRouter } from './routes/experiences';
import { healthRouter } from './routes/health';
import { itineraryRouter } from './routes/itinerary';
import { paymentsRouter } from './routes/payments';
import { placesRouter } from './routes/places';
import { storiesRouter } from './routes/stories';

function isAllowedCorsOrigin(origin: string): boolean {
  if (env.corsOrigins.includes(origin)) return true;

  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')) {
      return true;
    }
    if (hostname === 'echoes-1.vercel.app' || hostname.endsWith('.vercel.app')) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false, // The SPA is served separately; CSP is set there.
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true); // server-to-server / curl
        if (isAllowedCorsOrigin(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
      },
      credentials: true,
      maxAge: 600,
    }),
  );

  app.use((req, res, next) => {
    if (req.path === '/api/payments/webhook') {
      // Webhook signature verification needs the exact bytes that were sent.
      express.raw({ type: '*/*', limit: '256kb' })(req, res, next);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '128kb' }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));

  if (!env.isTest) {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/api/health' },
      }),
    );
  }

  app.use(optionalAuth);
  app.use('/api', generalLimiter);

  app.get('/', (_req, res) => {
    res.json({
      name: 'ECHOES API',
      description: 'Cultural discovery, grounded AI guidance, real routing and verified experience payments for Lagos.',
      primaryModel: 'Gemma',
      endpoints: [
        '/api/health',
        '/api/places',
        '/api/places/:id',
        '/api/experiences',
        '/api/stories',
        '/api/bookings',
        '/api/payments/webhook',
        '/api/ai/answer',
        '/api/itineraries/plan',
        '/api/directions',
        '/api/admin/overview',
      ],
    });
  });

  app.use('/api', healthRouter);
  app.use('/api', placesRouter);
  app.use('/api', experiencesRouter);
  app.use('/api', storiesRouter);
  app.use('/api', bookingsRouter);
  app.use('/api', paymentsRouter);
  app.use('/api', aiRouter);
  app.use('/api', itineraryRouter);
  app.use('/api', authRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
