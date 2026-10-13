import { test, expect } from "./fixtures";

// Invoked only by the parent lifecycle proof. These are intentional failures,
// not cases to include in ordinary discovery or qualification.
test("owned worker assertion failure", async ({ app }) => {
  await app.db.exec("CREATE TABLE interrupted_probe (id TEXT)");
  console.log(`NATIVE_LIFECYCLE_ORIGIN=${app.origin}`);
  throw new Error("intentional owned worker failure");
});

test("owned worker assertion failure replacement", async ({ app }) => {
  expect(await app.db.prepare("SELECT name FROM sqlite_master WHERE name='interrupted_probe'").first()).toBeNull();
  console.log("NATIVE_LIFECYCLE_REPLACED");
});

test("owned worker interrupt", async ({ app }) => {
  await app.db.exec("CREATE TABLE interrupted_probe (id TEXT)");
  console.log(`NATIVE_LIFECYCLE_ORIGIN=${app.origin}`);
  await Promise.withResolvers<undefined>().promise;
});
