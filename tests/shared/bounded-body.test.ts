import { expect, it, vi } from "vitest";

import { readBoundedJson } from "../../src/features/account/applications";

const background = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("cloudflare:workers", () => ({
  waitUntil: (task: Promise<unknown>) => background.push(task),
}));
vi.mock("../../src/server/auth", () => ({ getAuth: vi.fn() }));
vi.mock("../../src/server/db/client", () => ({ getDb: vi.fn(), schema: {} }));

it("cancels a rejected tail after at most 8192 discarded bytes plus native prefetch", async () => {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1024));
      if (pulled === 64) {
        controller.close();
      }
    },
  });
  const options: RequestInit & { duplex: "half" } = {
    body,
    duplex: "half",
    headers: { "content-type": "text/plain" },
    method: "POST",
  };
  try {
    await expect(
      readBoundedJson(new Request("https://example.test/apply", options))
    ).rejects.toMatchObject({ code: "validation_error", status: 400 });
    await Promise.all(background);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(9);
  } finally {
    background.length = 0;
  }
});
