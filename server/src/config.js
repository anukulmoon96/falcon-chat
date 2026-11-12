import { z } from 'zod';

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment (Docker, ECS, CI).
}

const bool = (fallback) => z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? fallback : ['true', '1', 'yes'].includes(v.trim().toLowerCase())));

const json = (fallback) => z.string().optional().transform((v, ctx) => {
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be valid JSON' });
    return z.NEVER;
  }
});

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_BASE_URL: z.string().default('http://localhost:4000'),
  WEB_PORTAL_URL: z.string().optional(),
  SERVE_WEB_DIR: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),

  MONGO_URI: z.string().default('mongodb://localhost:27017'),
  MONGO_DB: z.string().default('Falcon'),

  MYSQL_HOST: z.string().default('localhost'),
  MYSQL_PORT: z.coerce.number().default(3306),
  MYSQL_USER: z.string().default('falcon_ro'),
  MYSQL_PASSWORD: z.string().default(''),
  MYSQL_PROJECT_CREDENTIALS: json({}),
  MYSQL_POOL_SIZE: z.coerce.number().default(4),
  MYSQL_QUERY_TIMEOUT_MS: z.coerce.number().default(15000),
  MYSQL_MAX_ROWS: z.coerce.number().default(2000),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  COOKIE_SECURE: bool(false),
  MEDIA_TOKEN_TTL_HOURS: z.coerce.number().default(24),
  MEDIA_ALLOWED_HOSTS: z.string().default(''),

  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_GENAI_USE_VERTEXAI: bool(false),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_CLOUD_LOCATION: z.string().default('global'),
  GEMINI_SQL_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_FAST_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_THINKING_LEVEL: z.string().optional(),
  GEMINI_TEMPERATURE: z.coerce.number().optional(),

  ASSISTANT_NAME: z.string().default('DIVA'),
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
  WORKER_ENABLED: bool(true),
  WORKER_CONCURRENCY: z.coerce.number().default(3),

  WHATSAPP_ENABLED: bool(false),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v23.0'),

  TEAMS_ENABLED: bool(false),
  TEAMS_APP_ID: z.string().optional(),
  TEAMS_APP_PASSWORD: z.string().optional(),
  TEAMS_TENANT_ID: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}
const env = parsed.data;

const missing = [];
if (env.WHATSAPP_ENABLED) {
  for (const k of ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET']) if (!env[k]) missing.push(k);
}
if (env.TEAMS_ENABLED) {
  for (const k of ['TEAMS_APP_ID', 'TEAMS_APP_PASSWORD']) if (!env[k]) missing.push(k);
}
if (!env.GEMINI_API_KEY && !(env.GOOGLE_GENAI_USE_VERTEXAI && env.GOOGLE_CLOUD_PROJECT)) {
  missing.push('GEMINI_API_KEY (or GOOGLE_GENAI_USE_VERTEXAI=true with GOOGLE_CLOUD_PROJECT)');
}
if (missing.length) throw new Error(`Missing required settings:\n  ${missing.join('\n  ')}`);

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, ''),
  webPortalUrl: (env.WEB_PORTAL_URL || env.PUBLIC_BASE_URL).replace(/\/$/, ''),
  serveWebDir: env.SERVE_WEB_DIR,
  logLevel: env.LOG_LEVEL,
  assistantName: env.ASSISTANT_NAME,
  defaultTimezone: env.DEFAULT_TIMEZONE,
  mongo: { uri: env.MONGO_URI, db: env.MONGO_DB },
  mysql: {
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    projectCredentials: env.MYSQL_PROJECT_CREDENTIALS,
    poolSize: env.MYSQL_POOL_SIZE,
    queryTimeoutMs: env.MYSQL_QUERY_TIMEOUT_MS,
    maxRows: env.MYSQL_MAX_ROWS,
  },
  auth: {
    jwtSecret: env.JWT_SECRET,
    sessionTtlHours: env.SESSION_TTL_HOURS,
    cookieSecure: env.COOKIE_SECURE,
  },
  media: {
    ttlHours: env.MEDIA_TOKEN_TTL_HOURS,
    allowedHosts: env.MEDIA_ALLOWED_HOSTS.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY,
    vertex: env.GOOGLE_GENAI_USE_VERTEXAI,
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.GOOGLE_CLOUD_LOCATION,
    sqlModel: env.GEMINI_SQL_MODEL,
    fastModel: env.GEMINI_FAST_MODEL,
    thinkingLevel: env.GEMINI_THINKING_LEVEL,
    temperature: env.GEMINI_TEMPERATURE,
  },
  worker: { enabled: env.WORKER_ENABLED, concurrency: env.WORKER_CONCURRENCY },
  whatsapp: {
    enabled: env.WHATSAPP_ENABLED,
    token: env.WHATSAPP_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    appSecret: env.WHATSAPP_APP_SECRET,
    apiVersion: env.WHATSAPP_API_VERSION,
  },
  teams: {
    enabled: env.TEAMS_ENABLED,
    appId: env.TEAMS_APP_ID,
    appPassword: env.TEAMS_APP_PASSWORD,
    tenantId: env.TEAMS_TENANT_ID,
  },
};

// Channels need media links Meta and Microsoft can fetch (public HTTPS).
export const hasPublicMedia = () => /^https:\/\//.test(config.publicBaseUrl) && !/localhost|127\.0\.0\.1/.test(config.publicBaseUrl);
