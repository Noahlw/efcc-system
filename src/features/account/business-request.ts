import { waitUntil } from "cloudflare:workers";
import { sql } from "drizzle-orm";

import { getDb, schema } from "../../server/db/client";
import { BusinessApiError } from "./business-error-contract";

export { BusinessApiError } from "./business-error-contract";

export const MAX_REQUEST_BYTES = 8192;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 10;

const validationError = (): BusinessApiError =>
  new BusinessApiError(400, "validation_error", "申請資料格式不正確。");

const drainRejectedBody = (body: ReadableStream<Uint8Array>): void => {
  // The response does not await the tail; native waitUntil owns bounded discard.
  const draining = (async () => {
    try {
      let discarded = 0;
      for await (const chunk of body) {
        discarded += chunk.byteLength;
        if (discarded >= MAX_REQUEST_BYTES) {
          // Iterator return cancels the remaining stream instead of consuming an arbitrary tail.
          break;
        }
      }
    } catch {
      console.warn("Rejected request body drain failed.");
    }
  })();
  waitUntil(draining);
};

export const readBoundedJson = async (request: Request): Promise<unknown> => {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const contentLength = request.headers.get("content-length");
  const { body } = request;
  if (!body) {
    throw validationError();
  }
  if (
    mediaType !== "application/json" ||
    (contentLength !== null &&
      (!/^\d+$/u.test(contentLength) ||
        Number(contentLength) > MAX_REQUEST_BYTES))
  ) {
    drainRejectedBody(body);
    throw validationError();
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let oversized = false;
  for await (const chunk of body.values({ preventCancel: true })) {
    byteLength += chunk.byteLength;
    if (byteLength > MAX_REQUEST_BYTES) {
      oversized = true;
      break;
    }
    chunks.push(chunk);
  }
  if (oversized) {
    chunks.length = 0;
    drainRejectedBody(body);
    throw validationError();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw validationError();
  }
};

const sameOriginRequest = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    (!origin || origin === new URL(request.url).origin) &&
    (!fetchSite || fetchSite === "same-origin" || fetchSite === "none")
  );
};

export const guardBusinessRequest = async (
  request: Request,
  action:
    | "create"
    | "reconcile"
    | "decision"
    | "decision-reconcile"
    | "password-change"
    | "session-revoke"
    | "password-confirmation"
    | "security-reconcile"
    | "staff-account-create"
    | "staff-account-reconcile"
    | "staff-password-reset"
    | "staff-password-reissue"
    | "applicant-action"
    | "applicant-reconcile"
    | "own-phone"
    | "staff-identity"
    | "account-change-reconcile"
    | "account-restriction"
    | "account-deletion"
): Promise<void> => {
  if (!sameOriginRequest(request)) {
    throw new BusinessApiError(
      403,
      "origin_denied",
      "只允許同一來源提交請求。"
    );
  }

  const clientIp = request.headers.get("cf-connecting-ip")?.trim();
  if (!clientIp || clientIp.length > 64 || /[\s,]/u.test(clientIp)) {
    throw new BusinessApiError(
      429,
      "rate_limited",
      "提交次數過多，請稍後再試。"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const database = getDb();
  const { rateLimit } = schema;
  // SQLite's fixed UPSERT alias is not a schema column.
  const excludedLastRequest = sql.raw("excluded.last_request");
  const [result] = await database
    .insert(rateLimit)
    .values({
      count: 1,
      id: crypto.randomUUID(),
      key: `application:${action}:${clientIp}`,
      lastRequest: now,
    })
    .onConflictDoUpdate({
      set: {
        count: sql`CASE WHEN ${excludedLastRequest} - ${rateLimit.lastRequest} >= ${RATE_LIMIT_WINDOW_SECONDS} THEN 1 ELSE ${rateLimit.count} + 1 END`,
        lastRequest: sql`CASE WHEN ${excludedLastRequest} - ${rateLimit.lastRequest} >= ${RATE_LIMIT_WINDOW_SECONDS} THEN ${excludedLastRequest} ELSE ${rateLimit.lastRequest} END`,
      },
      target: rateLimit.key,
    })
    .returning({ count: rateLimit.count });

  if (!result) {
    throw new Error("Application rate limiter returned no row.");
  }
  if (result.count > RATE_LIMIT_MAX_REQUESTS) {
    throw new BusinessApiError(
      429,
      "rate_limited",
      "提交次數過多，請稍後再試。"
    );
  }
};
