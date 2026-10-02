import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";

import { canonicalNameKey } from "@/features/identity/name-matching";
import type { AppAuth } from "@/server/auth";
import { getAuth } from "@/server/auth";
import type { Database } from "@/server/db/client";
import { getDb } from "@/server/db/client";
import type {
  EnrolmentStatus,
  InvitationState,
} from "@/server/db/schema/activities";
import {
  department,
  enrolment,
  invitation,
  program,
  programEvent,
} from "@/server/db/schema/activities";
import { user } from "@/server/db/schema/auth";
import type { MembershipStatus } from "@/server/db/schema/identity";
import { personProfile } from "@/server/db/schema/identity";
import type { NoticeScope } from "@/server/db/schema/notices";
import {
  departmentManagerAssignment,
  departmentMembership,
  notice,
} from "@/server/db/schema/notices";

/**
 * Local synthetic setup for the browser/Worker harness. This is not part of
 * the delivered member surface: without the `SEED_TOKEN` value from the
 * gitignored `.dev.vars` it returns 404 like any other unknown route, and it
 * never appears in committed Worker configuration. Credentials are created
 * through Better Auth's trusted server API, never a public signup route.
 */
interface SeedAccount {
  username: string;
  password: string;
  fullName: string;
  email: string;
  membershipStatus: MembershipStatus;
  banned?: boolean;
}

interface SeedDepartment {
  id: string;
  name: string;
}

interface SeedProgram {
  id: string;
  departmentId: string;
  name: string;
}

interface SeedEvent {
  id: string;
  programId: string;
  title: string;
  startsAt: string;
}

interface SeedEnrolment {
  id: string;
  programId: string;
  username: string;
  status: EnrolmentStatus;
}

interface SeedInvitation {
  id: string;
  programId: string;
  username: string;
  state: InvitationState;
  expiresAt: string;
}

interface SeedNotice {
  id: string;
  title: string;
  body: string;
  scopeType: NoticeScope;
  scopeId?: string;
  publishedAt?: string;
  expiresAt?: string;
}

interface SeedDepartmentScopeRow {
  id: string;
  departmentId: string;
  username: string;
}

interface SeedRequest {
  accounts?: SeedAccount[];
  departments?: SeedDepartment[];
  programs?: SeedProgram[];
  events?: SeedEvent[];
  enrolments?: SeedEnrolment[];
  invitations?: SeedInvitation[];
  notices?: SeedNotice[];
  departmentMemberships?: SeedDepartmentScopeRow[];
  departmentManagerAssignments?: SeedDepartmentScopeRow[];
  /** Clears harness-owned activity rows first so runs stay deterministic. */
  resetActivities?: boolean;
}

const notFound = (): Response =>
  Response.json(
    { error: { code: "not_found", message: "找不到這個路徑。" } },
    { status: 404 }
  );

const createAccount = async (
  auth: AppAuth,
  account: SeedAccount
): Promise<string> => {
  const signUp = await auth.api.signUpEmail({
    body: {
      // The plugin lower-cases `username`; `displayUsername` preserves the form.
      displayUsername: account.username,
      email: account.email,
      name: account.fullName,
      password: account.password,
      username: account.username,
    },
  });
  return signUp.user.id;
};

const isSeedRequest = (value: unknown): value is SeedRequest => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    "accounts" in value ||
    "departments" in value ||
    "programs" in value ||
    "events" in value ||
    "enrolments" in value ||
    "invitations" in value ||
    "notices" in value ||
    "departmentMemberships" in value ||
    "departmentManagerAssignments" in value
  );
};

/** Applies the harness-owned Department/Program/Event/enrolment/notice fixtures. */
const applyDomainFixtures = async (
  db: Database,
  payload: SeedRequest,
  now: Date
): Promise<Response | null> => {
  await Promise.all(
    (payload.departments ?? []).map((row) =>
      db
        .insert(department)
        .values({ createdAt: now, id: row.id, name: row.name })
        .onConflictDoUpdate({ set: { name: row.name }, target: department.id })
    )
  );

  await Promise.all(
    (payload.programs ?? []).map((row) =>
      db
        .insert(program)
        .values({
          createdAt: now,
          departmentId: row.departmentId,
          id: row.id,
          name: row.name,
        })
        .onConflictDoUpdate({
          set: { departmentId: row.departmentId, name: row.name },
          target: program.id,
        })
    )
  );

  await Promise.all(
    (payload.events ?? []).map((row) => {
      const startsAt = new Date(row.startsAt);
      return db
        .insert(programEvent)
        .values({
          createdAt: now,
          id: row.id,
          programId: row.programId,
          startsAt,
          title: row.title,
        })
        .onConflictDoUpdate({
          set: { programId: row.programId, startsAt, title: row.title },
          target: programEvent.id,
        });
    })
  );

  const usernames = [
    ...(payload.enrolments ?? []).map((row) => row.username),
    ...(payload.invitations ?? []).map((row) => row.username),
    ...(payload.departmentMemberships ?? []).map((row) => row.username),
    ...(payload.departmentManagerAssignments ?? []).map((row) => row.username),
  ].map((username) => username.toLowerCase());

  const people =
    usernames.length > 0
      ? await db
          .select({ id: user.id, username: user.username })
          .from(user)
          .where(inArray(user.username, [...new Set(usernames)]))
      : [];
  const userIdByUsername = new Map(
    people.map((person) => [person.username ?? "", person.id])
  );

  const enrolmentRows = payload.enrolments ?? [];
  const enrolmentUserIds = enrolmentRows.map((row) =>
    userIdByUsername.get(row.username.toLowerCase())
  );
  if (enrolmentUserIds.some((userId) => !userId)) {
    return Response.json(
      { error: { code: "unknown_account", message: "enrolment" } },
      { status: 400 }
    );
  }
  await Promise.all(
    enrolmentRows.map((row, index) =>
      db
        .insert(enrolment)
        .values({
          createdAt: now,
          id: row.id,
          programId: row.programId,
          status: row.status,
          updatedAt: now,
          userId: enrolmentUserIds[index] ?? "",
        })
        .onConflictDoUpdate({
          set: { programId: row.programId, status: row.status, updatedAt: now },
          target: enrolment.id,
        })
    )
  );

  const invitationRows = payload.invitations ?? [];
  const invitationUserIds = invitationRows.map((row) =>
    userIdByUsername.get(row.username.toLowerCase())
  );
  if (invitationUserIds.some((userId) => !userId)) {
    return Response.json(
      { error: { code: "unknown_account", message: "invitation" } },
      { status: 400 }
    );
  }
  await Promise.all(
    invitationRows.map((row, index) =>
      db
        .insert(invitation)
        .values({
          createdAt: now,
          expiresAt: new Date(row.expiresAt),
          id: row.id,
          programId: row.programId,
          state: row.state,
          userId: invitationUserIds[index] ?? "",
        })
        .onConflictDoUpdate({
          set: {
            expiresAt: new Date(row.expiresAt),
            programId: row.programId,
            state: row.state,
          },
          target: invitation.id,
        })
    )
  );

  const membershipRows = payload.departmentMemberships ?? [];
  const membershipUserIds = membershipRows.map((row) =>
    userIdByUsername.get(row.username.toLowerCase())
  );
  if (membershipUserIds.some((userId) => !userId)) {
    return Response.json(
      { error: { code: "unknown_account", message: "departmentMembership" } },
      { status: 400 }
    );
  }
  await Promise.all(
    membershipRows.map((row, index) =>
      db
        .insert(departmentMembership)
        .values({
          createdAt: now,
          departmentId: row.departmentId,
          id: row.id,
          userId: membershipUserIds[index] ?? "",
        })
        .onConflictDoUpdate({
          set: { departmentId: row.departmentId },
          target: departmentMembership.id,
        })
    )
  );

  const assignmentRows = payload.departmentManagerAssignments ?? [];
  const assignmentUserIds = assignmentRows.map((row) =>
    userIdByUsername.get(row.username.toLowerCase())
  );
  if (assignmentUserIds.some((userId) => !userId)) {
    return Response.json(
      {
        error: {
          code: "unknown_account",
          message: "departmentManagerAssignment",
        },
      },
      { status: 400 }
    );
  }
  await Promise.all(
    assignmentRows.map((row, index) =>
      db
        .insert(departmentManagerAssignment)
        .values({
          createdAt: now,
          departmentId: row.departmentId,
          id: row.id,
          userId: assignmentUserIds[index] ?? "",
        })
        .onConflictDoUpdate({
          set: { departmentId: row.departmentId },
          target: departmentManagerAssignment.id,
        })
    )
  );

  await Promise.all(
    (payload.notices ?? []).map((row) =>
      db
        .insert(notice)
        .values({
          body: row.body,
          createdAt: now,
          expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
          id: row.id,
          publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
          scopeId: row.scopeId ?? null,
          scopeType: row.scopeType,
          title: row.title,
        })
        .onConflictDoUpdate({
          set: {
            body: row.body,
            expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
            publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
            scopeId: row.scopeId ?? null,
            scopeType: row.scopeType,
            title: row.title,
          },
          target: notice.id,
        })
    )
  );

  return null;
};

export const POST = async (request: Request): Promise<Response> => {
  const token = env.SEED_TOKEN;
  if (!token || request.headers.get("x-seed-token") !== token) {
    return notFound();
  }

  const payload: unknown = await request.json().catch(() => null);
  if (!isSeedRequest(payload)) {
    return Response.json(
      {
        error: {
          code: "invalid_seed",
          message: "請提供至少一個 fixture 區段。",
        },
      },
      { status: 400 }
    );
  }

  const auth = getAuth();
  const db = getDb();
  const now = new Date();

  if (payload.resetActivities) {
    // Disposable local fixtures only; accounts, profiles and sessions stay.
    await db.delete(notice);
    await db.delete(departmentManagerAssignment);
    await db.delete(departmentMembership);
    await db.delete(invitation);
    await db.delete(enrolment);
    await db.delete(programEvent);
    await db.delete(program);
    await db.delete(department);
  }

  const createdAccounts = await Promise.all(
    (payload.accounts ?? []).map(async (account) => {
      // Better Auth stores the canonical lower-case username; match that form.
      const [existing] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.username, account.username.toLowerCase()))
        .limit(1);

      const userId = existing
        ? existing.id
        : await createAccount(auth, account);

      const values = {
        bannedAt: account.banned ? now : null,
        membershipStatus: account.membershipStatus,
        nameLookupKey: canonicalNameKey(account.fullName),
        updatedAt: now,
      };

      await (existing
        ? db
            .update(personProfile)
            .set(values)
            .where(eq(personProfile.userId, userId))
        : db
            .insert(personProfile)
            .values({ ...values, createdAt: now, userId }));

      if (existing) {
        // Converge the disposable fixture: the display form and name may
        // predate the current canonical fixture values.
        await db
          .update(user)
          .set({ displayUsername: account.username, name: account.fullName })
          .where(eq(user.id, userId));
      }

      return { userId, username: account.username };
    })
  );

  const fixtureError = await applyDomainFixtures(db, payload, now);
  if (fixtureError) {
    return fixtureError;
  }

  return Response.json({ data: { created: createdAccounts } });
};
