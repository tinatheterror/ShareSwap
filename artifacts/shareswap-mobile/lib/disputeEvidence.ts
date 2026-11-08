// The owner's answer to a request for evidence on a payment dispute. The server (POST /api/disputes/:id/evidence) takes a note
// of up to 4000 characters and up to 10 photo urls, and needs at least one of them.
export const DISPUTE_EVIDENCE_TYPE = "dispute_evidence_requested";
export const DISPUTE_EVIDENCE_PATH = "/dispute-evidence";
export const EVIDENCE_NOTE_MAX = 4000;
export const EVIDENCE_PHOTOS_MAX = 10;

export interface EvidenceRequest {
  disputeId: string;
  requestId: number | null;
  itemName: string | null;
  dueBy: string | null;
  requestedAt: string | null;
}

/** An error message, or null when the note and photos can be sent. */
export function evidenceProblem(note: string, photoCount: number): string | null {
  if (!note.trim() && photoCount === 0) return "Add a note, a photo, or both.";
  if (note.length > EVIDENCE_NOTE_MAX) return `The note is too long (${EVIDENCE_NOTE_MAX} characters at most).`;
  if (photoCount > EVIDENCE_PHOTOS_MAX) return `Add at most ${EVIDENCE_PHOTOS_MAX} photos.`;
  return null;
}

export function evidenceBody(note: string, photoUrls: string[]) {
  return { note: note.trim() || undefined, photoUrls };
}
