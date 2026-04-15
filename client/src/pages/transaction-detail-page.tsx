import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/shared/navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Package,
  User,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Truck,
  Lock,
  Unlock,
  HandshakeIcon,
  RotateCcw,
  ShieldAlert,
  DollarSign,
  Coins,
  Star,
  CalendarDays,
  MapPin,
  FileText,
  BadgeCheck,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface TransactionDetail {
  id: number;
  requestType: string;
  status: string;
  message: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  deliveryMethod: string;
  depositMethod: string;
  negotiationStatus: string;
  termsAcceptedAt: string | null;
  termsDeclinedAt: string | null;
  counterProposedAt: string | null;
  trustDepositAmount: string | null;
  trustDepositBaseAmount: string | null;
  trustDiscountPercentage: number | null;
  depositStatus: string | null;
  depositAuthorizedAt: string | null;
  depositReleasedAt: string | null;
  rentalAmount: string | null;
  rentalProcessingFee: string | null;
  courierBookedAt: string | null;
  deliveryConfirmedAt: string | null;
  courierIssue: boolean;
  courierIssueNote: string | null;
  confirmationMethod: string | null;
  handoffConfirmedAt: string | null;
  borrowPeriodStartedAt: string | null;
  handoffDisputeTriggered: boolean;
  handoffDisputeAt: string | null;
  handoffProofOwner: string | null;
  handoffProofBorrower: string | null;
  returnRequestedAt: string | null;
  returnConfirmedAt: string | null;
  returnConditionOk: boolean | null;
  returnConditionNotes: string | null;
  returnConditionRating: number | null;
  returnDisputeTriggered: boolean;
  returnDisputeReason: string | null;
  itemId: number;
  itemName: string;
  itemDescription: string | null;
  itemPhotos: string[] | null;
  itemCategory: string | null;
  itemReplacementValue: string | null;
  itemTier: string | null;
  ownerId: number;
  ownerUsername: string;
  ownerHandle: string | null;
  ownerDisplayName: string | null;
  ownerIsVerified: boolean;
  ownerReputationLevel: string | null;
  ownerTrustScore: number | null;
  ownerAvatar: string | null;
  requesterId: number;
  requesterUsername: string;
  requesterHandle: string | null;
  requesterDisplayName: string | null;
  requesterIsVerified: boolean;
  requesterReputationLevel: string | null;
  requesterTrustScore: number | null;
  requesterAvatar: string | null;
}

interface TimelineEvent {
  label: string;
  timestamp: string;
  icon: React.ReactNode;
  color: string;
  metadata?: string;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    PENDING: "Pending",
    ACCEPTED: "Accepted",
    DEPOSIT_PENDING: "Deposit Pending",
    DEPOSIT_CONFIRMED: "Deposit Confirmed",
    COURIER_PENDING: "Courier Pending",
    HANDOFF_CONFIRMED: "Handoff Confirmed",
    IN_PROGRESS: "In Progress",
    RETURN_REQUESTED: "Return Requested",
    RETURN_CONFIRMED: "Return Confirmed",
    COMPLETED: "Completed",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
    DEPOSIT_FAILED: "Deposit Failed",
    HANDOFF_DISPUTED: "Handoff Disputed",
    DISPUTED: "Disputed",
  };
  return map[status] ?? status;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["COMPLETED", "RETURN_CONFIRMED"].includes(status)) return "default";
  if (["REJECTED", "CANCELLED", "DEPOSIT_FAILED", "DISPUTED", "HANDOFF_DISPUTED"].includes(status)) return "destructive";
  if (["PENDING"].includes(status)) return "secondary";
  return "outline";
}

function requestTypeLabel(type: string): string {
  const map: Record<string, string> = {
    borrow: "Borrow",
    rent: "Rental",
    swap: "Swap",
    gift: "Gift",
  };
  return map[type] ?? type;
}

function buildTimeline(tx: TransactionDetail): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (tx.createdAt) {
    events.push({
      label: "Request sent",
      timestamp: tx.createdAt,
      icon: <FileText className="h-4 w-4" />,
      color: "text-blue-500",
      metadata: tx.message ?? undefined,
    });
  }
  if (tx.counterProposedAt) {
    events.push({
      label: "Counter-proposal made",
      timestamp: tx.counterProposedAt,
      icon: <ArrowLeft className="h-4 w-4 rotate-180" />,
      color: "text-amber-500",
    });
  }
  if (tx.termsAcceptedAt) {
    events.push({
      label: "Terms accepted",
      timestamp: tx.termsAcceptedAt,
      icon: <CheckCircle2 className="h-4 w-4" />,
      color: "text-green-500",
    });
  }
  if (tx.termsDeclinedAt) {
    events.push({
      label: "Terms declined",
      timestamp: tx.termsDeclinedAt,
      icon: <AlertTriangle className="h-4 w-4" />,
      color: "text-red-500",
    });
  }
  if (tx.depositAuthorizedAt) {
    events.push({
      label: "Security deposit held",
      timestamp: tx.depositAuthorizedAt,
      icon: <Lock className="h-4 w-4" />,
      color: "text-purple-500",
      metadata: tx.trustDepositAmount ? `$${parseFloat(tx.trustDepositAmount).toFixed(2)} held` : undefined,
    });
  }
  if (tx.courierBookedAt) {
    events.push({
      label: "Courier booked",
      timestamp: tx.courierBookedAt,
      icon: <Truck className="h-4 w-4" />,
      color: "text-teal-500",
    });
  }
  if (tx.deliveryConfirmedAt) {
    events.push({
      label: "Delivery confirmed",
      timestamp: tx.deliveryConfirmedAt,
      icon: <CheckCircle2 className="h-4 w-4" />,
      color: "text-teal-600",
    });
  }
  if (tx.handoffDisputeAt) {
    events.push({
      label: "Handoff dispute opened",
      timestamp: tx.handoffDisputeAt,
      icon: <ShieldAlert className="h-4 w-4" />,
      color: "text-red-600",
    });
  }
  if (tx.handoffConfirmedAt) {
    events.push({
      label: `Handoff confirmed${tx.confirmationMethod ? ` (via ${tx.confirmationMethod === "pin" ? "PIN" : "manual"})` : ""}`,
      timestamp: tx.handoffConfirmedAt,
      icon: <HandshakeIcon className="h-4 w-4" />,
      color: "text-green-600",
    });
  }
  if (tx.borrowPeriodStartedAt) {
    events.push({
      label: "Borrow period started",
      timestamp: tx.borrowPeriodStartedAt,
      icon: <Clock className="h-4 w-4" />,
      color: "text-blue-600",
    });
  }
  if (tx.returnRequestedAt) {
    events.push({
      label: "Return requested",
      timestamp: tx.returnRequestedAt,
      icon: <RotateCcw className="h-4 w-4" />,
      color: "text-amber-500",
    });
  }
  if (tx.returnConfirmedAt) {
    events.push({
      label: "Return confirmed",
      timestamp: tx.returnConfirmedAt,
      icon: <CheckCircle2 className="h-4 w-4" />,
      color: "text-green-600",
      metadata: tx.returnConditionRating ? `Condition rated ${tx.returnConditionRating}/5` : undefined,
    });
  }
  if (tx.returnDisputeTriggered && tx.returnRequestedAt) {
    events.push({
      label: "Return dispute opened",
      timestamp: tx.returnRequestedAt,
      icon: <ShieldAlert className="h-4 w-4" />,
      color: "text-red-600",
      metadata: tx.returnDisputeReason ?? undefined,
    });
  }
  if (tx.depositReleasedAt) {
    events.push({
      label: "Security deposit released",
      timestamp: tx.depositReleasedAt,
      icon: <Unlock className="h-4 w-4" />,
      color: "text-green-500",
      metadata: tx.trustDepositAmount ? `$${parseFloat(tx.trustDepositAmount).toFixed(2)} returned` : undefined,
    });
  }

  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function UserCard({ user, role }: { user: { id: number; username: string; handle: string | null; displayName: string | null; isVerified: boolean; reputationLevel: string | null; trustScore: number | null; avatar: string | null }; role: string }) {
  const displayName = user.displayName || user.username;
  const initials = displayName.substring(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
      <Avatar className="h-10 w-10 flex-shrink-0">
        {user.avatar ? <img src={user.avatar} alt={displayName} className="h-10 w-10 rounded-full object-cover" /> : null}
        <AvatarFallback className="text-sm font-semibold">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <Link href={`/profile/${user.username}`} className="cursor-pointer font-medium text-sm hover:underline truncate">{displayName}</Link>
          {user.isVerified && <BadgeCheck className="h-4 w-4 text-blue-500 flex-shrink-0" />}
        </div>
        <p className="text-xs text-muted-foreground">{role}</p>
        {user.trustScore !== null && (
          <p className="text-xs text-muted-foreground">Trust: {user.trustScore} · {user.reputationLevel ?? "Newcomer"}</p>
        )}
      </div>
    </div>
  );
}

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const { data: tx, isLoading, error } = useQuery<TransactionDetail>({
    queryKey: ["/api/item-requests", id],
    queryFn: async () => {
      const res = await fetch(`/api/item-requests/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load transaction");
      return res.json();
    },
    enabled: !!id && !!user,
  });

  const isOwner = user?.id === tx?.ownerId;
  const isDisputed = tx?.handoffDisputeTriggered || tx?.returnDisputeTriggered;

  const timeline = tx ? buildTimeline(tx) : [];

  const itemPhoto = tx?.itemPhotos?.[0];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">
        <div className="flex items-center gap-2 mb-5">
          <Button variant="ghost" size="sm" onClick={() => window.history.back()} className="p-0 h-auto hover:bg-transparent text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </div>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        )}

        {error && (
          <div className="text-center py-16 text-muted-foreground">
            <ShieldAlert className="h-10 w-10 mx-auto mb-3 text-red-400" />
            <p className="font-medium">Transaction not found</p>
            <p className="text-sm mt-1">You may not have access to this record.</p>
          </div>
        )}

        {tx && (
          <div className="space-y-5">
            {/* Header card */}
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex gap-4 p-4">
                {itemPhoto ? (
                  <img src={itemPhoto} alt={tx.itemName} className="h-20 w-20 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="h-20 w-20 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <Package className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-start gap-2 mb-1">
                    <h1 className="font-semibold text-base leading-tight">{tx.itemName}</h1>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <Badge variant="secondary" className="text-xs">{requestTypeLabel(tx.requestType)}</Badge>
                    <Badge variant={statusVariant(tx.status)} className="text-xs">{statusLabel(tx.status)}</Badge>
                    {isDisputed && <Badge variant="destructive" className="text-xs">Disputed</Badge>}
                  </div>
                  {tx.itemCategory && <p className="text-xs text-muted-foreground capitalize">{tx.itemCategory}</p>}
                  <p className="text-xs text-muted-foreground mt-0.5">#{tx.id}</p>
                </div>
              </div>

              {(tx.startDate || tx.endDate) && (
                <div className="border-t px-4 py-3 flex gap-6 text-xs text-muted-foreground">
                  {tx.startDate && (
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      <span>Start: {format(new Date(tx.startDate), "MMM d, yyyy")}</span>
                    </div>
                  )}
                  {tx.endDate && (
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      <span>End: {format(new Date(tx.endDate), "MMM d, yyyy")}</span>
                    </div>
                  )}
                  {tx.deliveryMethod && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      <span className="capitalize">{tx.deliveryMethod.replace("_", " ")}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Parties */}
            <div>
              <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Parties</h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <UserCard
                  user={{ id: tx.ownerId, username: tx.ownerUsername, handle: tx.ownerHandle, displayName: tx.ownerDisplayName, isVerified: tx.ownerIsVerified, reputationLevel: tx.ownerReputationLevel, trustScore: tx.ownerTrustScore, avatar: tx.ownerAvatar }}
                  role={tx.requestType === "borrow" || tx.requestType === "rent" ? "Owner / Lender" : "Owner"}
                />
                <UserCard
                  user={{ id: tx.requesterId, username: tx.requesterUsername, handle: tx.requesterHandle, displayName: tx.requesterDisplayName, isVerified: tx.requesterIsVerified, reputationLevel: tx.requesterReputationLevel, trustScore: tx.requesterTrustScore, avatar: tx.requesterAvatar }}
                  role={tx.requestType === "borrow" || tx.requestType === "rent" ? "Borrower / Renter" : "Requester"}
                />
              </div>
            </div>

            {/* Security Deposit / Payment section */}
            {(tx.trustDepositAmount || tx.rentalAmount) && (
              <div id="payment" className="rounded-xl border bg-card p-4 space-y-3">
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  Payment & Deposit
                </h2>
                <div className="space-y-2 text-sm">
                  {tx.rentalAmount && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rental fee</span>
                      <span className="font-medium">${parseFloat(tx.rentalAmount).toFixed(2)}</span>
                    </div>
                  )}
                  {tx.rentalProcessingFee && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Processing fee (3%)</span>
                      <span>${parseFloat(tx.rentalProcessingFee).toFixed(2)}</span>
                    </div>
                  )}
                  {tx.trustDepositBaseAmount && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Base deposit</span>
                      <span>${parseFloat(tx.trustDepositBaseAmount).toFixed(2)}</span>
                    </div>
                  )}
                  {tx.trustDiscountPercentage ? (
                    <div className="flex justify-between text-green-600">
                      <span>Trust discount</span>
                      <span>−{tx.trustDiscountPercentage}%</span>
                    </div>
                  ) : null}
                  {tx.trustDepositAmount && (
                    <div className="flex justify-between font-medium border-t pt-2">
                      <span>Security deposit</span>
                      <div className="flex items-center gap-1.5">
                        <span>${parseFloat(tx.trustDepositAmount).toFixed(2)}</span>
                        <Badge variant={tx.depositStatus === "released" ? "default" : tx.depositStatus === "held" || tx.depositStatus === "authorized" ? "secondary" : "outline"} className="text-xs">
                          {tx.depositStatus ?? "pending"}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
                {tx.depositAuthorizedAt && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Lock className="h-3 w-3" />
                    Held on {format(new Date(tx.depositAuthorizedAt), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                )}
                {tx.depositReleasedAt && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <Unlock className="h-3 w-3" />
                    Released on {format(new Date(tx.depositReleasedAt), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                )}
              </div>
            )}

            {/* Dispute section */}
            {isDisputed && (
              <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 space-y-3">
                <h2 className="font-semibold text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  {tx.handoffDisputeTriggered ? "Handoff Dispute" : "Return Dispute"}
                </h2>
                {tx.returnDisputeReason && (
                  <p className="text-sm text-red-800 dark:text-red-300">{tx.returnDisputeReason}</p>
                )}
                {tx.handoffProofOwner && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Owner statement</p>
                    <p className="text-sm bg-background rounded-md p-2 border">{tx.handoffProofOwner}</p>
                  </div>
                )}
                {tx.handoffProofBorrower && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Borrower statement</p>
                    <p className="text-sm bg-background rounded-md p-2 border">{tx.handoffProofBorrower}</p>
                  </div>
                )}
                {tx.returnConditionNotes && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Return notes</p>
                    <p className="text-sm bg-background rounded-md p-2 border">{tx.returnConditionNotes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Activity Timeline */}
            <div>
              <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Activity Timeline</h2>
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
              ) : (
                <div className="relative">
                  <div className="absolute left-4 top-3 bottom-3 w-px bg-border" />
                  <div className="space-y-0">
                    {timeline.map((event, idx) => (
                      <div key={idx} className="flex gap-4 relative">
                        <div className={`relative z-10 flex-shrink-0 w-8 h-8 rounded-full border-2 border-background bg-muted flex items-center justify-center ${event.color}`}>
                          {event.icon}
                        </div>
                        <div className="flex-1 pb-5 pt-1 min-w-0">
                          <p className="text-sm font-medium leading-tight">{event.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {format(new Date(event.timestamp), "MMM d, yyyy 'at' h:mm a")}
                            <span className="ml-1 text-muted-foreground/60">({formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })})</span>
                          </p>
                          {event.metadata && (
                            <p className="text-xs text-muted-foreground mt-1 italic">{event.metadata}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Quick action */}
            <div className="flex justify-center pt-2">
              <Link href="/requests" className="cursor-pointer">
                <Button variant="outline" size="sm">View all requests</Button>
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
