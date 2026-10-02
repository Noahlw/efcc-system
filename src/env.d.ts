/**
 * Local-only configuration supplied by `.dev.vars` (never committed).
 * Bindings declared in wrangler.jsonc come from worker-configuration.d.ts.
 */
declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_TRUSTED_ORIGINS?: string;
    /** Test-harness-only synthetic setup token; absent in committed configuration. */
    SEED_TOKEN?: string;
  }
}
