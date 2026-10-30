import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';
import { buildRouter } from './routes/index.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

/**
 * Builds the Express application without opening any database connection,
 * so it can be exercised in tests. `options.loadUser` replaces the database
 * user lookup in the auth middleware (tests only).
 */
export function createApp(options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);                      // Render / Netlify sit behind one proxy

  app.use(helmet());
  app.use(cors({
    origin(origin, cb) {
      // Allow non-browser clients (no Origin) and the configured front-ends only.
      if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', rateLimit({
    windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down a little.' } },
  }));

  app.get('/', (_req, res) => res.json({ service: 'CampusReserve API', docs: '/api/health' }));
  app.use('/api', buildRouter(options));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
