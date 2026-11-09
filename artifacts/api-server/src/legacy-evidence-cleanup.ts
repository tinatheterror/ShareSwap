import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Evidence photos uploaded before evidence became private are public URLs (/storage/... or /uploads/...) kept in three places:
 * security_claims.evidence, item_requests.return_dispute_photo_url and dispute_evidence.photo_urls. This finds them and, when asked,
 * deletes the files and clears the references. Dry run by default: planLegacyEvidence only reads.
 *
 * A file that is also a listing, profile or condition photo is never deleted (only the evidence reference is cleared). Links to other
 * sites and private-token URLs are left alone.
 */
export const PUBLIC_UPLOAD = /^\/(storage|uploads)\//;

export interface LegacyRef { table: "security_claims" | "item_requests" | "dispute_evidence"; id: number; column: string; url: string }
export interface LegacyPlan {
  refs: LegacyRef[];
  /** Distinct files, with whether another (public) photo uses the same file. */
  files: { url: string; sharedWithPublicPhoto: boolean }[];
  external: number;
  byTable: Record<LegacyRef["table"], { records: number[]; refs: number }>;
}

type Rows = { rows: Record<string, unknown>[] };
const rowsOf = (r: unknown) => (r as Rows).rows;

export async function planLegacyEvidence(): Promise<LegacyPlan> {
  const refs: LegacyRef[] = [];
  let external = 0;
  const take = (table: LegacyRef["table"], column: string, id: number, url: unknown) => {
    if (typeof url !== "string") return;
    if (PUBLIC_UPLOAD.test(url)) refs.push({ table, id, column, url });
    else if (/^https?:\/\//i.test(url)) external++;
  };
  for (const r of rowsOf(await db.execute(sql`SELECT id, e AS url FROM security_claims, jsonb_array_elements_text(evidence) AS e`))) take("security_claims", "evidence", Number(r.id), r.url);
  for (const r of rowsOf(await db.execute(sql`SELECT id, return_dispute_photo_url AS url FROM item_requests WHERE return_dispute_photo_url IS NOT NULL`))) take("item_requests", "return_dispute_photo_url", Number(r.id), r.url);
  for (const r of rowsOf(await db.execute(sql`SELECT id, unnest(photo_urls) AS url FROM dispute_evidence`))) take("dispute_evidence", "photo_urls", Number(r.id), r.url);

  const urls = [...new Set(refs.map((r) => r.url))].sort();
  const shared = new Set<string>();
  if (urls.length) {
    const list = sql.join(urls.map((u) => sql`${u}`), sql`, `);
    for (const r of rowsOf(await db.execute(sql`
      SELECT p AS url FROM (
        SELECT unnest(photos) AS p FROM items
        UNION ALL SELECT profile_photo FROM users WHERE profile_photo IS NOT NULL
        UNION ALL SELECT unnest(photos) FROM item_condition_verifications WHERE photos IS NOT NULL
      ) x WHERE p IN (${list})`))) shared.add(String(r.url));
  }
  const byTable = {} as LegacyPlan["byTable"];
  for (const table of ["security_claims", "item_requests", "dispute_evidence"] as const) {
    const mine = refs.filter((r) => r.table === table);
    byTable[table] = { records: [...new Set(mine.map((r) => r.id))].sort((a, b) => a - b), refs: mine.length };
  }
  return { refs, files: urls.map((url) => ({ url, sharedWithPublicPhoto: shared.has(url) })), external, byTable };
}

export function describeLegacyPlan(plan: LegacyPlan): string {
  const lines = [`Public evidence file references: ${plan.refs.length} (${plan.files.length} distinct files); links to other sites left alone: ${plan.external}`];
  for (const [table, v] of Object.entries(plan.byTable)) lines.push(`  ${table}: ${v.refs} reference(s) in ${v.records.length} record(s)${v.records.length ? ` -> ids ${v.records.join(", ")}` : ""}`);
  const kept = plan.files.filter((f) => f.sharedWithPublicPhoto);
  if (kept.length) lines.push(`Files that are also a listing, profile or condition photo (reference cleared, file kept): ${kept.map((f) => f.url).join(", ")}`);
  lines.push(`Files to delete: ${plan.files.filter((f) => !f.sharedWithPublicPhoto).map((f) => f.url).join(", ") || "none"}`);
  return lines.join("\n");
}

export type RemoveResult = "deleted" | "missing" | "failed";

/** Deletes the files first (a failed one keeps its references so a re-run finds it), then clears the references of the rest. */
export async function applyLegacyEvidenceCleanup(
  plan: LegacyPlan,
  remove: (url: string) => Promise<RemoveResult>,
): Promise<{ filesDeleted: number; filesKept: number; filesFailed: string[]; referencesCleared: number }> {
  const outcome = new Map<string, "gone" | "kept" | "failed">();
  for (const f of plan.files) {
    if (f.sharedWithPublicPhoto) { outcome.set(f.url, "kept"); continue; }
    outcome.set(f.url, (await remove(f.url)) === "failed" ? "failed" : "gone");
  }
  const clear = new Set(plan.files.filter((f) => outcome.get(f.url) !== "failed").map((f) => f.url));
  const toClear = plan.refs.filter((r) => clear.has(r.url));
  await db.transaction(async (tx) => {
    for (const r of toClear) {
      if (r.table === "security_claims") {
        await tx.execute(sql`UPDATE security_claims SET evidence = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(evidence) e WHERE e <> to_jsonb(${r.url}::text)), '[]'::jsonb) WHERE id = ${r.id}`);
      } else if (r.table === "item_requests") {
        await tx.execute(sql`UPDATE item_requests SET return_dispute_photo_url = NULL WHERE id = ${r.id} AND return_dispute_photo_url = ${r.url}`);
      } else {
        await tx.execute(sql`UPDATE dispute_evidence SET photo_urls = array_remove(photo_urls, ${r.url}) WHERE id = ${r.id}`);
      }
    }
  });
  const values = [...outcome.values()];
  return {
    filesDeleted: values.filter((v) => v === "gone").length,
    filesKept: values.filter((v) => v === "kept").length,
    filesFailed: [...outcome].filter(([, v]) => v === "failed").map(([url]) => url),
    referencesCleared: toClear.length,
  };
}
