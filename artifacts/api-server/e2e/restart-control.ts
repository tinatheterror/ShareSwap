// Test-only DB helper. Keep the control outside the orphan username pattern,
// without changing any of its earned activity or adding a public API route.
import { db, pool } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const [action, fixtureId] = process.argv.slice(2);
if (
  process.env.E2E_TEST_MODE !== "true" ||
  !["preserve", "restore"].includes(action) ||
  !/^[a-f0-9]{16}$/.test(fixtureId ?? "")
) {
  throw new Error("Expected E2E_TEST_MODE and preserve/restore with a fixture ID");
}

try {
  await db.transaction(async (tx) => {
    for (const role of ["owner", "borrower"]) {
      const fixtureName = `e2e-${role}-${fixtureId}@example.test`;
      const controlName = `e2e-restart-control-${role}-${fixtureId}@example.test`;
      const changed = await tx.update(users)
        .set({ username: action === "preserve" ? controlName : fixtureName })
        .where(eq(users.username, action === "preserve" ? fixtureName : controlName))
        .returning({ id: users.id });
      if (changed.length !== 1) throw new Error("Restart control user not found");
    }
  });
} finally {
  await pool.end();
}