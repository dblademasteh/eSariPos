import pg from 'pg';
import { env } from '../env.js';

const { Pool } = pg;

pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

export const adminPool = new Pool({
  connectionString: env.adminDatabaseUrl,
  max: 4,
});

export const appPool = new Pool({
  connectionString: env.appDatabaseUrl,
  max: 10,
});
