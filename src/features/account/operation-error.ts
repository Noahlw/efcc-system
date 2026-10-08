import * as z from "zod";

/** The business API error envelope shared by account operation clients. */
export const operationErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
