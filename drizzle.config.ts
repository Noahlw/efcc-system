import { defineConfig } from "drizzle-kit";

/**
 * Central schema ownership: `src/server/db/schema` is the single source of
 * truth for generated D1 migrations in `migrations/`.
 */
export default defineConfig({
  casing: "snake_case",
  dialect: "sqlite",
  out: "./migrations",
  schema: "./src/server/db/schema/index.ts",
});
