import { once } from "node:events";

import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { readTransientReconciliation } from "../../../src/features/account/reconciliation-query";

const transientKey = [
  "account",
  "security",
  "reconciliation",
  "operation-1",
] as const;
const siblingKey = [
  "account",
  "security",
  "reconciliation",
  "operation-2",
] as const;
const unrelatedKey = ["account", "security", "profile"] as const;
const staleTransientResult = {
  operationKey: "operation-1",
  receipt: "stale private receipt",
};
const siblingResult = {
  operationKey: "operation-2",
  receipt: "separate receipt",
};
const unrelatedResult = { displayName: "Synthetic account" };
const clients: QueryClient[] = [];

const createClient = () => {
  const client = new QueryClient();
  client.setQueryData(siblingKey, siblingResult);
  client.setQueryData(unrelatedKey, unrelatedResult);
  clients.push(client);
  return client;
};

const seedStaleTransientResult = (client: QueryClient) =>
  client.setQueryData(transientKey, staleTransientResult, { updatedAt: 1 });

const expectTransientResultRemoved = (client: QueryClient) => {
  expect(
    client.getQueryCache().find({ exact: true, queryKey: transientKey })
  ).toBeUndefined();
  expect(client.getQueryData(transientKey)).toBeUndefined();
  expect(client.getQueryData(siblingKey)).toEqual(siblingResult);
  expect(client.getQueryData(unrelatedKey)).toEqual(unrelatedResult);
};

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.clear();
  }
});

describe("transient security reconciliation reads", () => {
  it("returns a fresh result without retaining a stale exact query entry", async () => {
    const client = createClient();
    seedStaleTransientResult(client);
    const privateResult = {
      operationKey: "operation-1",
      receipt: "private receipt",
    };
    let reads = 0;

    await expect(
      readTransientReconciliation(client, transientKey, () => {
        reads += 1;
        return Promise.resolve(privateResult);
      })
    ).resolves.toEqual(privateResult);

    expect(reads).toBe(1);
    expectTransientResultRemoved(client);
  });

  it("does not retry a failed read and removes its stale exact query entry", async () => {
    const client = createClient();
    seedStaleTransientResult(client);
    let reads = 0;

    await expect(
      readTransientReconciliation(client, transientKey, () => {
        reads += 1;
        return Promise.reject(new Error("Worker unavailable"));
      })
    ).rejects.toThrow("Worker unavailable");

    expect(reads).toBe(1);
    expectTransientResultRemoved(client);
  });

  it("removes its exact query entry when the read is cancelled", async () => {
    const client = createClient();
    seedStaleTransientResult(client);
    let reads = 0;
    const { promise: started, resolve: reportStarted } =
      Promise.withResolvers<AbortSignal>();
    const pending = readTransientReconciliation(
      client,
      transientKey,
      ({ signal }) => {
        reads += 1;
        reportStarted(signal);
        return once(signal, "abort").then(() => {
          throw signal.reason;
        });
      }
    );

    const signal = await started;
    await client.cancelQueries({ exact: true, queryKey: transientKey });
    await expect(pending).rejects.toBe(signal.reason);
    expect(signal.aborted).toBe(true);
    expect(reads).toBe(1);
    expectTransientResultRemoved(client);
  });
});
