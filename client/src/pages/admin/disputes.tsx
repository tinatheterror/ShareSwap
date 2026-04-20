import { AdminLayout } from "@/components/admin/admin-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertTriangle, CheckCircle, XCircle, Star, Package, User, DollarSign, Clock } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

interface Dispute {
  id: number;
  status: string;
  requestType: string;
  returnDisputeReason: string | null;
  returnDisputePhotoUrl: string | null;
  returnConditionNotes: string | null;
  returnConditionRating: number | null;
  trustDepositAmount: string | null;
  depositStatus: string | null;
  returnRequestedAt: string | null;
  returnConfirmedAt: string | null;
  itemName: string;
  itemImage: string | null;
  ownerName: string;
  borrowerName: string;
  ownerId: number;
  requesterId: number;
}

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-muted-foreground text-sm">—</span>;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`h-4 w-4 ${s <= rating ? "fill-amber-400 text-amber-400" : "text-gray-200"}`}
        />
      ))}
      <span className="ml-1 text-sm text-muted-foreground">{rating}/5</span>
    </div>
  );
}

export default function AdminDisputesPage() {
  const { toast } = useToast();
  const [resolving, setResolving] = useState<{ id: number; decision: "owner" | "borrower" } | null>(null);

  const { data: disputes = [], isLoading } = useQuery<Dispute[]>({
    queryKey: ["/api/admin/disputes"],
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, decision }: { id: number; decision: "owner" | "borrower" }) => {
      const res = await apiRequest("POST", `/api/admin/disputes/${id}/resolve`, { decision });
      return res.json();
    },
    onSuccess: (_, { decision }) => {
      toast({
        title: "Dispute resolved",
        description:
          decision === "owner"
            ? "Deposit captured — damage confirmed."
            : "Deposit released back to borrower.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/disputes"] });
    },
    onError: () => {
      toast({ title: "Failed to resolve dispute", variant: "destructive" });
    },
    onSettled: () => setResolving(null),
  });

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold">Return Disputes</h1>
            <p className="text-sm text-muted-foreground">
              Review damage claims and release or capture security deposits.
            </p>
          </div>
          <Badge className="ml-auto bg-amber-100 text-amber-800 text-sm">
            {disputes.length} open
          </Badge>
        </div>

        {isLoading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 rounded-xl bg-gray-200 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && disputes.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center">
              <CheckCircle className="h-12 w-12 text-teal-400 mx-auto mb-3" />
              <p className="font-semibold text-lg">No open disputes</p>
              <p className="text-muted-foreground text-sm mt-1">All return disputes have been resolved.</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-5">
          {disputes.map((d) => (
            <Card key={d.id} className="overflow-hidden border-amber-200">
              <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="font-semibold text-sm text-amber-800">Damage dispute</span>
                  <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">
                    #{d.id}
                  </Badge>
                </div>
                {d.returnConfirmedAt && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Reported {format(new Date(d.returnConfirmedAt), "MMM d, yyyy")}
                  </span>
                )}
              </div>

              <CardContent className="pt-5 pb-4 space-y-4">
                <div className="flex items-start gap-4">
                  {d.itemImage ? (
                    <img
                      src={d.itemImage}
                      alt={d.itemName}
                      className="w-16 h-16 rounded-lg object-cover border flex-shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <Package className="h-6 w-6 text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base">{d.itemName}</p>
                    <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        <span className="font-medium text-foreground">Owner:</span> {d.ownerName}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        <span className="font-medium text-foreground">Borrower:</span> {d.borrowerName}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Condition rating:</span>
                        <StarRating rating={d.returnConditionRating} />
                      </div>
                      {d.trustDepositAmount && (
                        <div className="flex items-center gap-1 text-sm">
                          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">${parseFloat(d.trustDepositAmount).toFixed(2)}</span>
                          <span className="text-muted-foreground">deposit</span>
                          <Badge
                            variant="outline"
                            className={`text-xs ml-1 ${
                              d.depositStatus === "disputed"
                                ? "border-amber-300 text-amber-700"
                                : "border-gray-300 text-gray-600"
                            }`}
                          >
                            {d.depositStatus ?? "unknown"}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 space-y-2">
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                    Owner's damage report
                  </p>
                  <p className="text-sm text-red-900">
                    {d.returnDisputeReason || d.returnConditionNotes || (
                      <span className="italic text-muted-foreground">No description provided.</span>
                    )}
                  </p>
                  {d.returnDisputePhotoUrl && (
                    <div>
                      <p className="text-xs text-red-600 font-medium mb-1">Photo evidence:</p>
                      <a href={d.returnDisputePhotoUrl} target="_blank" rel="noopener noreferrer">
                        <img
                          src={d.returnDisputePhotoUrl}
                          alt="Damage evidence"
                          className="h-32 w-32 object-cover rounded-lg border border-red-200 hover:opacity-90 transition-opacity cursor-pointer"
                        />
                      </a>
                    </div>
                  )}
                </div>

                {d.returnConditionNotes && d.returnConditionNotes !== d.returnDisputeReason && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Additional notes
                    </p>
                    <p className="text-sm text-gray-700">{d.returnConditionNotes}</p>
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => setResolving({ id: d.id, decision: "borrower" })}
                    disabled={resolveMutation.isPending}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Release deposit to borrower
                  </Button>
                  <Button
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => setResolving({ id: d.id, decision: "owner" })}
                    disabled={resolveMutation.isPending}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Capture deposit for owner
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={!!resolving} onOpenChange={(open) => !open && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {resolving?.decision === "borrower"
                ? "Release deposit to borrower?"
                : "Capture deposit for owner?"}
            </DialogTitle>
            <DialogDescription>
              {resolving?.decision === "borrower"
                ? "The security deposit will be released back to the borrower. This confirms the item was returned in acceptable condition."
                : "The security deposit will be captured and paid to the owner. This confirms damage was found and the owner's claim is valid."}{" "}
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button
              className={resolving?.decision === "borrower" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
              onClick={() => resolving && resolveMutation.mutate(resolving)}
              disabled={resolveMutation.isPending}
            >
              {resolveMutation.isPending ? "Processing…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
