import { isTestDatabaseName, isTestProcess } from "@workspace/db/test-database-guard";

/**
 * Tests must never write to the real Object Storage bucket (the same idea as the database guard).
 *
 * In a test process (node:test child, e2e API server, a *.test.ts run directly, NODE_ENV=test) the bucket comes only from
 * TEST_OBJECT_STORAGE_BUCKET_ID. When it is not set, Object Storage is not used at all and uploads go to the local folders. When it is
 * set it must be a different bucket from DEFAULT_OBJECT_STORAGE_BUCKET_ID and its id must say "test", or the process refuses to start
 * using storage. Outside tests nothing changes: the default bucket is used.
 */
export class TestStorageGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestStorageGuardError";
  }
}

type Env = Record<string, string | undefined>;
export type StorageChoice = { kind: "default"; bucketId: string | undefined } | { kind: "test-bucket"; bucketId: string } | { kind: "local" };

export function chooseStorage(env: Env = process.env, testProcess: boolean = isTestProcess(env)): StorageChoice {
  if (!testProcess) return { kind: "default", bucketId: env.DEFAULT_OBJECT_STORAGE_BUCKET_ID };
  const testBucket = env.TEST_OBJECT_STORAGE_BUCKET_ID?.trim();
  if (!testBucket) return { kind: "local" };
  if (testBucket === env.DEFAULT_OBJECT_STORAGE_BUCKET_ID?.trim()) {
    throw new TestStorageGuardError("Refusing to use Object Storage in a test: TEST_OBJECT_STORAGE_BUCKET_ID is the same bucket as DEFAULT_OBJECT_STORAGE_BUCKET_ID (the real one).");
  }
  if (!isTestDatabaseName(testBucket)) {
    throw new TestStorageGuardError('Refusing to use Object Storage in a test: TEST_OBJECT_STORAGE_BUCKET_ID must be a bucket whose id contains the word "test".');
  }
  return { kind: "test-bucket", bucketId: testBucket };
}
