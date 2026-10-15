import type { Env, MiddlewareHandler, TypedResponse } from "hono";
import type * as z from "zod";

import { BusinessApiError, readBoundedJson } from "./business-request";

type ValidationResponse = TypedResponse<
  { error: { code: "validation_error"; message: string } },
  400,
  "json"
>;
/** Keep bounded fatal-UTF-8 reads and native Hono/RPC typing together. */
export const boundedJsonValidator = <T extends z.ZodType>(
  schema: T,
  message: string
) =>
  (async (c, next) => {
    const parsed = schema.safeParse(await readBoundedJson(c.req.raw));
    if (!parsed.success) {
      throw new BusinessApiError(400, "validation_error", message);
    }
    c.req.addValidatedData("json", parsed.data as object);
    return next();
  }) as MiddlewareHandler<
    Env,
    string,
    { in: { json: z.input<T> }; out: { json: z.output<T> } },
    ValidationResponse
  >;
