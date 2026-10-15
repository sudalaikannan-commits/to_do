import dotenv from "dotenv";
dotenv.config();

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  cookieName: process.env.COOKIE_NAME ?? "ationic_token",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  cookieSecure: (process.env.COOKIE_SECURE ?? "false") === "true",
  adminEmail: process.env.ADMIN_EMAIL ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  adminName: process.env.ADMIN_NAME ?? "Ationic Admin",
  isProd: (process.env.NODE_ENV ?? "development") === "production",
};

export function assertJwtSecret() {
  if (config.isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
    throw new Error("JWT_SECRET must be set to a strong random value (>=32 chars) in production.");
  }
}
