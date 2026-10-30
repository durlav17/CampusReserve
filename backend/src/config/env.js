// Centralised, validated configuration. The process refuses to start with an
// unsafe production configuration instead of failing later at request time.
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Node does not read .env by itself. Load backend/.env when it exists; variables
// already set in the environment (Render, CI, the shell) always take precedence.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  TZ: z.string().default('Asia/Kolkata'),

  // Oracle connection. DB_CONNECT_STRING accepts an Easy Connect string
  // (localhost:1521/XEPDB1), a TNS alias, or a full descriptor for
  // Autonomous Database (walletless TLS).
  DB_USER: z.string().min(1).default('campus'),
  DB_PASSWORD: z.string().default(''),
  DB_CONNECT_STRING: z.string().min(1).default('localhost:1521/XEPDB1'),
  DB_WALLET_DIR: z.string().optional(),          // only for mTLS wallets
  DB_WALLET_PASSWORD: z.string().optional(),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(8),

  JWT_SECRET: z.string().default(''),
  JWT_EXPIRES_IN: z.string().default('8h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(10),

  // Comma-separated list of allowed browser origins.
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProduction: parsed.data.NODE_ENV === 'production',
};

// Development gets a throw-away secret so the app can start; production must set one.
if (!env.JWT_SECRET) {
  if (env.isProduction) {
    console.error('JWT_SECRET must be set (at least 32 random characters) in production.');
    process.exit(1);
  }
  env.JWT_SECRET = 'dev-only-insecure-secret-change-me-0123456789';
}
if (env.isProduction && env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET is too short; use at least 32 random characters.');
  process.exit(1);
}

if (env.isProduction) {
  if (!env.DB_PASSWORD) {
    console.error('DB_PASSWORD must be set in production.');
    process.exit(1);
  }
  // A cloud host cannot reach a database on a developer's machine.
  if (/localhost|127\.0\.0\.1|\[?::1\]?/i.test(env.DB_CONNECT_STRING)) {
    console.error('DB_CONNECT_STRING must point at a reachable Oracle database in production, not localhost.');
    process.exit(1);
  }
}

process.env.TZ = env.TZ;
