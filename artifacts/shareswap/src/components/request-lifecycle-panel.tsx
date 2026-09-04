import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, MessageSquare, RotateCcw, FileWarning, ImagePlus, X } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Claim = { id: number; claimType: string; reason: string; evidence?: unknown[]; requestedAmount: string; approvedAmount?: string | null; status: string; responseDeadlineAt?: string | null; settlementStatus?: string | null; decisionReason?: string | null };
type Lifecycle = {
  lifecycle: {
    requestId: number; stage: string; deadline?: string | null; lateHours: number; role: "owner" | "borrower"; actions: string[];
    deposit: { mode?: string | null; status?: string | null; amount?: string | null; expiresAt?: string | null; protectionReviewRequired?: boolean };
  }; claims: Claim[]; events: { eventType: string; createdAt: string }[];
};

const LIFECYCLE_STAGES: Record<string, { title: string; description: string; tone: string }> = {
  ACTIVE: { title: "Return scheduled", description: "Keep the return arrangement with the other member.", tone: "border-teal-200 bg-teal-50 text-teal-900" },
  RETURN_DUE: { title: "Return due", description: "This item is due for return.", tone: "border-amber-200 bg-amber-50 text-amber-900" },
  OVERDUE_GRACE: { title: "Overdue grace", description: "Please arrange the return as soon as possible.", tone: "border-amber-200 bg-amber-50 text-amber-900" },
  OVERDUE: { title: "Overdue", description: "The item has not yet been returned.", tone: "border-orange-200 bg-orange-50 text-orange-900" },
  SERIOUSLY_OVERDUE: { title: "Final return warning", description: "If it is not returned, the owner may be eligible to open a non-return claim.", tone: "border-red-200 bg-red-50 text-red-900" },
  NON_RETURN_REVIEW: { title: "Non-return review", description: "ShareSwap is reviewing whether a non-return claim is eligible.", tone: "border-red-200 bg-red-50 text-red-900" },
  RETURNED_PENDING_REVIEW: { title: "Returned pending review", description: "The return is awaiting review.", tone: "border-blue-200 bg-blue-50 text-blue-900" },
  RETURN_REQUESTED: { title: "Returned pending review", description: "The return is awaiting owner confirmation.", tone: "border-blue-200 bg-blue-50 text-blue-900" },
};

export function RequestLifecyclePanel({ requestId, onContact, onReturn, onExtension }: {
  requestId: number; onContact: () => void; onReturn?: () => void; onExtension?: () => void;
}) {
  const qc = useQueryClient();
  const [openClaim, setOpenClaim] = useState(false);
  const [respondingTo, setRespondingTo] = useState<Claim | null>(null);
  const [claimType, setClaimType] = useState("damage");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");
  const [evidencePhotos, setEvidencePhotos] = useState<{ file: File; preview: string }[]>([]);
  const [response, setResponse] = useState("");
  const { data, isLoading, isError } = useQuery<Lifecycle>({ queryKey: ["/api/requests", requestId, "lifecycle"], queryFn: async () => {
    const res = await fetch(`/api/requests/${requestId}/lifecycle`, { credentials: "include" });
    if (!res.ok) throw new Error("Could not load return status");
    return res.json();
  }, refetchInterval: 20_000 });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["/api/requests", requestId, "lifecycle"] }); qc.invalidateQueries({ queryKey: ["/api/requests"] }); };
  const claimMutation = useMutation({ mutationFn: async () => {
    const csrfRes = await fetch("/api/csrf-token", { credentials: "include" });
    const { csrfToken } = await csrfRes.json();
    const uploadedPhotoUrls: string[] = [];
    for (const photo of evidencePhotos) {
      const formData = new FormData();
      formData.append("photo", photo.file);
      const uploadRes = await fetch("/api/uploads/claim-evidence", {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": csrfToken },
        body: formData,
      });
      if (!uploadRes.ok) throw new Error((await uploadRes.json()).error || "Could not upload evidence photo");
      uploadedPhotoUrls.push((await uploadRes.json()).url);
    }
    const res = await apiRequest("POST", `/api/requests/${requestId}/claims`, { claimType, reason, requestedAmount: Number(amount), evidence: [...evidence.split(/\n|,/).map(x => x.trim()).filter(Boolean), ...uploadedPhotoUrls] });
    if (!res.ok) throw new Error((await res.json()).error || "Could not open claim");
    return res.json();
  }, onSuccess: () => { evidencePhotos.forEach(photo => URL.revokeObjectURL(photo.preview)); setEvidencePhotos([]); setOpenClaim(false); setReason(""); setAmount(""); setEvidence(""); invalidate(); } });
  const responseMutation = useMutation({ mutationFn: async () => {
    const res = await apiRequest("POST", `/api/claims/${respondingTo!.id}/respond`, { response });
    if (!res.ok) throw new Error((await res.json()).error || "Could not submit response");
    return res.json();
  }, onSuccess: () => { setRespondingTo(null); setResponse(""); invalidate(); } });
  if (isLoading) return <div data-testid={`lifecycle-loading-${requestId}`} className="text-xs text-muted-foreground">Loading return status…</div>;
  if (isError || !data) return <div data-testid={`lifecycle-error-${requestId}`} className="text-xs text-muted-foreground">Return status is temporarily unavailable.</div>;
  const { lifecycle } = data;
  const stage = LIFECYCLE_STAGES[lifecycle.stage];
  const deposit = Number(lifecycle.deposit.amount || 0);
  const can = (action: string) => lifecycle.actions.includes(action);
  const eligibleToClaim = lifecycle.role === "owner" && can("open_claim") && !data.claims.some(c => !["REJECTED", "SETTLED"].includes(c.status));
  return <div data-testid={`lifecycle-panel-${requestId}`} className="space-y-2">
    {stage && <div className={`rounded-lg border p-3 ${stage.tone}`}>
      <p className="flex items-center gap-1.5 text-base font-bold leading-tight"><AlertTriangle className="h-4 w-4 shrink-0" />{stage.title}</p>
      <p className="mt-1.5 text-sm font-medium leading-snug">{stage.description}</p>
      {lifecycle.deadline && <p className="mt-2 text-xs font-semibold tracking-wide">Return deadline: {format(new Date(lifecycle.deadline), "MMM d, yyyy p")} {lifecycle.lateHours > 0 && `· ${lifecycle.lateHours < 24 ? `${lifecycle.lateHours} hours` : formatDistanceToNowStrict(new Date(lifecycle.deadline))} late`}</p>}
      <p className="mt-2 border-t border-current/15 pt-2 text-xs font-normal leading-relaxed opacity-75">A late return never automatically settles a security deposit.</p>
    </div>}
    <div className="rounded-lg border bg-muted/30 p-2 text-xs"><span className="font-medium">Security deposit:</span> ${deposit.toFixed(2)} · {lifecycle.deposit.status || "status unavailable"}{lifecycle.deposit.mode ? ` · ${lifecycle.deposit.mode}` : ""} · settlement is independent of lateness.{lifecycle.deposit.expiresAt ? ` Capture deadline: ${format(new Date(lifecycle.deposit.expiresAt), "MMM d, yyyy p")}.` : ""}{lifecycle.deposit.protectionReviewRequired ? " Protection requires manual review." : ""}</div>
    {data.claims.map(claim => <div key={claim.id} data-testid={`claim-${claim.id}`} className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs space-y-1"><p className="font-semibold">Claim #{claim.id}: {claim.status.replaceAll("_", " ")}</p><p>{claim.claimType}: {claim.reason}</p><p>Requested: ${Number(claim.requestedAmount).toFixed(2)}{claim.approvedAmount && ` · Approved: $${Number(claim.approvedAmount).toFixed(2)}`}</p>
      {claim.evidence?.length ? <p>Evidence: {claim.evidence.join(", ")}</p> : null}{claim.decisionReason && <p>Decision: {claim.decisionReason}</p>}{claim.responseDeadlineAt && <p>Response deadline: {format(new Date(claim.responseDeadlineAt), "MMM d, yyyy p")}</p>}
      <p>Settlement: {claim.settlementStatus || "not settled"}{claim.status === "SETTLED" && " · any remainder is released or refunded."}</p>
      {lifecycle.role === "borrower" && can("respond_to_claim") && claim.status === "CUSTOMER_RESPONSE_PENDING" && <Button data-testid={`button-respond-claim-${claim.id}`} size="sm" variant="outline" onClick={() => setRespondingTo(claim)}>Respond to claim</Button>}</div>)}
    {stage && <div className="flex flex-wrap gap-2">{can("arrange_return") && <Button data-testid={`button-contact-return-${requestId}`} size="sm" variant="outline" onClick={onContact}><MessageSquare className="mr-1 h-3.5 w-3.5" />Contact / arrange return</Button>}
      {lifecycle.role === "borrower" && onReturn && <Button data-testid={`button-return-overdue-${requestId}`} size="sm" onClick={onReturn}><RotateCcw className="mr-1 h-3.5 w-3.5" />Return item</Button>}
      {lifecycle.role === "borrower" && can("request_extension") && onExtension && ["RETURN_DUE", "OVERDUE_GRACE", "OVERDUE", "SERIOUSLY_OVERDUE"].includes(lifecycle.stage) && <Button data-testid={`button-extension-overdue-${requestId}`} size="sm" variant="outline" onClick={onExtension}><Clock className="mr-1 h-3.5 w-3.5" />Request extension</Button>}
      {eligibleToClaim && <Button data-testid={`button-open-claim-${requestId}`} size="sm" variant="outline" className="border-red-300 text-red-700" onClick={() => setOpenClaim(true)}><FileWarning className="mr-1 h-3.5 w-3.5" />Report an issue / Open a claim</Button>}</div>}
    <Dialog open={openClaim} onOpenChange={setOpenClaim}><DialogContent><DialogHeader><DialogTitle>Report an issue / Open a claim</DialogTitle><DialogDescription>Tell us what happened with the item.</DialogDescription></DialogHeader><Label>Type <select data-testid="select-claim-type" className="mt-1 w-full border rounded h-10 px-2" value={claimType} onChange={e => setClaimType(e.target.value)}><option value="non_return">Item not returned</option><option value="lost">Lost</option><option value="damage">Damage</option><option value="missing_components">Missing components</option><option value="other">Other</option></select></Label><Label>Reason<Textarea data-testid="input-claim-reason" value={reason} onChange={e => setReason(e.target.value)} /></Label><Label>Amount requested<Input data-testid="input-claim-amount" type="number" min="0.01" max={deposit} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /><span className="mt-1 block text-xs font-normal text-muted-foreground">Maximum claim amount: ${deposit.toFixed(2)}</span></Label><div className="space-y-2"><Label htmlFor={`claim-evidence-${requestId}`}>Evidence (optional)</Label><Textarea id={`claim-evidence-${requestId}`} data-testid="input-claim-evidence" placeholder="Details or links..." value={evidence} onChange={e => setEvidence(e.target.value)} /><input id={`claim-evidence-photos-${requestId}`} data-testid="input-claim-evidence-photos" className="hidden" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple onChange={event => {
      const files = Array.from(event.target.files || []).slice(0, Math.max(0, 5 - evidencePhotos.length));
      setEvidencePhotos(current => [...current, ...files.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
      event.target.value = "";
    }} /><Button type="button" variant="outline" size="sm" disabled={evidencePhotos.length >= 5 || claimMutation.isPending} onClick={() => document.getElementById(`claim-evidence-photos-${requestId}`)?.click()}><ImagePlus className="mr-1.5 h-4 w-4" />Add photos</Button>{evidencePhotos.length > 0 && <div className="grid grid-cols-5 gap-2">{evidencePhotos.map((photo, index) => <div key={photo.preview} className="relative aspect-square overflow-hidden rounded-md border"><img src={photo.preview} alt={`Evidence ${index + 1}`} className="h-full w-full object-cover" /><button type="button" aria-label={`Remove evidence photo ${index + 1}`} className="absolute right-1 top-1 rounded-full bg-black/65 p-1 text-white" onClick={() => { URL.revokeObjectURL(photo.preview); setEvidencePhotos(current => current.filter(item => item !== photo)); }}><X className="h-3 w-3" /></button></div>)}</div>}<p className="text-xs text-muted-foreground">Add up to 5 JPG, PNG, GIF, or WebP photos.</p></div><DialogFooter><Button variant="outline" onClick={() => setOpenClaim(false)}>Cancel</Button><Button data-testid="button-submit-claim" disabled={!reason.trim() || !amount || Number(amount) > deposit || claimMutation.isPending} onClick={() => claimMutation.mutate()}>{claimMutation.isPending ? "Uploading and submitting…" : "Submit claim"}</Button></DialogFooter>{claimMutation.isError && <p className="text-sm text-destructive">{claimMutation.error.message}</p>}</DialogContent></Dialog>
    <Dialog open={!!respondingTo} onOpenChange={open => !open && setRespondingTo(null)}><DialogContent><DialogHeader><DialogTitle>Respond to claim</DialogTitle><DialogDescription>ShareSwap will review your response with the claim evidence.</DialogDescription></DialogHeader><Textarea data-testid="input-claim-response" value={response} onChange={e => setResponse(e.target.value)} /><DialogFooter><Button variant="outline" onClick={() => setRespondingTo(null)}>Cancel</Button><Button data-testid="button-submit-claim-response" disabled={!response.trim() || responseMutation.isPending} onClick={() => responseMutation.mutate()}>{responseMutation.isPending ? "Submitting…" : "Submit response"}</Button></DialogFooter>{responseMutation.isError && <p className="text-sm text-destructive">{responseMutation.error.message}</p>}</DialogContent></Dialog>
  </div>;
}