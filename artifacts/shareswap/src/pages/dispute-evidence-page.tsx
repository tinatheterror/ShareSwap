import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/shared/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";

// The owner's answer to a request for evidence on a payment dispute (POST /api/disputes/:id/evidence).
export const EVIDENCE_NOTE_MAX = 4000;
export const EVIDENCE_PHOTOS_MAX = 10;
const QUERY_KEY = "/api/disputes/evidence-requests";

interface EvidenceRequest { disputeId: string; requestId: number | null; itemName: string | null; dueBy: string | null; requestedAt: string | null }

/** An error message, or null when the note and photos can be sent. */
export function evidenceProblem(note: string, photoCount: number): string | null {
  if (!note.trim() && photoCount === 0) return "Add a note, a photo, or both.";
  if (note.length > EVIDENCE_NOTE_MAX) return `The note is too long (${EVIDENCE_NOTE_MAX} characters at most).`;
  if (photoCount > EVIDENCE_PHOTOS_MAX) return `Add at most ${EVIDENCE_PHOTOS_MAX} photos.`;
  return null;
}

function EvidenceCard({ request, focused }: { request: EvidenceRequest; focused: boolean }) {
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const send = useMutation({
    mutationFn: async () => {
      const csrfRes = await fetch("/api/csrf-token", { credentials: "include" });
      const { csrfToken } = await csrfRes.json();
      const photoUrls: string[] = [];
      for (const photo of photos) {
        const formData = new FormData();
        formData.append("photo", photo);
        const uploadRes = await fetch("/api/uploads/claim-evidence", { method: "POST", credentials: "include", headers: { "x-csrf-token": csrfToken }, body: formData });
        if (!uploadRes.ok) throw new Error((await uploadRes.json().catch(() => ({}))).error || "Could not upload a photo");
        photoUrls.push((await uploadRes.json()).url);
      }
      const res = await apiRequest("POST", `/api/disputes/${encodeURIComponent(request.disputeId)}/evidence`, { note: note.trim() || undefined, photoUrls });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Could not send your evidence");
    },
    onSuccess: () => { setSent(true); queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }); },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    const problem = evidenceProblem(note, photos.length);
    if (problem) { setError(problem); return; }
    setError(null);
    send.mutate();
  };
  const due = request.dueBy ? new Date(request.dueBy).toLocaleDateString() : null;

  return (
    <Card data-testid={`evidence-card-${request.disputeId}`} className={focused ? "ring-2 ring-teal-500" : ""}>
      <CardContent className="space-y-3 p-5">
        <h2 className="text-lg font-semibold text-gray-900">{request.itemName ?? "A payment you received"}</h2>
        {due && <p className="text-sm text-gray-600">We need your evidence by {due}.</p>}
        <p className="text-sm text-gray-600">You will not be charged. We need your handoff confirmation, photos and messages to answer the dispute.</p>
        {sent ? (
          <p data-testid="evidence-sent" className="font-medium text-green-700">Thank you, your evidence was sent.</p>
        ) : (
          <>
            <Textarea data-testid="evidence-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="What happened at the handoff? Anything that shows the item was handed over." />
            <input ref={fileInput} data-testid="evidence-files" type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { setPhotos((current) => [...current, ...Array.from(e.target.files ?? [])].slice(0, EVIDENCE_PHOTOS_MAX)); e.target.value = ""; }} />
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" disabled={send.isPending || photos.length >= EVIDENCE_PHOTOS_MAX} onClick={() => fileInput.current?.click()}>Add photos ({photos.length}/{EVIDENCE_PHOTOS_MAX})</Button>
              {photos.length > 0 && <Button type="button" variant="ghost" onClick={() => setPhotos([])}>Clear photos</Button>}
            </div>
            {error && <p data-testid="evidence-error" className="text-sm text-red-600">{error}</p>}
            <Button data-testid="evidence-submit" disabled={send.isPending} onClick={submit}>{send.isPending ? "Sending…" : "Send evidence"}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function DisputeEvidencePage() {
  const { data, isLoading } = useQuery<{ requests: EvidenceRequest[] }>({ queryKey: [QUERY_KEY] });
  const focusId = Number(new URLSearchParams(window.location.search).get("requestId")) || null;
  const requests = data?.requests ?? [];
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900">Evidence for a dispute</h1>
        {isLoading && <p className="text-gray-600">Loading…</p>}
        {!isLoading && requests.length === 0 && <p data-testid="evidence-empty" className="text-gray-600">Nothing is waiting for your evidence.</p>}
        {requests.map((request) => <EvidenceCard key={request.disputeId} request={request} focused={focusId !== null && request.requestId === focusId} />)}
      </div>
    </div>
  );
}
