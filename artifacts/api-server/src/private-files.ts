import path from "path";
import { randomBytes } from "crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { db, evidenceUploads, itemRequests, items, securityClaims } from "@workspace/db";
import { readPrivateFile, savePrivateFile } from "./storage";

/**
 * Private uploads: evidence that must never be reachable by URL. Each file is stored under a random key the public /storage route
 * refuses, recorded with who uploaded it and what it is for, and read back only through GET /api/private-files/:token.
 *
 *   dispute_evidence  an owner's photos for a card dispute        readable by: the uploader, admins
 *   claim_evidence    photos for a security claim on a deposit    readable by: the uploader, the claim's owner and borrower, admins
 *   return_dispute    the photo with a "not as returned" report   readable by: the uploader, the rental's owner and borrower, admins
 *
 * Each flow accepts only URLs of its own purpose that the submitting member uploaded. Listing and profile photos are public by design
 * and do not use this.
 */
export const PRIVATE_FILE_PURPOSES = ["dispute_evidence", "claim_evidence", "return_dispute"] as const;
export type PrivateFilePurpose = (typeof PRIVATE_FILE_PURPOSES)[number];

export const PRIVATE_FILE_PREFIX = "/api/private-files/";
/** The first route for these files; URLs already stored with it keep working. */
export const LEGACY_EVIDENCE_FILE_PREFIX = "/api/dispute-evidence/files/";
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

const CONTENT_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };

export const privateFileUrl = (token: string) => `${PRIVATE_FILE_PREFIX}${token}`;

/** The token inside one of our private-file URLs, or null for anything else (other paths, other hosts, query strings). */
export function privateTokenOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const prefix = [PRIVATE_FILE_PREFIX, LEGACY_EVIDENCE_FILE_PREFIX].find((p) => url.startsWith(p));
  if (!prefix) return null;
  const token = url.slice(prefix.length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

export async function savePrivateUpload(userId: number, file: { buffer: Buffer; originalname: string }, purpose: PrivateFilePurpose): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) throw new Error("Unsupported image type");
  const storageKey = await savePrivateFile(file.buffer, ext);
  const token = randomBytes(16).toString("hex");
  await db.insert(evidenceUploads).values({ token, storageKey, contentType, userId, purpose });
  return privateFileUrl(token);
}

/** True when every url is a private upload of this purpose made by this user. */
export async function allUploadedBy(urls: string[], userId: number, purpose: PrivateFilePurpose): Promise<boolean> {
  for (const url of urls) {
    const token = privateTokenOf(url);
    if (!token) return false;
    const [row] = await db.select({ userId: evidenceUploads.userId, purpose: evidenceUploads.purpose }).from(evidenceUploads).where(eq(evidenceUploads.token, token)).limit(1);
    if (!row || row.userId !== userId || row.purpose !== purpose) return false;
  }
  return true;
}

/** Is the viewer a party to a claim or a return report that this file is attached to? */
async function isParty(token: string, purpose: string, viewerId: number): Promise<boolean> {
  const urls = [privateFileUrl(token), `${LEGACY_EVIDENCE_FILE_PREFIX}${token}`];
  if (purpose === "claim_evidence") {
    const rows = await db.select({ id: securityClaims.id }).from(securityClaims)
      .where(and(or(eq(securityClaims.ownerId, viewerId), eq(securityClaims.borrowerId, viewerId)), sql`(${securityClaims.evidence} @> to_jsonb(${urls[0]}::text) OR ${securityClaims.evidence} @> to_jsonb(${urls[1]}::text))`)).limit(1);
    return rows.length > 0;
  }
  if (purpose === "return_dispute") {
    const rows = await db.select({ id: itemRequests.id }).from(itemRequests).innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(and(or(eq(itemRequests.requesterId, viewerId), eq(items.ownerId, viewerId)), or(eq(itemRequests.returnDisputePhotoUrl, urls[0]), eq(itemRequests.returnDisputePhotoUrl, urls[1])))).limit(1);
    return rows.length > 0;
  }
  return false;
}

/** The file, if the viewer may read it. Anyone else, and a missing file, look the same: not found. */
export async function readPrivateUpload(token: string, viewer: { id: number; isAdmin?: boolean | null }): Promise<{ body: Buffer; contentType: string } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db.select().from(evidenceUploads).where(eq(evidenceUploads.token, token)).limit(1);
  if (!row || !row.storageKey || !row.contentType) return null;
  if (row.userId !== viewer.id && !viewer.isAdmin && !(await isParty(token, row.purpose, viewer.id))) return null;
  const body = await readPrivateFile(row.storageKey);
  return body ? { body, contentType: row.contentType } : null;
}
