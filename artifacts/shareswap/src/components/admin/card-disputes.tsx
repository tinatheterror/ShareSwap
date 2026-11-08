import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface CardDispute {
  disputeId: string;
  requestId: number | null;
  itemName: string | null;
  reason: string | null;
  amountCents: number;
  currency: string;
  feeCents: number;
  outcome: string;
  reviewStatus: string;
  lossAmountCents: number;
  lossFeeCents: number;
  rentalWasOpen: boolean;
  /** Stripe's deadline for our evidence (evidence_details.due_by). */
  evidenceDueBy: string | null;
  evidenceSubmittedToStripeAt: string | null;
  /** When the card authorization behind the deposit hold runs out. */
  depositAuthorizationExpiresAt: string | null;
  depositStatus: string | null;
  createdAt: string;
}

const ALERT_WINDOW_MS = 48 * 3_600_000;
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "due" within 48 hours is flagged in red, a date already past is struck as passed. */
function Deadline({ label, iso, testId, done }: { label: string; iso: string | null; testId: string; done?: boolean }) {
  if (!iso) return <p className="text-xs text-muted-foreground" data-testid={testId}>{label}: not known</p>;
  const left = new Date(iso).getTime() - Date.now();
  const soon = !done && left > 0 && left <= ALERT_WINDOW_MS;
  const passed = left <= 0;
  return (
    <p className={`text-xs ${soon ? "font-semibold text-red-600" : "text-muted-foreground"}`} data-testid={testId}>
      {label}: {when(iso)}{soon ? " (within 48 hours)" : passed ? " (passed)" : ""}
    </p>
  );
}

export function CardDisputeRow({ dispute: d }: { dispute: CardDispute }) {
  const holdLapsed = d.depositStatus === "EXPIRED_UNSECURED";
  return (
    <Card data-testid={`card-dispute-${d.disputeId}`} className="border-amber-200">
      <CardContent className="space-y-1.5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{d.itemName ?? "A payment"}{d.requestId ? ` · request #${d.requestId}` : " · not matched to a request"}</p>
          <Badge variant="outline">{d.outcome}</Badge>
          <Badge className={d.reviewStatus === "pending_admin" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}>
            {d.reviewStatus === "pending_admin" ? "needs review" : "reviewed"}
          </Badge>
        </div>
        <p className="text-sm">
          {money(d.amountCents, d.currency)} disputed ({d.reason ?? "no reason given"}) · Stripe fee {money(d.feeCents, d.currency)} · platform loss {money(d.lossAmountCents + d.lossFeeCents, d.currency)}
        </p>
        <Deadline label="Stripe needs evidence by" iso={d.evidenceDueBy} testId={`due-by-${d.disputeId}`} done={d.outcome !== "open" || !!d.evidenceSubmittedToStripeAt} />
        {d.requestId && (
          <Deadline label="Deposit authorization expires" iso={d.depositAuthorizationExpiresAt} testId={`auth-expiry-${d.disputeId}`} done={holdLapsed || ["captured", "settled", "released"].includes(d.depositStatus ?? "")} />
        )}
        {d.rentalWasOpen && d.reviewStatus === "pending_admin" && (
          <p className="text-xs text-muted-foreground">The rental was open when this was disputed: its deposit hold stays in place until you review the case.</p>
        )}
        <p className="text-xs text-muted-foreground">Evidence bundle: /api/admin/chargebacks/{d.disputeId}/evidence</p>
      </CardContent>
    </Card>
  );
}

export function CardDisputes() {
  const { data, isLoading } = useQuery<{ disputes: CardDispute[] }>({ queryKey: ["/api/admin/chargebacks"] });
  const disputes = data?.disputes ?? [];
  return (
    <section className="mb-8 space-y-4" data-testid="card-disputes">
      <h2 className="text-lg font-semibold">Card disputes (chargebacks)</h2>
      <p className="text-sm text-muted-foreground">ShareSwap absorbs these; owners are not charged. Alerts go out 48 hours before either date below.</p>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : disputes.length === 0 ? <p className="text-sm text-muted-foreground">No card disputes.</p>
        : disputes.map((d) => <CardDisputeRow key={d.disputeId} dispute={d} />)}
    </section>
  );
}
