import pino from 'pino';
import { env } from '../env';

export const logger = pino({
  level: env.isTest ? 'silent' : env.isProduction ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-admin-token"]',
      'res.headers["set-cookie"]',
      'password',
      '*.password',
      'secretKey',
      '*.secretKey',
      'apiKey',
      '*.apiKey',
      'cardNumber',
      '*.cardNumber',
      'cvv',
      '*.cvv',
    ],
    censor: '[redacted]',
  },
});
