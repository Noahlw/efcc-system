import { setTimeout as delay } from "node:timers/promises";

import { env, WorkerEntrypoint } from "cloudflare:workers";

export interface BatchControl {
  arm: () => Promise<void>;
  armAuditRead: (stage: "detail" | "list") => Promise<void>;
  armRolePeopleRead: (
    stage: "search" | "detail" | "duties" | "programs"
  ) => Promise<void>;
  held: () => Promise<{ held: boolean; entered: number; completed: number }>;
  release: () => Promise<void>;
}

// Dedicated causal store: exactly one sensitive write/read may be armed at a time.
let armed = false;
let parked = false;
let released = false;
let entered = 0;
let completed = 0;
let auditRead: "detail" | "list" | undefined;
let rolePeopleRead: "search" | "detail" | "duties" | "programs" | undefined;
let production:
  | Promise<{ default: ExportedHandler<Cloudflare.Env> }>
  | undefined;

const rolePeopleReadStage = (query: string) => {
  if (query.includes('instr("person_profile"."staff_search_key"')) {
    return "search";
  }
  if (query.includes('left join "role_assigner_assignment"')) {
    return "detail";
  }
  if (
    query.includes('from "department"') &&
    query.includes('from "program_leader_assignment"')
  ) {
    return "duties";
  }
  if (
    query.includes('from "program_leader_assignment" inner join "program"') &&
    query.includes('"program_leader_assignment"."created_at"')
  ) {
    return "programs";
  }
};

const holdRead = async (query: string) => {
  const list = query.includes('"account_audit_page"');
  const auditMatches =
    auditRead !== undefined &&
    query.includes('from "audit_event"') &&
    (auditRead === "list") === list;
  const rolePeopleMatches =
    rolePeopleRead !== undefined &&
    rolePeopleReadStage(query) === rolePeopleRead;
  if (!auditMatches && !rolePeopleMatches) {
    return;
  }
  auditRead = undefined;
  rolePeopleRead = undefined;
  parked = true;
  entered += 1;
  try {
    // eslint-disable-next-line no-unmodified-loop-condition -- Concurrent native RPC owns release.
    while (!released) {
      // eslint-disable-next-line no-await-in-loop -- Keep the actual SELECT request alive until RPC release.
      await delay(20);
    }
  } finally {
    parked = false;
    released = false;
  }
};

/** Intercept the armed SELECT only; SQL, parameters and D1 results remain real. */
const readStatement = (
  statement: D1PreparedStatement,
  query: string
): D1PreparedStatement =>
  new Proxy(statement, {
    get(target, property) {
      if (property === "bind") {
        return (...values: unknown[]) =>
          readStatement(target.bind(...values), query);
      }
      if (property === "raw") {
        return async (options?: Parameters<D1PreparedStatement["raw"]>[0]) => {
          await holdRead(query);
          return target.raw(options);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

const loadProduction = () => {
  if (!production) {
    const original = env.DB;
    Object.defineProperty(env, "DB", {
      configurable: true,
      value: {
        async batch<T>(
          statements: D1PreparedStatement[]
        ): Promise<D1Result<T>[]> {
          if (armed) {
            armed = false;
            parked = true;
            entered += 1;
            // Causal keepalive, not readiness polling: RPC from another request releases it.
            // eslint-disable-next-line no-unmodified-loop-condition -- A concurrent RPC owns release.
            while (!released) {
              // eslint-disable-next-line no-await-in-loop -- Keep the held effect request alive until RPC release.
              await delay(20);
            }
            parked = false;
            released = false;
          }
          const result = await original.batch<T>(statements);
          completed += 1;
          return result;
        },
        dump: () => original.dump(),
        exec: (sql: string) => original.exec(sql),
        prepare: (sql: string) => {
          const statement = original.prepare(sql);
          return sql.includes('from "audit_event"') || rolePeopleReadStage(sql)
            ? readStatement(statement, sql)
            : statement;
        },
      },
    });
    // Artifact assembly places this module beside the unchanged emitted app entry.
    // Install before import: authOptions captures its Drizzle adapter at evaluation.
    // @ts-expect-error -- emitted production module exists only in dist/server.
    production = import("./index.js");
  }
  return production;
};

/** Test-only default RPC service AND production fetch in the same effect isolate. */
/* eslint-disable class-methods-use-this -- Default native RPC requires instance methods sharing effect-isolate state. */
export default class ClockApp extends WorkerEntrypoint<Cloudflare.Env> {
  async fetch(
    request: Request<unknown, IncomingRequestCfProperties>
  ): Promise<Response> {
    const app = await loadProduction();
    if (!app.default.fetch) {
      throw new Error("Emitted production Worker has no fetch entrypoint");
    }
    return app.default.fetch(request, this.env, this.ctx);
  }

  async arm(): Promise<void> {
    await loadProduction();
    if (armed || auditRead || rolePeopleRead || parked) {
      throw new Error("A sensitive batch is already armed or held");
    }
    released = false;
    armed = true;
  }

  async armAuditRead(stage: "detail" | "list"): Promise<void> {
    await loadProduction();
    if (armed || auditRead || rolePeopleRead || parked) {
      throw new Error("A causal boundary is already armed or held");
    }
    released = false;
    auditRead = stage;
  }

  async armRolePeopleRead(
    stage: "search" | "detail" | "duties" | "programs"
  ): Promise<void> {
    await loadProduction();
    if (armed || auditRead || rolePeopleRead || parked) {
      throw new Error("A causal boundary is already armed or held");
    }
    released = false;
    rolePeopleRead = stage;
  }

  held() {
    return { completed, entered, held: parked };
  }

  release(): void {
    armed = false;
    auditRead = undefined;
    rolePeopleRead = undefined;
    released = true;
  }
}
