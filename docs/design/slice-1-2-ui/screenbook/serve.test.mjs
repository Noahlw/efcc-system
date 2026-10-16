import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "./serve.mjs";

const requestBook = async (port, requestPath) => {
  const request = http.request({ host: "127.0.0.1", path: requestPath, port });
  const responsePromise = once(request, "response");
  request.end();
  const [response] = await responsePromise;
  const chunks = [];
  response.on("data", (chunk) => chunks.push(chunk));
  await once(response, "end");
  return {
    body: Buffer.concat(chunks).toString(),
    status: response.statusCode,
  };
};

test("the local Book serves only files whose resolved path stays in its root", async () => {
  const fixtureParent = await mkdtemp(
    path.join(os.tmpdir(), "efcc-book-boundary-")
  );
  let server;
  try {
    const root = path.join(fixtureParent, "screenbook");
    const sibling = path.join(fixtureParent, "screenbook-sibling");
    const outside = path.join(fixtureParent, "private-area");
    await Promise.all([mkdir(root), mkdir(sibling), mkdir(outside)]);
    await Promise.all([
      writeFile(path.join(root, "index.html"), "synthetic Book home"),
      writeFile(path.join(root, "reference.md"), "synthetic reference"),
      writeFile(path.join(sibling, "secret.md"), "synthetic sibling secret"),
      writeFile(path.join(outside, "secret.md"), "synthetic outside secret"),
    ]);
    await Promise.all([
      symlink(
        path.join(root, "reference.md"),
        path.join(root, "inside-link.md")
      ),
      symlink(
        path.join(outside, "secret.md"),
        path.join(root, "outside-link.md")
      ),
    ]);

    server = createServer(root);
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    const { port } = server.address();

    assert.deepEqual(await requestBook(port, "/?from=gallery"), {
      body: "synthetic Book home",
      status: 200,
    });
    assert.deepEqual(await requestBook(port, "/reference.md"), {
      body: "synthetic reference",
      status: 200,
    });
    assert.deepEqual(await requestBook(port, "/inside-link.md"), {
      body: "synthetic reference",
      status: 200,
    });

    const invalidPaths = [
      "/../screenbook-sibling/secret.md",
      "/%2e%2e%2fscreenbook-sibling%2fsecret.md",
      "/../private-area/secret.md",
      "/outside-link.md",
    ];
    const invalidResponses = await Promise.all(
      invalidPaths.map((requestPath) => requestBook(port, requestPath))
    );
    for (const response of invalidResponses) {
      assert.deepEqual(response, {
        body: "Not found",
        status: 404,
      });
    }
  } finally {
    try {
      if (server?.listening) {
        const closed = once(server, "close");
        server.close();
        await closed;
      }
    } finally {
      await rm(fixtureParent, { force: true, recursive: true });
    }
  }
});
