import { useParams, Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/shared/navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  ArrowLeft,
  Package,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Truck,
  Lock,
  Unlock,
  RotateCcw,
  ShieldAlert,
  DollarSign,
  CalendarDays,
  MapPin,
  FileText,
  BadgeCheck,
  Loader2,
  HandshakeIcon,
  TrendingDown,
  Flag,
  Star,
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
  deliveryConfirmedAt: string | null;
  confirmationMethod: string | null;
  handoffConfirmedAt: string | null;
  borrowPeriodStartedAt: string | null;
  actualHandoffAt: string | null;
  actualReturnAt: string | null;
  handoffDelayAdjustmentStatus: string | null;
  proposedAdjustedEndDate: string | null;
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
  iconBg: string;
  metadata?: string;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    PENDING: "Pending",
    ACCEPTED: "Accepted",
    DEPOSIT_PENDING: "Deposit Pending",
    DEPOSIT_CONFIRMED: "Deposit Confirmed",
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
  if (["REJECTED", "CANCELLED", "DEPOSIT_FAILED", "DISPUTED", "HANDOFF_DISPUTED"].includes(status))
    return "destructive";
  if (status === "PENDING") return "secondary";
  return "outline";
}

function requestTypeLabel(type: string): string {
  const map: Record<string, string> = { borrow: "Borrow", rent: "Rental", swap: "Swap", gift: "Gift" };
  return map[type] ?? type;
}

function requestTypeBadgeClass(type: string): string {
  const map: Record<string, string> = {
    borrow: "bg-blue-100 text-blue-700 border-blue-200",
    rent: "bg-purple-100 text-purple-700 border-purple-200",
    swap: "bg-teal-100 text-teal-700 border-teal-200",
    gift: "bg-pink-100 text-pink-700 border-pink-200",
  };
  return map[type] ?? "bg-gray-100 text-gray-700";
}

function buildTimeline(tx: TransactionDetail): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (tx.createdAt) {
    events.push({
      label: "Request sent",
      timestamp: tx.createdAt,
      icon: <FileText className="h-4 w-4 text-white" />,
      iconBg: "bg-blue-400",
      metadata: tx.message ?? undefined,
    });
  }
  if (tx.counterProposedAt) {
    events.push({
      label: "Counter-proposal made",
      timestamp: tx.counterProposedAt,
      icon: <AlertTriangle className="h-4 w-4 text-white" />,
      iconBg: "bg-amber-400",
    });
  }
  if (tx.termsAcceptedAt) {
    events.push({
      label: "Terms accepted",
      timestamp: tx.termsAcceptedAt,
      icon: <CheckCircle2 className="h-4 w-4 text-white" />,
      iconBg: "bg-green-500",
    });
  }
  if (tx.termsDeclinedAt) {
    events.push({
      label: "Terms declined",
      timestamp: tx.termsDeclinedAt,
      icon: <AlertTriangle className="h-4 w-4 text-white" />,
      iconBg: "bg-red-500",
    });
  }
  if (tx.depositAuthorizedAt) {
    events.push({
      label: "Security deposit held",
      timestamp: tx.depositAuthorizedAt,
      icon: <Lock className="h-4 w-4 text-white" />,
      iconBg: "bg-purple-500",
      metadata: tx.trustDepositAmount
        ? `$${parseFloat(tx.trustDepositAmount).toFixed(2)} held`
        : undefined,
    });
  }
  if (tx.deliveryConfirmedAt) {
    events.push({
      label: "Delivery confirmed",
      timestamp: tx.deliveryConfirmedAt,
      icon: <CheckCircle2 className="h-4 w-4 text-white" />,
      iconBg: "bg-teal-500",
    });
  }
  if (tx.handoffDisputeAt) {
    events.push({
      label: "Handoff dispute opened",
      timestamp: tx.handoffDisputeAt,
      icon: <ShieldAlert className="h-4 w-4 text-white" />,
      iconBg: "bg-red-600",
    });
  }
  if (tx.handoffConfirmedAt) {
    events.push({
      label: `Handoff confirmed${tx.confirmationMethod ? ` via ${tx.confirmationMethod === "pin" ? "PIN" : "manual confirmation"}` : ""}`,
      timestamp: tx.handoffConfirmedAt,
      icon: <HandshakeIcon className="h-4 w-4 text-white" />,
      iconBg: "bg-primary",
    });
  }
  if (tx.borrowPeriodStartedAt) {
    events.push({
      label: "Borrow period started",
      timestamp: tx.borrowPeriodStartedAt,
      icon: <Clock className="h-4 w-4 text-white" />,
      iconBg: "bg-blue-500",
    });
  }
  if (tx.returnRequestedAt) {
    events.push({
      label: "Return requested",
      timestamp: tx.returnRequestedAt,
      icon: <RotateCcw className="h-4 w-4 text-white" />,
      iconBg: "bg-amber-500",
    });
  }
  if (tx.returnDisputeTriggered && tx.returnRequestedAt) {
    events.push({
      label: "Return dispute opened",
      timestamp: tx.returnRequestedAt,
      icon: <Flag className="h-4 w-4 text-white" />,
      iconBg: "bg-red-600",
      metadata: tx.returnDisputeReason ?? undefined,
    });
  }
  if (tx.returnConfirmedAt) {
    events.push({
      label: "Return confirmed",
      timestamp: tx.returnConfirmedAt,
      icon: <CheckCircle2 className="h-4 w-4 text-white" />,
      iconBg: "bg-green-500",
      metadata: tx.returnConditionRating
        ? `Condition rated ${tx.returnConditionRating}/5`
        : undefined,
    });
  }
  if (tx.depositReleasedAt) {
    events.push({
      label: "Security deposit hold lifted",
      timestamp: tx.depositReleasedAt,
      icon: <Unlock className="h-4 w-4 text-white" />,
      iconBg: "bg-green-600",
      metadata: tx.trustDepositAmount
        ? `$${parseFloat(tx.trustDepositAmount).toFixed(2)} hold lifted`
        : undefined,
    });
  }

  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function PartyCard({
  user,
  role,
}: {
  user: {
    id: number;
    username: string;
    displayName: string | null;
    isVerified: boolean;
    reputationLevel: string | null;
    trustScore: number | null;
    avatar: string | null;
  };
  role: string;
}) {
  const displayName = user.displayName || user.username;
  const initials = displayName.substring(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-white">
      <Avatar className="h-11 w-11 flex-shrink-0">
        {user.avatar ? (
          <img src={user.avatar} alt={displayName} className="h-11 w-11 rounded-full object-cover" />
        ) : null}
        <AvatarFallback className="bg-teal-100 text-teal-700 font-semibold text-sm">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link
            href={`/profile/${user.username}`}
            className="cursor-pointer font-semibold text-sm hover:text-primary transition-colors truncate"
          >
            {displayName}
          </Link>
          {user.isVerified && <BadgeCheck className="h-4 w-4 text-primary flex-shrink-0" />}
        </div>
        <p className="text-xs text-muted-foreground">{role}</p>
        {user.trustScore !== null && (
          <p className="text-xs text-muted-foreground">
            Trust score: {user.trustScore} · {user.reputationLevel ?? "Newcomer"}
          </p>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
      {children}
    </h2>
  );
}

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: tx, isLoading, error } = useQuery<TransactionDetail>({
    queryKey: ["/api/item-requests", id],
    queryFn: async () => {
      const res = await fetch(`/api/item-requests/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!id && !!user,
  });

  const isDisputed = tx?.handoffDisputeTriggered || tx?.returnDisputeTriggered;
  const timeline = tx ? buildTimeline(tx) : [];
  const itemPhoto = tx?.itemPhotos?.[0];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="container mx-auto px-4 py-6 max-w-2xl">
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </main>
      </div>
    );
  }

  if (error || !tx) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="container mx-auto px-4 py-6 max-w-2xl">
          <Button variant="ghost" onClick={() => navigate("/activity")} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Activity
          </Button>
          <Card>
            <CardContent className="py-16 text-center">
              <ShieldAlert className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="font-semibold text-gray-600">Transaction not found</p>
              <p className="text-sm text-gray-500 mt-1">
                You may not have access to this record.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="container mx-auto px-4 py-6 max-w-2xl pb-24">
        <Button variant="ghost" onClick={() => navigate("/activity")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <div className="space-y-4">
          {/* Header card */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="flex gap-4 p-4">
                {itemPhoto ? (
                  <img
                    src={itemPhoto}
                    alt={tx.itemName}
                    className="h-20 w-20 rounded-lg object-cover flex-shrink-0 border"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 border">
                    <Package className="h-8 w-8 text-gray-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0 py-1">
                  <h1 className="font-bold text-lg leading-tight mb-2">{tx.itemName}</h1>
                  <div className="flex flex-wrap gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${requestTypeBadgeClass(tx.requestType)}`}
                    >
                      {requestTypeLabel(tx.requestType)}
                    </span>
                    <Badge variant={statusVariant(tx.status)} className="text-xs">
                      {statusLabel(tx.status)}
                    </Badge>
                    {isDisputed && (
                      <Badge variant="destructive" className="text-xs">
                        Disputed
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Meta row */}
              <div className="border-t px-4 py-3 bg-gray-50 flex flex-wrap gap-x-5 gap-y-1">
                <span className="text-xs text-muted-foreground">Ref #{tx.id}</span>
                {tx.itemCategory && (
                  <span className="text-xs text-muted-foreground capitalize">{tx.itemCategory}</span>
                )}
                {tx.deliveryMethod && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1 capitalize">
                    <MapPin className="h-3 w-3" />
                    {tx.deliveryMethod.replace("_", " ")}
                  </span>
                )}
                {tx.startDate && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {["IN_PROGRESS", "RETURN_REQUESTED", "COMPLETED", "COMPLETED_EARLY"].includes(tx.status)
                      ? <>Booked: {format(new Date(tx.startDate), "MMM d")}{tx.endDate ? ` – ${format(new Date(tx.endDate), "MMM d, yyyy")}` : ""}</>
                      : <>{format(new Date(tx.startDate), "MMM d")}{tx.endDate ? ` – ${format(new Date(tx.endDate), "MMM d, yyyy")}` : ""}</>
                    }
                  </span>
                )}
                {tx.actualHandoffAt && ["IN_PROGRESS", "RETURN_REQUESTED", "COMPLETED", "COMPLETED_EARLY"].includes(tx.status) && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    Handoff: {format(new Date(tx.actualHandoffAt), "MMM d")}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Parties */}
          <div>
            <SectionLabel>People involved</SectionLabel>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <PartyCard
                user={{
                  id: tx.ownerId,
                  username: tx.ownerUsername,
                  displayName: tx.ownerDisplayName,
                  isVerified: tx.ownerIsVerified,
                  reputationLevel: tx.ownerReputationLevel,
                  trustScore: tx.ownerTrustScore,
                  avatar: tx.ownerAvatar,
                }}
                role="Owner"
              />
              <PartyCard
                user={{
                  id: tx.requesterId,
                  username: tx.requesterUsername,
                  displayName: tx.requesterDisplayName,
                  isVerified: tx.requesterIsVerified,
                  reputationLevel: tx.requesterReputationLevel,
                  trustScore: tx.requesterTrustScore,
                  avatar: tx.requesterAvatar,
                }}
                role={
                  tx.requestType === "rent" ? "Renter"
                  : tx.requestType === "swap" ? "Swapper"
                  : tx.requestType === "gift" ? "Recipient"
                  : "Borrower"
                }
              />
            </div>
          </div>

          {/* Payment & Deposit */}
          {(tx.trustDepositAmount || tx.rentalAmount) && (
            <div id="payment">
              <SectionLabel>Payment & deposit</SectionLabel>
              <Card>
                <CardContent className="p-4 space-y-0">
                  {tx.rentalAmount && (
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Rental fee</span>
                      <span className="text-sm font-medium">
                        ${parseFloat(tx.rentalAmount).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {tx.rentalProcessingFee && (
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Processing fee (3%)</span>
                      <span className="text-sm">
                        ${parseFloat(tx.rentalProcessingFee).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {tx.trustDepositBaseAmount && (
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Base deposit</span>
                      <span className="text-sm">
                        ${parseFloat(tx.trustDepositBaseAmount).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {tx.trustDiscountPercentage ? (
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-green-600">Trust discount</span>
                      <span className="text-sm text-green-600">−{tx.trustDiscountPercentage}%</span>
                    </div>
                  ) : null}
                  {tx.trustDepositAmount && (
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm font-semibold">Security deposit</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          ${parseFloat(tx.trustDepositAmount).toFixed(2)}
                        </span>
                        <Badge
                          variant={
                            tx.depositStatus === "released"
                              ? "default"
                              : tx.depositStatus === "held" || tx.depositStatus === "authorized"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-xs capitalize"
                        >
                          {tx.depositStatus === "authorized" || tx.depositStatus === "held"
                            ? "On hold"
                            : tx.depositStatus === "released"
                            ? "Hold lifted"
                            : tx.depositStatus === "captured"
                            ? "Captured"
                            : tx.depositStatus ?? "Pending"}
                        </Badge>
                      </div>
                    </div>
                  )}

                  {(tx.depositAuthorizedAt || tx.depositReleasedAt) && (
                    <div className="border-t pt-3 mt-1 space-y-1.5">
                      {tx.depositAuthorizedAt && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Lock className="h-3.5 w-3.5" />
                          Authorization placed on{" "}
                          {format(new Date(tx.depositAuthorizedAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      )}
                      {tx.depositReleasedAt && (
                        <p className="text-xs text-green-600 flex items-center gap-1.5">
                          <Unlock className="h-3.5 w-3.5" />
                          Hold lifted on{" "}
                          {format(new Date(tx.depositReleasedAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Dispute section */}
          {isDisputed && (
            <div>
              <SectionLabel>Dispute details</SectionLabel>
              <Card className="border-l-4 border-l-red-400 bg-red-50">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-red-500" />
                    <h3 className="font-semibold text-red-700">
                      {tx.handoffDisputeTriggered ? "Handoff Dispute" : "Return Dispute"}
                    </h3>
                  </div>
                  {tx.returnDisputeReason && (
                    <p className="text-sm text-red-800">{tx.returnDisputeReason}</p>
                  )}
                  {tx.handoffProofOwner && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Owner's statement</p>
                      <p className="text-sm bg-white rounded-md p-2.5 border text-gray-800">
                        {tx.handoffProofOwner}
                      </p>
                    </div>
                  )}
                  {tx.handoffProofBorrower && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {tx.requestType === "rent" ? "Renter's" : tx.requestType === "swap" ? "Swapper's" : tx.requestType === "gift" ? "Recipient's" : "Borrower's"} statement
                      </p>
                      <p className="text-sm bg-white rounded-md p-2.5 border text-gray-800">
                        {tx.handoffProofBorrower}
                      </p>
                    </div>
                  )}
                  {tx.returnConditionNotes && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Return notes</p>
                      <p className="text-sm bg-white rounded-md p-2.5 border text-gray-800">
                        {tx.returnConditionNotes}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Activity Timeline */}
          <div>
            <SectionLabel>Activity timeline</SectionLabel>
            <Card>
              <CardContent className="p-4">
                {timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No activity recorded yet.
                  </p>
                ) : (
                  <div className="relative">
                    {/* Vertical line */}
                    <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-gray-200" />
                    <div className="space-y-0">
                      {timeline.map((event, idx) => (
                        <div key={idx} className="flex gap-4 relative">
                          <div
                            className={`relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${event.iconBg}`}
                          >
                            {event.icon}
                          </div>
                          <div className="flex-1 pb-5 pt-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 leading-snug">
                              {event.label}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {format(new Date(event.timestamp), "MMM d, yyyy 'at' h:mm a")}
                              <span className="ml-1.5 text-gray-400">
                                ({formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })})
                              </span>
                            </p>
                            {event.metadata && (
                              <p className="text-xs text-muted-foreground mt-1 bg-gray-50 rounded px-2 py-1 inline-block">
                                {event.metadata}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Footer action */}
          <div className="flex justify-center pt-2 pb-6">
            <Link href="/requests" className="cursor-pointer">
              <Button variant="outline" size="sm">
                View all requests
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
