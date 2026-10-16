import crypto from 'node:crypto';

// Structured JSON logging (pino-shaped) with an optional Sentry pipeline.
// No external dependencies: one line of JSON per event on stdout.

function emit(level, msg, meta) {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg,
    ...(meta && Object.keys(meta).length ? { ...meta } : {}),
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (msg, meta = {}) => emit('info', msg, meta),
  warn: (msg, meta = {}) => emit('warn', msg, meta),
  error: (msg, meta = {}) => emit('error', msg, meta),
};

export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    emit('info', `${req.method} ${req.originalUrl}`, {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
}

// Best-effort Sentry capture via their envelope HTTP API when SENTRY_DSN is set.
export async function captureError(err, context = {}) {
  logger.error(err.message ?? String(err), { stack: err.stack?.split('\n').slice(0, 5), ...context });
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const match = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/);
    if (!match) return;
    const [, key, host, projectId] = match;
    await fetch(`https://${host}/api/${projectId}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=esaripos/1.0`,
      },
      body: [
        JSON.stringify({ event_id: crypto.randomUUID(), sent_at: new Date().toISOString() }),
        JSON.stringify({ level: 'error', message: err.message, extra: context }),
      ].join('\n'),
    });
  } catch {
    // monitoring must never break the request path
  }
}
