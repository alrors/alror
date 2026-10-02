import "server-only";

// Central access to server environment variables (see .env.example).

const DEV_SECRET = "alror-dev-session-secret-change-me";
let warned = false;

export const env = {
  databaseUrl: () => process.env.DATABASE_URL || "postgres://alror:alror@localhost:5432/alror",
  redisUrl: () => process.env.REDIS_URL || "redis://localhost:6379",
  publicUrl: () => (process.env.ALROR_PUBLIC_URL || "http://localhost:3000").replace(/\/+$/, ""),
  sessionSecret: () => {
    const s = process.env.ALROR_SESSION_SECRET;
    if (s) return s;
    if (process.env.NODE_ENV === "production") throw new Error("ALROR_SESSION_SECRET must be set in production");
    if (!warned) {
      warned = true;
      console.warn("[alror] ALROR_SESSION_SECRET is not set; using an insecure development secret.");
    }
    return DEV_SECRET;
  },
  secureCookies: () => {
    if (process.env.ALROR_COOKIE_SECURE === "false") return false;
    if (process.env.ALROR_COOKIE_SECURE === "true") return true;
    return process.env.NODE_ENV === "production";
  },
  isProduction: () => process.env.NODE_ENV === "production",
};
