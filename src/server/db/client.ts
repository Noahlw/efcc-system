import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import * as accountSecuritySchema from "./schema/account-security";
import * as activitySchema from "./schema/activities";
import * as applicantSchema from "./schema/applicant-actions";
import * as applicationSchema from "./schema/applications";
import * as authSchema from "./schema/auth";
import * as identitySchema from "./schema/identity";
import * as noticeSchema from "./schema/notices";
import * as staffAccountSchema from "./schema/staff-accounts";

/** Central schema object: the one place Better Auth and EFCC tables are composed. */
export const schema = {
  ...authSchema,
  ...identitySchema,
  ...accountSecuritySchema,
  ...staffAccountSchema,
  ...applicationSchema,
  ...applicantSchema,
  ...activitySchema,
  ...noticeSchema,
};

/**
 * The one D1 binding backs native auth and every EFCC read/write.
 * Interactive transactions stay disabled for D1 (see drizzle.config.ts).
 */
export type Database = DrizzleD1Database<typeof schema>;

export const getDb = (): Database => drizzle(env.DB, { schema });
