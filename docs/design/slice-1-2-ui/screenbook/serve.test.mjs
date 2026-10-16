import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "./serve.mjs";

function requestBook(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", path: requestPath, port },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString(),
            status: response.statusCode,
          })
        );
      }
    );
    request.on("error", reject);
    request.end();
  });
}

test("the local Book serves only files whose resolved path stays in its root", async () => {
  const fixtureParent = await mkdtemp(path.join(os.tmpdir(), "efcc-book-boundary-"));
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
    symlink(path.join(root, "reference.md"), path.join(root, "inside-link.md")),
    symlink(path.join(outside, "secret.md"), path.join(root, "outside-link.md")),
  ]);

  const server = createServer(root);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
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

    for (const requestPath of [
      "/../screenbook-sibling/secret.md",
      "/%2e%2e%2fscreenbook-sibling%2fsecret.md",
      "/../private-area/secret.md",
      "/outside-link.md",
    ]) {
      assert.deepEqual(await requestBook(port, requestPath), {
        body: "Not found",
        status: 404,
      });
    }
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(fixtureParent, { force: true, recursive: true });
  }
});
