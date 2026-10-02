import { defineConfig } from "drizzle-kit";

// Loaded by drizzle-kit. `npm run db:*` scripts load .env.local via --env-file-if-exists.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://alror:alror@localhost:5432/alror" },
  strict: true,
  verbose: false,
});
