import path from "path";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db, evidenceUploads } from "@workspace/db";
import { readPrivateFile, savePrivateFile } from "./storage";

/**
 * Photos sent as dispute evidence. They are private: stored under a random key the public /storage route refuses, recorded with the
 * member who uploaded them, and read back only through GET /api/dispute-evidence/files/:token by that member or an admin.
 * submitOwnerEvidence accepts only these URLs, and only the uploader's own.
 */
export const EVIDENCE_FILE_PREFIX = "/api/dispute-evidence/files/";
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

const CONTENT_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };

export const evidenceFileUrl = (token: string) => `${EVIDENCE_FILE_PREFIX}${token}`;

/** The token inside one of our evidence URLs, or null for anything else (other paths, other hosts, query strings). */
export function evidenceTokenOf(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith(EVIDENCE_FILE_PREFIX)) return null;
  const token = url.slice(EVIDENCE_FILE_PREFIX.length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

export async function saveEvidenceUpload(userId: number, file: { buffer: Buffer; originalname: string }): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) throw new Error("Unsupported image type");
  const storageKey = await savePrivateFile(file.buffer, ext);
  const token = randomBytes(16).toString("hex");
  await db.insert(evidenceUploads).values({ token, storageKey, contentType, userId });
  return evidenceFileUrl(token);
}

/** True when every url is an evidence upload made by this user. */
export async function allUploadedBy(urls: string[], userId: number): Promise<boolean> {
  for (const url of urls) {
    const token = evidenceTokenOf(url);
    if (!token) return false;
    const [row] = await db.select({ userId: evidenceUploads.userId }).from(evidenceUploads).where(eq(evidenceUploads.token, token)).limit(1);
    if (!row || row.userId !== userId) return false;
  }
  return true;
}

/** The file, if the viewer is the uploader or an admin. Anyone else, and a missing file, look the same: not found. */
export async function readEvidenceFile(token: string, viewer: { id: number; isAdmin?: boolean | null }): Promise<{ body: Buffer; contentType: string } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db.select().from(evidenceUploads).where(eq(evidenceUploads.token, token)).limit(1);
  if (!row || !row.storageKey || !row.contentType) return null;
  if (row.userId !== viewer.id && !viewer.isAdmin) return null;
  const body = await readPrivateFile(row.storageKey);
  return body ? { body, contentType: row.contentType } : null;
}
