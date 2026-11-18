import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// sharecoin_holds.request_id is ON DELETE RESTRICT: a request that has a hold cannot be deleted. Nothing in production deletes
// item_requests (account deletion anonymizes and keeps them; the clean-up jobs cancel them). The only code that does is the e2e
// fixture clean-up, which exists only in E2E_TEST_MODE. This guard keeps it that way: any source file that deletes requests must
// delete their holds first, and no new production path may start deleting requests without doing the same.

const SRC = path.resolve(import.meta.dirname, ".");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

const DELETES_REQUESTS = /\.delete\(\s*itemRequests\s*\)|DELETE\s+FROM\s+"?item_requests"?\b/i;

test("every non-test source that deletes item_requests deletes the holds first", () => {
  const offenders: string[] = [];
  const deleting: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!DELETES_REQUESTS.test(line)) return;
      deleting.push(`${path.relative(SRC, file)}:${i + 1}`);
      const before = lines.slice(Math.max(0, i - 12), i).join("\n");
      if (!/shareCoinHolds|sharecoin_holds/.test(before)) offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], "these delete requests without deleting their ShareCoin holds first");
  // The only deleter is the e2e fixture clean-up in routes.ts; a second one should be a deliberate, reviewed addition.
  assert.deepEqual(deleting.map((d) => d.split(":")[0]), ["routes/routes.ts"]);
});

test("the e2e fixture clean-up is the one that deletes requests, and it exists only in the e2e test mode", () => {
  const routes = readFileSync(path.join(SRC, "routes/routes.ts"), "utf8");
  const deleteAt = routes.search(/\.delete\(\s*itemRequests\s*\)/);
  const e2eBlockAt = routes.indexOf("if (e2eTestModeEnabled()) {");
  assert.ok(e2eBlockAt > 0 && deleteAt > e2eBlockAt, "the delete sits inside the e2e-only block");
});
