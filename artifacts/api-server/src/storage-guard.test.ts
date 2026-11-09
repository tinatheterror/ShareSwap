import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseStorage, TestStorageGuardError } from "./storage-guard.js";

const REAL = "replit-objstore-cb3aab52-ac42-40ef-9d04-b5fbb6285151";

test("outside tests the default bucket is used, as before", () => {
  assert.deepEqual(chooseStorage({ DEFAULT_OBJECT_STORAGE_BUCKET_ID: REAL }, false), { kind: "default", bucketId: REAL });
});

test("in a test process Object Storage is not used at all unless a test bucket is configured", () => {
  assert.deepEqual(chooseStorage({ DEFAULT_OBJECT_STORAGE_BUCKET_ID: REAL }, true), { kind: "local" });
  assert.deepEqual(chooseStorage({ DEFAULT_OBJECT_STORAGE_BUCKET_ID: REAL, TEST_OBJECT_STORAGE_BUCKET_ID: "  " }, true), { kind: "local" });
});

test("a test bucket must be a different bucket from the real one and say test in its id", () => {
  assert.deepEqual(chooseStorage({ DEFAULT_OBJECT_STORAGE_BUCKET_ID: REAL, TEST_OBJECT_STORAGE_BUCKET_ID: "shareswap-test" }, true), { kind: "test-bucket", bucketId: "shareswap-test" });
  assert.throws(() => chooseStorage({ DEFAULT_OBJECT_STORAGE_BUCKET_ID: REAL, TEST_OBJECT_STORAGE_BUCKET_ID: REAL }, true), TestStorageGuardError);
  assert.throws(() => chooseStorage({ DEFAULT_OBJECT_STORAGE_BUCKET_ID: REAL, TEST_OBJECT_STORAGE_BUCKET_ID: "shareswap-uploads" }, true), /contains the word "test"/);
  assert.throws(() => chooseStorage({ TEST_OBJECT_STORAGE_BUCKET_ID: "latest-bucket" }, true), TestStorageGuardError);
});

test("this very test process is a test process, so a real storage client is never built here", async () => {
  const { isTestProcess } = await import("@workspace/db/test-database-guard");
  assert.equal(isTestProcess(), true);
  assert.notEqual(chooseStorage().kind, "default");
});
