import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QueryProvider } from "../../src/components/query-provider";

const renderClient = () => {
  let client: QueryClient | undefined;
  const Probe = () => {
    client = useQueryClient();
    return null;
  };
  renderToStaticMarkup(
    createElement(QueryProvider, { children: createElement(Probe) })
  );
  if (!client) {
    throw new Error("Query client not provided");
  }
  return client;
};

describe("document query client", () => {
  it("does not share private data between server renders", () => {
    const first = renderClient();
    first.setQueryData(["private"], "first account");
    const second = renderClient();
    expect(second.getQueryData(["private"])).toBeUndefined();
    first.clear();
    second.clear();
  });

  it("rechecks a cached verdict and does not retry an unavailable read", async () => {
    const client = renderClient();
    const queryKey = ["auth", "signed-out"];
    let reads = 0;
    expect(
      await client.query({
        queryFn: () => {
          reads += 1;
          return false;
        },
        queryKey,
      })
    ).toBe(false);
    await expect(
      client.query({
        queryFn: () => {
          reads += 1;
          throw new Error("Unavailable");
        },
        queryKey,
      })
    ).rejects.toThrow("Unavailable");
    expect(reads).toBe(2);
    client.clear();
  });
});
