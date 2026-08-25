import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT || 4000),
  trustProxy: ['1', 'true'].includes(String(process.env.TRUST_PROXY).toLowerCase()),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  adminDatabaseUrl:
    process.env.ADMIN_DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/pos',
  appDatabaseUrl:
    process.env.APP_DATABASE_URL ||
    'postgresql://pos_app:pos_app@localhost:5433/pos',
};

if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-me') {
    throw new Error('JWT_SECRET must be set to a strong random value in production');
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
} else if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET not set - using insecure development default');
}
