import * as z from "zod";

import { departmentManagerReceiptSchema } from "../department-manager-contract";

const reconciliation = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("committed"),
    receipt: departmentManagerReceiptSchema,
  }),
  z.strictObject({ outcome: z.literal("unknown"), receipt: z.null() }),
]);

export const reconcileDepartmentManagerChange = async (
  operationKey: string,
  actorUserId: string,
  signal: AbortSignal
) => {
  const response = await fetch("/api/v2/roles/department-managers/reconcile", {
    body: JSON.stringify({ operationKey }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-efcc-expected-actor-id": actorUserId,
    },
    method: "POST",
    signal,
  });
  if (!response.ok) {
    throw new Error("暫時未能在目前權限下查核原有部門職務操作。");
  }
  const body = z.object({ data: reconciliation }).parse(await response.json());
  return body.data;
};
