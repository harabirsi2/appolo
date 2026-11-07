import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_COOKIE: z.string().min(1).default("appolo_session"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MIGRATE_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional().transform((v) => (v ? v : undefined)),
  SEED_EMAIL: z.string().email().optional(),
  SEED_PASSWORD: z.string().min(8).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset the cache (tests only). */
export function resetEnvCache(): void {
  cached = null;
}