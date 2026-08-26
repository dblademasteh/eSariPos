import { ApiError } from '../lib/api.js';

export function startGlobalRateLimit() {}

const WINDOW_MS = 15 * 60_000;
const MAX_PER_IP = 15;
const MAX_PER_IDENTITY = 10;

// Registration: stricter limit — 5 new tenants per IP per hour
const REG_WINDOW_MS = 60 * 60_000;
const REG_MAX_PER_IP = 5;
const regBuckets = new Map();

// General per-IP budget for the whole API (per minute), separate from the
// stricter auth buckets above.
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_MAX_PER_IP = 600;
const globalBuckets = new Map();

export function globalRateLimit(req, res, next) {
  const now = Date.now();
  if (globalBuckets.size >= 1000) {
    for (const [key, b] of globalBuckets) {
      if (now > b.resetAt) globalBuckets.delete(key);
    }
  }
  const key = req.ip || 'unknown';
  let bucket = globalBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + GLOBAL_WINDOW_MS };
    globalBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > GLOBAL_MAX_PER_IP) {
    return next(new ApiError(429, 'Too many requests - slow down'));
  }
  next();
}

const ipBuckets = new Map();
const identityBuckets = new Map();

function hit(map, key, max, now) {
  let bucket = map.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    map.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count > max;
}

function sweep(now) {
  for (const map of [ipBuckets, identityBuckets]) {
    if (map.size < 500) continue;
    for (const [key, b] of map) {
      if (now > b.resetAt) map.delete(key);
    }
  }
}

export function authRateLimit(req, res, next) {
  const now = Date.now();
  sweep(now);

  // req.ip respects app.set('trust proxy') when enabled; otherwise it is the
  // socket address, which cannot be spoofed.
  if (hit(ipBuckets, req.ip || 'unknown', MAX_PER_IP, now)) {
    return next(new ApiError(429, 'Too many attempts - try again later'));
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (
    slug &&
    email &&
    hit(identityBuckets, `${slug}:${email}`, MAX_PER_IDENTITY, now)
  ) {
    return next(new ApiError(429, 'Too many attempts - try again later'));
  }
  next();
}

export function registrationRateLimit(req, res, next) {
  const now = Date.now();
  // Sweep expired buckets
  if (regBuckets.size >= 200) {
    for (const [key, b] of regBuckets) {
      if (now > b.resetAt) regBuckets.delete(key);
    }
  }
  const key = req.ip || 'unknown';
  let bucket = regBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + REG_WINDOW_MS };
    regBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > REG_MAX_PER_IP) {
    return next(new ApiError(429, 'Too many accounts created - try again later'));
  }
  next();
}
