import { AdminLayout } from "@/components/admin/admin-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Flag, Handshake } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

// Exchanges waiting for an admin's decision: disputes and exchanges flagged for review, oldest first. Deciding for the owner
// means the handoff happened (the ShareCoins held for it move); deciding for the borrower/requester means it did not (they
// are released). Both people are told the outcome.

interface QueueMessage { id: number; from: "owner" | "requester" | "system"; type: string | null; content: string; createdAt: string }
interface QueueRow {
  id: number;
  kind: "dispute" | "flagged";
  status: string;
  requestType: "BORROW" | "RENT" | "SWAP" | "GIFT";
  itemName: string;
  owner: { id: number | null; name: string };
  requester: { id: number | null; name: string };
  openedAt: string;
  ownerConfirmed: boolean;
  requesterConfirmed: boolean;
  ownerDenied: boolean;
  requesterDenied: boolean;
  autoConfirmed: boolean;
  proofDeadline: string | null;
  proof: { owner: string | null; requester: string | null };
  held: { amount: number; kind: string; payer: "owner" | "requester" } | null;
  messages: QueueMessage[];
}

const requesterWord = (type: string) => (type === "BORROW" || type === "RENT" ? "borrower" : "requester");

export default function AdminHandoffDisputesPage() {
  const { toast } = useToast();
  const [deciding, setDeciding] = useState<{ row: QueueRow; decision: "owner" | "requester" } | null>(null);
  const { data: rows = [], isLoading } = useQuery<QueueRow[]>({ queryKey: ["/api/admin/handoff-disputes"] });

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: number; decision: "owner" | "requester" }) => {
      const res = await apiRequest("POST", `/api/admin/handoff-disputes/${id}/resolve`, { decision });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Decision recorded", description: "Both people have been told the outcome." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/handoff-disputes"] });
    },
    onError: (e: Error) => toast({ title: "Could not record the decision", description: e.message, variant: "destructive" }),
    onSettled: () => setDeciding(null),
  });

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Handshake className="h-6 w-6 text-teal-600" />
          <div>
            <h1 className="text-2xl font-bold">Handoff disputes</h1>
            <p className="text-sm text-muted-foreground">
              Disputes and flagged exchanges waiting for a decision, oldest first. The ShareCoins held for each stay held until you decide.
            </p>
          </div>
          <Badge className="ml-auto bg-amber-100 text-amber-800 text-sm" data-testid="handoff-queue-count">{rows.length} waiting</Badge>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground" data-testid="handoff-queue-loading">Loading…</div>
        ) : rows.length === 0 ? (
          <Card><CardContent className="py-6 text-sm text-muted-foreground" data-testid="handoff-queue-empty">Nothing is waiting for a decision.</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {rows.map((row) => {
              const side = requesterWord(row.requestType);
              return (
                <Card key={row.id} data-testid={`handoff-queue-row-${row.id}`}>
                  <CardContent className="py-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {row.kind === "flagged" ? <Flag className="h-4 w-4 text-orange-500" /> : null}
                      <span className="font-semibold">{row.itemName}</span>
                      <Badge variant="outline">{row.requestType}</Badge>
                      <Badge className={row.kind === "flagged" ? "bg-orange-100 text-orange-800" : "bg-red-100 text-red-800"}>
                        {row.kind === "flagged" ? "Flagged for review" : "Disputed"}
                      </Badge>
                      {row.autoConfirmed ? <Badge variant="outline">Auto-confirmed</Badge> : null}
                      <span className="ml-auto text-xs text-muted-foreground">Since {format(new Date(row.openedAt), "MMM d, yyyy h:mm a")}</span>
                    </div>

                    <div className="text-sm grid sm:grid-cols-2 gap-2">
                      <div>
                        <span className="text-muted-foreground">Owner:</span> {row.owner.name}{" "}
                        {row.ownerConfirmed ? <Badge variant="outline">confirmed</Badge> : null}{" "}
                        {row.ownerDenied ? <Badge variant="outline">denied</Badge> : null}
                      </div>
                      <div>
                        <span className="text-muted-foreground capitalize">{side}:</span> {row.requester.name}{" "}
                        {row.requesterConfirmed ? <Badge variant="outline">confirmed</Badge> : null}{" "}
                        {row.requesterDenied ? <Badge variant="outline">denied</Badge> : null}
                      </div>
                    </div>

                    {row.held ? (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Held:</span> {row.held.amount} ShareCoins from the{" "}
                        {row.held.payer === "owner" ? "owner" : side}.
                      </p>
                    ) : null}

                    {(row.proof.owner || row.proof.requester) ? (
                      <div className="text-sm space-y-1" data-testid={`handoff-queue-proof-${row.id}`}>
                        <p className="font-medium">Proof</p>
                        {row.proof.owner ? <p><span className="text-muted-foreground">Owner:</span> {row.proof.owner}</p> : null}
                        {row.proof.requester ? <p><span className="text-muted-foreground capitalize">{side}:</span> {row.proof.requester}</p> : null}
                      </div>
                    ) : null}

                    <div>
                      <p className="text-sm font-medium mb-1">Messages ({row.messages.length})</p>
                      <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/30 p-2 space-y-1 text-sm" data-testid={`handoff-queue-messages-${row.id}`}>
                        {row.messages.length === 0 ? <p className="text-muted-foreground">No messages.</p> : row.messages.map((m) => (
                          <p key={m.id} className={m.from === "system" || m.type === "system" || m.type === "event" ? "text-xs text-muted-foreground" : ""}>
                            <span className="font-medium capitalize">{m.from === "requester" ? side : m.from}:</span> {m.content}
                            <span className="ml-2 text-[10px] text-muted-foreground">{format(new Date(m.createdAt), "MMM d h:mm a")}</span>
                          </p>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" onClick={() => setDeciding({ row, decision: "owner" })} data-testid={`handoff-decide-owner-${row.id}`}>
                        Decide for the owner (handoff happened)
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDeciding({ row, decision: "requester" })} data-testid={`handoff-decide-requester-${row.id}`}>
                        Decide for the {side} (it did not)
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!deciding} onOpenChange={(open) => { if (!open) setDeciding(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deciding?.decision === "owner" ? "The handoff happened" : "The handoff did not happen"}
            </DialogTitle>
            <DialogDescription>
              {deciding?.decision === "owner"
                ? "The exchange goes ahead and the ShareCoins held for it move. Both people are told."
                : "The exchange is cancelled, payments are refunded and the ShareCoins held for it are released. Both people are told."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>Cancel</Button>
            <Button
              disabled={decide.isPending}
              onClick={() => deciding && decide.mutate({ id: deciding.row.id, decision: deciding.decision })}
              data-testid="handoff-decision-confirm"
            >
              {decide.isPending ? "Saving…" : "Confirm decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
