import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { logger } from '../lib/http.js';

const pools = new Map();
const namedZones = new Map(); // dbName -> whether MySQL's time-zone tables are loaded
const warned = new Set();

export const isValidDbName = (name) => /^[A-Za-z0-9_]{1,64}$/.test(String(name || ''));
export const hasDedicatedCredentials = (dbName) => Boolean(config.mysql.projectCredentials[dbName]);

export function getPool(dbName) {
  if (!isValidDbName(dbName)) throw new Error(`Invalid database name "${dbName}"`);
  const existing = pools.get(dbName);
  if (existing) return existing;

  const dedicated = config.mysql.projectCredentials[dbName];
  if (!dedicated && !warned.has(dbName)) {
    warned.add(dbName);
    logger.warn({ dbName }, 'No dedicated read-only MySQL user for this project; isolation relies on the SQL guard alone. Run `npm run grants`.');
  }
  const creds = dedicated || { user: config.mysql.user, password: config.mysql.password };
  const pool = mysql.createPool({
    host: config.mysql.host,
    port: config.mysql.port,
    user: creds.user,
    password: creds.password,
    database: dbName,
    connectionLimit: config.mysql.poolSize,
    maxIdle: 1,
    idleTimeout: 60_000,
    queueLimit: 100,
    dateStrings: true,
    decimalNumbers: true,
    supportBigNumbers: true,
    multipleStatements: false,
    charset: 'utf8mb4',
  });
  pools.set(dbName, pool);
  return pool;
}

export function utcOffset(timeZone, date = new Date()) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const m = part.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || '00'}` : '+00:00';
}

const SESSION_SQL = 'SET SESSION time_zone = ?, SESSION max_execution_time = ?, SESSION transaction_read_only = ON';

async function prepareSession(conn, dbName, timeZone) {
  const timeout = config.mysql.queryTimeoutMs;
  if (namedZones.get(dbName) !== false) {
    try {
      await conn.query(SESSION_SQL, [timeZone, timeout]);
      namedZones.set(dbName, true);
      return;
    } catch (err) {
      if (err.errno !== 1298) throw err; // 1298 = unknown time zone (tz tables not loaded)
      namedZones.set(dbName, false);
      logger.warn({ dbName, timeZone }, 'MySQL time-zone tables are not loaded; using a UTC offset instead (no DST)');
    }
  }
  await conn.query(SESSION_SQL, [utcOffset(timeZone), timeout]);
}

// Runs a read-only query in the project's time zone. Every session is
// transaction_read_only, so even a misconfigured user cannot write.
export async function readQuery(dbName, sql, { timeZone = config.defaultTimezone, params } = {}) {
  const conn = await getPool(dbName).getConnection();
  try {
    await prepareSession(conn, dbName, timeZone);
    const started = Date.now();
    const [rows, fields] = await conn.query({ sql, values: params, timeout: config.mysql.queryTimeoutMs + 2000 });
    return {
      rows: Array.isArray(rows) ? rows : [],
      fields: (fields || []).map((f) => ({ name: f.name, type: f.columnType ?? f.type })),
      ms: Date.now() - started,
    };
  } finally {
    conn.release();
  }
}

export async function closeMysql() {
  await Promise.allSettled([...pools.values()].map((p) => p.end()));
  pools.clear();
}
