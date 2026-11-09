import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";

/** The admin evidence bundle (GET /api/admin/chargebacks/:id/evidence). */
export interface EvidenceBundle {
  dispute: {
    id: string; reason: string | null; outcome: string; reviewStatus: string; evidenceDueBy: string | null; evidenceSubmittedToStripeAt: string | null;
  };
  owner: string | null;
  borrower: string | null;
  ownerEvidence: Array<{ at: string | null; note: string | null; photoUrls: string[] }>;
  photos: string[];
  summaryText: string;
}

/** What the review panel needs to know about the dispute row it belongs to. */
export interface ReviewContext {
  disputeId: string;
  reviewStatus: string;
  depositStatus: string | null;
  urgentManualReview?: boolean;
  depositUncollectibleAt?: string | null;
  rentalCompletedAt?: string | null;
}

export const NOTE_MIN = 5;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const stripeDisputeUrl = (disputeId: string) => `https://dashboard.stripe.com/disputes/${encodeURIComponent(disputeId)}`;

async function post(path: string, body: unknown): Promise<string | null> {
  try {
    const res = await apiRequest("POST", path, body);
    if (res.ok) return null;
    return ((await res.json().catch(() => ({}))) as { message?: string }).message ?? "The request failed.";
  } catch (e) {
    return e instanceof Error ? e.message : "The request failed.";
  }
}

/**
 * Reviewing one card dispute: the evidence ShareSwap has, the owner's statement and photos, Stripe's due date, and the two things an admin
 * can record. ShareSwap does not send evidence to Stripe itself: the summary is copied into Stripe's dashboard, and "Record" marks it sent
 * (POST /api/admin/chargebacks/:id/review), which is also what lets the rental's deposit hold be released again.
 */
export function DisputeReviewPanel({ bundle, context, onChanged }: { bundle: EvidenceBundle; context: ReviewContext; onChanged?: () => void }) {
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [clearFlag, setClearFlag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const reviewed = context.reviewStatus !== "pending_admin";
  const evidenceSent = !!bundle.dispute.evidenceSubmittedToStripeAt;
  const holdLapsed = context.depositStatus === "EXPIRED_UNSECURED";
  const canCloseRental = holdLapsed && !context.rentalCompletedAt;
  const noteOk = note.trim().length >= NOTE_MIN;

  async function run(path: string, body: unknown, done: string) {
    setBusy(true);
    setMessage(null);
    const problem = await post(path, body);
    setBusy(false);
    if (problem) return setMessage({ kind: "error", text: problem });
    setMessage({ kind: "ok", text: done });
    onChanged?.();
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4" data-testid={`dispute-review-${context.disputeId}`}>
      {context.urgentManualReview && (
        <p className="rounded bg-red-50 p-2 text-sm font-semibold text-red-700" data-testid="urgent-banner">
          Urgent: the deposit authorization expired{context.depositUncollectibleAt ? ` on ${when(context.depositUncollectibleAt)}` : ""} while this dispute was
          unreviewed. The deposit can no longer be collected through it, and nothing will be charged automatically.
        </p>
      )}
      <div className="text-sm">
        <p>{bundle.owner ?? "The owner"} lent to {bundle.borrower ?? "the borrower"}. Reason: {bundle.dispute.reason ?? "none given"}.</p>
        <p data-testid="evidence-due">
          Stripe needs evidence by: {bundle.dispute.evidenceDueBy ? when(bundle.dispute.evidenceDueBy) : "not known"}
          {evidenceSent ? ` · recorded as sent ${when(bundle.dispute.evidenceSubmittedToStripeAt!)}` : ""}
        </p>
      </div>

      <div>
        <p className="text-sm font-medium">Owner's statement</p>
        {bundle.ownerEvidence.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="no-owner-evidence">The owner has not sent anything yet.</p>
          : bundle.ownerEvidence.map((e, i) => <p key={i} className="text-sm">{e.at ? `${when(e.at)}: ` : ""}{e.note ?? "(photos only)"}</p>)}
      </div>

      {bundle.photos.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="evidence-photos">
          {bundle.photos.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Evidence" className="h-20 w-20 rounded object-cover" /></a>
          ))}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Summary for Stripe's evidence form</p>
          <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(bundle.summaryText)}>Copy</Button>
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-xs" data-testid="summary-text">{bundle.summaryText}</pre>
        <p className="mt-1 text-xs text-muted-foreground">
          ShareSwap does not send this to Stripe. Paste it, with the photos, into the dispute in{" "}
          <a className="underline" href={stripeDisputeUrl(context.disputeId)} target="_blank" rel="noreferrer">Stripe's dashboard</a>, then record it below.
        </p>
      </div>

      {reviewed ? (
        <p className="text-sm text-green-700" data-testid="already-reviewed">This dispute has been reviewed.</p>
      ) : (
        <div className="space-y-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked and decided (required)" data-testid="review-note" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sent} onChange={(e) => setSent(e.target.checked)} data-testid="review-sent" /> I submitted the evidence in Stripe</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={clearFlag} onChange={(e) => setClearFlag(e.target.checked)} data-testid="review-clear-flag" /> Clear the borrower's account flag</label>
          <Button type="button" disabled={busy || !noteOk} data-testid="review-submit"
            onClick={() => run(`/api/admin/chargebacks/${encodeURIComponent(context.disputeId)}/review`, { note: note.trim(), evidenceSubmittedToStripe: sent, clearBorrowerFlag: clearFlag }, "Review recorded.")}>
            Record review
          </Button>
          {!noteOk && note.length > 0 && <p className="text-xs text-muted-foreground">Write at least {NOTE_MIN} characters.</p>}
        </div>
      )}

      {canCloseRental && (
        <div className="space-y-1 border-t pt-2">
          <p className="text-xs text-muted-foreground">
            The deposit hold has expired. You can close the rental in the app and leave this dispute open. This moves no money and does not touch Stripe.
          </p>
          <Button type="button" variant="outline" size="sm" disabled={busy || !noteOk} data-testid="complete-rental"
            onClick={() => run(`/api/admin/chargebacks/${encodeURIComponent(context.disputeId)}/complete-rental`, { note: note.trim() }, "Rental closed. The dispute is still open.")}>
            Close the rental (dispute stays open)
          </Button>
        </div>
      )}
      {context.rentalCompletedAt && <p className="text-xs text-muted-foreground" data-testid="rental-closed">Rental closed on {when(context.rentalCompletedAt)}; the dispute stays open.</p>}
      {message && <p className={`text-sm ${message.kind === "error" ? "text-red-600" : "text-green-700"}`} data-testid="review-message">{message.text}</p>}
    </div>
  );
}

/** Loads the bundle for one dispute and shows the panel. */
export function DisputeReview({ context }: { context: ReviewContext }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<EvidenceBundle>({ queryKey: [`/api/admin/chargebacks/${context.disputeId}/evidence`] });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading the evidence…</p>;
  if (isError || !data) return <p className="text-sm text-red-600">Could not load the evidence.</p>;
  return (
    <DisputeReviewPanel bundle={data} context={context}
      onChanged={() => { queryClient.invalidateQueries({ queryKey: ["/api/admin/chargebacks"] }); queryClient.invalidateQueries({ queryKey: [`/api/admin/chargebacks/${context.disputeId}/evidence`] }); }} />
  );
}
