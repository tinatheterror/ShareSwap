import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Search, CheckCircle, Unlock, XCircle, ChevronLeft, ChevronRight, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { useDebounce } from "@/hooks/use-debounce";

interface AdminTransaction {
  id: number;
  status: string;
  requestType: string;
  depositStatus: string | null;
  trustDepositAmount: string | null;
  depositPaymentIntentId: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  itemId: number;
  itemName: string;
  requesterId: number;
  requesterUsername: string | null;
  requesterEmail: string | null;
  ownerId: number | null;
  ownerUsername: string | null;
}

interface TxResponse {
  transactions: AdminTransaction[];
  total: number;
  page: number;
  pages: number;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-green-100 text-green-800",
  DEPOSIT_CONFIRMED: "bg-teal-100 text-teal-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  RETURN_REQUESTED: "bg-purple-100 text-purple-800",
  COMPLETED: "bg-gray-100 text-gray-700",
  DECLINED: "bg-red-100 text-red-800",
  DISPUTED: "bg-red-100 text-red-800",
  HANDOFF_DISPUTED: "bg-orange-100 text-orange-800",
};

const ALL_STATUSES = ["PENDING","ACCEPTED","DEPOSIT_CONFIRMED","IN_PROGRESS","RETURN_REQUESTED","COMPLETED","DECLINED","DISPUTED","HANDOFF_DISPUTED","AWAITING_HANDOFF_CONFIRM"];

type Action = "complete" | "release_deposit" | "cancel";
interface OverrideTarget { tx: AdminTransaction; action: Action }

const ACTION_LABELS: Record<Action, string> = {
  complete: "Mark as completed",
  release_deposit: "Release deposit hold",
  cancel: "Cancel transaction",
};

const ACTION_DESCRIPTIONS: Record<Action, string> = {
  complete: "This will force the transaction to COMPLETED status and mark the item as available again.",
  release_deposit: "This will cancel the Stripe authorization and mark the temporary deposit hold as released. The borrower is not charged.",
  cancel: "This will set the status to DECLINED, release any temporary deposit hold, and restore item availability.",
};

export default function AdminTransactionsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [overrideTarget, setOverrideTarget] = useState<OverrideTarget | null>(null);
  const debouncedSearch = useDebounce(search, 400);

  const { data, isLoading } = useQuery<TxResponse>({
    queryKey: ["/api/admin/transactions", debouncedSearch, statusFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("page", String(page));
      return fetch(`/api/admin/transactions?${params}`).then(r => r.json());
    },
  });

  const overrideMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: Action }) =>
      apiRequest("POST", `/api/admin/transactions/${id}/override`, { action }).then(r => r.json()),
    onSuccess: (_, { action }) => {
      toast({ title: `Action completed: ${ACTION_LABELS[action]}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/transactions"] });
      setOverrideTarget(null);
    },
    onError: () => toast({ title: "Override failed", variant: "destructive" }),
  });

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {data ? `${data.total.toLocaleString()} records` : "Loading…"}
            </p>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by item name, user, or transaction ID…"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {ALL_STATUSES.map(s => (
                <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          {isLoading && [1,2,3,4,5].map(i => (
            <div key={i} className="h-24 rounded-xl bg-gray-200 animate-pulse" />
          ))}

          {!isLoading && data?.transactions.length === 0 && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No transactions found</CardContent></Card>
          )}

          {data?.transactions.map(tx => (
            <Card key={tx.id}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">#{tx.id} · {tx.itemName}</span>
                      <Badge className={`text-xs ${STATUS_COLORS[tx.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {tx.status.replace(/_/g, " ")}
                      </Badge>
                      <Badge variant="outline" className="text-xs">{tx.requestType}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {tx.requesterUsername || `User ${tx.requesterId}`}
                      {tx.requesterEmail && ` · ${tx.requesterEmail}`}
                      {tx.ownerUsername && ` → ${tx.ownerUsername}`}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                      {tx.trustDepositAmount && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          ${parseFloat(tx.trustDepositAmount).toFixed(2)} deposit
                          {tx.depositStatus && <span className="ml-1 font-medium">({tx.depositStatus === "authorized" || tx.depositStatus === "held" ? "temporary hold" : tx.depositStatus === "captured" ? "charged — claim opened" : tx.depositStatus === "released" ? "hold released" : tx.depositStatus === "settled" ? "claim resolved" : tx.depositStatus})</span>}
                        </span>
                      )}
                      {tx.startDate && <span>{format(new Date(tx.startDate), "MMM d")} – {tx.endDate ? format(new Date(tx.endDate), "MMM d, yyyy") : "?"}</span>}
                      <span>Created {format(new Date(tx.createdAt), "MMM d, yyyy")}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    {tx.status !== "COMPLETED" && tx.status !== "DECLINED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-700 border-green-200 hover:bg-green-50 text-xs h-7 px-2"
                        onClick={() => setOverrideTarget({ tx, action: "complete" })}
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Complete
                      </Button>
                    )}
                    {tx.depositStatus === "held" || tx.depositStatus === "authorized" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-blue-700 border-blue-200 hover:bg-blue-50 text-xs h-7 px-2"
                        onClick={() => setOverrideTarget({ tx, action: "release_deposit" })}
                      >
                        <Unlock className="h-3 w-3 mr-1" />
                        Release hold
                      </Button>
                    ) : null}
                    {tx.status !== "COMPLETED" && tx.status !== "DECLINED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-700 border-red-200 hover:bg-red-50 text-xs h-7 px-2"
                        onClick={() => setOverrideTarget({ tx, action: "cancel" })}
                      >
                        <XCircle className="h-3 w-3 mr-1" />
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {data && data.pages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-5">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">Page {page} of {data.pages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= data.pages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <Dialog open={!!overrideTarget} onOpenChange={open => !open && setOverrideTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{overrideTarget ? ACTION_LABELS[overrideTarget.action] : ""}</DialogTitle>
            <DialogDescription>{overrideTarget ? ACTION_DESCRIPTIONS[overrideTarget.action] : ""}</DialogDescription>
          </DialogHeader>
          <div className="text-sm text-muted-foreground bg-gray-50 rounded-lg px-3 py-2">
            Transaction #{overrideTarget?.tx.id} · {overrideTarget?.tx.itemName} · {overrideTarget?.tx.status}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOverrideTarget(null)}>Cancel</Button>
            <Button
              className={overrideTarget?.action === "cancel" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-gray-900 hover:bg-gray-800 text-white"}
              onClick={() => overrideTarget && overrideMutation.mutate({ id: overrideTarget.tx.id, action: overrideTarget.action })}
              disabled={overrideMutation.isPending}
            >
              {overrideMutation.isPending ? "Processing…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
