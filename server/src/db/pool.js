import pg from 'pg';
import { env } from '../env.js';

const { Pool } = pg;

export const adminPool = new Pool({
  connectionString: env.adminDatabaseUrl,
  max: 4,
});

export const appPool = new Pool({
  connectionString: env.appDatabaseUrl,
  max: 10,
});
