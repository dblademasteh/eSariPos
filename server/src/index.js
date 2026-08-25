import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { env } from './env.js';
import { ApiError } from './lib/api.js';
import { logger, requestLogger, captureError } from './lib/logger.js';
import { requireAuth, withTenantSession } from './middleware/auth.js';
import { authRateLimit, globalRateLimit } from './middleware/rateLimit.js';
import { authRouter } from './routes/auth.routes.js';
import { productsRouter } from './routes/products.routes.js';
import { categoriesRouter } from './routes/categories.routes.js';
import { customersRouter } from './routes/customers.routes.js';
import { ordersRouter } from './routes/orders.routes.js';
import { reportsRouter } from './routes/reports.routes.js';
import { staffRouter } from './routes/staff.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { giftCardsRouter } from './routes/giftcards.routes.js';
import { suppliersRouter } from './routes/suppliers.routes.js';
import { purchasesRouter } from './routes/purchases.routes.js';
import { countsRouter } from './routes/counts.routes.js';
import { locationsRouter } from './routes/locations.routes.js';
import { cashSessionsRouter } from './routes/cashsessions.routes.js';
import { timeclockRouter } from './routes/timeclock.routes.js';
import { auditRouter } from './routes/audit.routes.js';
import { couponsRouter } from './routes/customers.routes.js';
import { startDigestScheduler } from './lib/digest.js';
import { platformKeysRouter, platformRouter } from './routes/platform.routes.js';
import { webhooksRouter } from './routes/webhooks.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
if (env.trustProxy) app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use(globalRateLimit);
app.use('/api/auth/login', authRateLimit);
app.use('/api/auth/register', authRateLimit);
app.use('/api/auth', authRouter);

const guarded = express.Router();
guarded.use(requireAuth, withTenantSession);
guarded.use('/products', productsRouter);
guarded.use('/categories', categoriesRouter);
guarded.use('/customers', customersRouter);
guarded.use('/orders', ordersRouter);
guarded.use('/reports', reportsRouter);
guarded.use('/staff', staffRouter);
guarded.use('/settings', settingsRouter);
guarded.use('/gift-cards', giftCardsRouter);
guarded.use('/suppliers', suppliersRouter);
guarded.use('/purchases', purchasesRouter);
guarded.use('/counts', countsRouter);
guarded.use('/locations', locationsRouter);
guarded.use('/cash-sessions', cashSessionsRouter);
guarded.use('/timeclock', timeclockRouter);
guarded.use('/audit', auditRouter);
guarded.use('/coupons', couponsRouter);
guarded.use('/api-keys', platformKeysRouter);
guarded.use('/webhooks', webhooksRouter);
app.use('/api/platform', platformRouter);
app.use('/api', guarded);

const dist = path.join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((req, _res, next) => next(new ApiError(404, 'Not found')));

app.use((err, _req, res, _next) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('request error', { code: err.code, constraint: err.constraint, message: err.message });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.code === '23505') return res.status(409).json({ error: 'That value already exists' });
  if (err.code === '23503') return res.status(400).json({ error: 'Related record not found' });
  if (err.code === '23514') return res.status(400).json({ error: 'Value out of allowed range' });
  captureError(err, { url: _req?.originalUrl });
  res.status(500).json({
    error: 'Something went wrong',
    ...(process.env.NODE_ENV !== 'production'
      ? { detail: String(err.message ?? err), stack: err.stack?.split('\n').slice(0, 4) }
      : {}),
  });
});

app.listen(env.port, () => {
  console.log(`NovaPOS API listening on http://localhost:${env.port}`);
  startDigestScheduler();
});
