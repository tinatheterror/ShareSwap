
import { Navbar } from "@/components/shared/navbar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import {
  Bell, Package, Heart, AlertCircle, CheckCircle2, ArrowLeftRight, Shield,
  Trophy, TrendingUp, Coins, Clock, Flag, Truck, Gift, FileText, Star,
  RotateCcw, Users, Unlock, DollarSign, ShieldAlert, Zap, ChevronRight,
} from "lucide-react";
import type { SelectNotification } from "@db/schema";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow, isToday, isThisWeek } from "date-fns";

// ─── Types & constants ────────────────────────────────────────────────────────

type Tab = "all" | "transactions" | "trust" | "coins" | "system";

const TRANSACTION_TYPES = new Set([
  "item_request", "request_accepted", "request_declined",
  "terms_accepted", "terms_declined", "terms_counter_proposed",
  "handoff_pending", "handoff_confirmed", "handoff_auto_advanced",
  "handoff_dispute", "handoff_disputed", "handoff_flagged",
  "return_initiated", "return_confirmed", "return_initiated",
  "dispute_opened", "dispute_resolved",
  "delivery_confirmed", "courier_issue",
  "gift_handoff_pending", "gift_completed",
]);

const TRUST_TYPES = new Set([
  "new_review_received", "badge_earned", "milestone_achieved", "level_up",
  // trust_score_changed intentionally omitted — low-value noise
]);

const COIN_TYPES = new Set([
  "sharecoin_earned", "security_deposit_released", "payment_received",
]);

const SYSTEM_TYPES = new Set([
  "wishlist_match", "swap_match", "referral_joined",
  "return_reminder_tomorrow", "return_reminder_today", "return_reminder_overdue",
  "verification_failed", "verification_approved",
]);

// Low-value micro-events hidden from "All" tab
const NOISE_TYPES = new Set(["trust_score_changed"]);

function matchesTab(type: string, tab: Tab): boolean {
  if (tab === "all") return !NOISE_TYPES.has(type);
  if (tab === "transactions") return TRANSACTION_TYPES.has(type);
  if (tab === "trust") return TRUST_TYPES.has(type);
  if (tab === "coins") return COIN_TYPES.has(type);
  if (tab === "system") return SYSTEM_TYPES.has(type);
  return false;
}

// ─── Smart routing (single source of truth) ───────────────────────────────────

export function getNotificationRoute(n: SelectNotification): { type: "chat"; requestId: number } | { type: "url"; url: string } | null {
  if (["trust_score_changed", "milestone_achieved", "badge_earned", "level_up"].includes(n.type)) {
    return { type: "url", url: "/achievements" };
  }
  if (n.type === "sharecoin_earned") return { type: "url", url: "/wallet" };
  if (n.type === "new_review_received") return { type: "url", url: "/profile#reviews" };
  if (n.type === "dispute_resolved" || n.type === "security_deposit_released" || n.type === "payment_received") {
    return { type: "url", url: "/my-balance" };
  }
  if (n.type === "wishlist_match" && n.itemId) return { type: "url", url: `/items/${n.itemId}` };
  if (n.requestId) return { type: "chat", requestId: n.requestId };
  if (n.itemId) return { type: "url", url: `/items/${n.itemId}` };
  if ((n as any).link) return { type: "url", url: (n as any).link };
  return null;
}

// ─── Icon map ─────────────────────────────────────────────────────────────────

function getIcon(type: string) {
  const cls = "h-5 w-5";
  switch (type) {
    case "item_request": return <Package className={`${cls} text-primary`} />;
    case "request_accepted": case "terms_accepted": return <CheckCircle2 className={`${cls} text-green-600`} />;
    case "request_declined": case "terms_declined": return <AlertCircle className={`${cls} text-red-500`} />;
    case "terms_counter_proposed": return <FileText className={`${cls} text-amber-500`} />;
    case "wishlist_match": return <Heart className={`${cls} text-pink-500`} />;
    case "swap_match": return <ArrowLeftRight className={`${cls} text-teal-500`} />;
    case "handoff_confirmed": case "handoff_auto_advanced": return <CheckCircle2 className={`${cls} text-green-600`} />;
    case "handoff_pending": return <Clock className={`${cls} text-amber-500`} />;
    case "handoff_dispute": case "handoff_disputed": case "dispute_opened": return <AlertCircle className={`${cls} text-red-500`} />;
    case "handoff_flagged": return <Flag className={`${cls} text-orange-500`} />;
    case "gift_handoff_pending": case "gift_completed": return <Gift className={`${cls} text-pink-500`} />;
    case "delivery_confirmed": return <Truck className={`${cls} text-green-600`} />;
    case "courier_issue": return <Truck className={`${cls} text-red-500`} />;
    case "return_initiated": return <RotateCcw className={`${cls} text-blue-500`} />;
    case "return_confirmed": return <CheckCircle2 className={`${cls} text-green-600`} />;
    case "return_reminder_tomorrow": case "return_reminder_today": case "return_reminder_overdue":
      return <Clock className={`${cls} text-amber-500`} />;
    case "dispute_resolved": return <Shield className={`${cls} text-green-600`} />;
    case "sharecoin_earned": return <Coins className={`${cls} text-yellow-500`} />;
    case "milestone_achieved": return <Trophy className={`${cls} text-amber-500`} />;
    case "badge_earned": return <Star className={`${cls} text-purple-600`} />;
    case "level_up": return <TrendingUp className={`${cls} text-green-500`} />;
    case "trust_score_changed": return <Shield className={`${cls} text-blue-500`} />;
    case "new_review_received": return <Star className={`${cls} text-yellow-500`} />;
    case "referral_joined": return <Users className={`${cls} text-teal-500`} />;
    case "security_deposit_released": return <Unlock className={`${cls} text-green-600`} />;
    case "payment_received": return <DollarSign className={`${cls} text-green-600`} />;
    case "verification_failed": return <ShieldAlert className={`${cls} text-red-500`} />;
    default: return <Bell className={`${cls} text-gray-500`} />;
  }
}

// ─── Single activity row ──────────────────────────────────────────────────────

function ActivityRow({
  n,
  onAction,
}: {
  n: SelectNotification;
  onAction: (n: SelectNotification) => void;
}) {
  const dest = getNotificationRoute(n);
  const hasLink = !!dest;

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={`w-full text-left flex items-start gap-3 px-4 py-3.5 rounded-xl transition-colors group
        ${!n.isRead ? "bg-primary/[0.06] hover:bg-primary/[0.09]" : "hover:bg-muted/50"}
        ${hasLink ? "cursor-pointer" : "cursor-default"}
      `}
      onClick={() => onAction(n)}
    >
      {/* Icon */}
      <div className={`shrink-0 mt-0.5 w-9 h-9 rounded-full flex items-center justify-center
        ${!n.isRead ? "bg-primary/10" : "bg-muted"}`}>
        {getIcon(n.type)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm leading-snug ${!n.isRead ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>
            {!n.isRead && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1.5 mb-0.5 align-middle" />
            )}
            {n.title}
          </p>
          <span className="shrink-0 text-[10px] text-muted-foreground/50 mt-0.5 whitespace-nowrap">
            {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
          </span>
        </div>
        {n.message && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
        )}
      </div>

      {/* Arrow */}
      {hasLink && (
        <ChevronRight className="shrink-0 h-4 w-4 text-muted-foreground/25 mt-2 group-hover:text-muted-foreground/50 transition-colors" />
      )}
    </motion.button>
  );
}

// ─── Time group header ────────────────────────────────────────────────────────

function GroupLabel({ label }: { label: string }) {
  return (
    <p className="px-1 pt-5 pb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 first:pt-2">
      {label}
    </p>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "transactions", label: "Transactions" },
  { id: "trust", label: "Trust" },
  { id: "coins", label: "Coins" },
  { id: "system", label: "System" },
];

export default function ActivityPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [showWishlistModal, setShowWishlistModal] = useState(false);
  const [wishlistItem, setWishlistItem] = useState<any>(null);
  const [loadingItem, setLoadingItem] = useState(false);

  const { data: notifications = [], isLoading } = useQuery<SelectNotification[]>({
    queryKey: ["/api/notifications"],
  });

  const markAsReadMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/notifications/${id}/read`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["/api/notifications"] });
      await queryClient.cancelQueries({ queryKey: ["/api/notifications/unread-count"] });
      const prev = queryClient.getQueryData<SelectNotification[]>(["/api/notifications"]);
      const prevCount = queryClient.getQueryData<{ count: number }>(["/api/notifications/unread-count"]);
      queryClient.setQueryData<SelectNotification[]>(["/api/notifications"], (old) =>
        old?.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      queryClient.setQueryData<{ count: number }>(["/api/notifications/unread-count"], (old) => ({
        count: Math.max(0, (old?.count ?? 1) - 1),
      }));
      return { prev, prevCount };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/notifications"], ctx.prev);
      if (ctx?.prevCount) queryClient.setQueryData(["/api/notifications/unread-count"], ctx.prevCount);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const handleClick = async (n: SelectNotification) => {
    if (!n.isRead) markAsReadMutation.mutate(n.id);

    // wishlist match: special modal
    if (n.type === "wishlist_match" && n.itemId) {
      setLoadingItem(true);
      setShowWishlistModal(true);
      try {
        const res = await fetch(`/api/items/${n.itemId}`, { credentials: "include" });
        if (res.ok) setWishlistItem(await res.json());
      } finally {
        setLoadingItem(false);
      }
      return;
    }

    const dest = getNotificationRoute(n);
    if (!dest) return;
    if (dest.type === "url") {
      navigate(dest.url);
    } else {
      window.dispatchEvent(
        new CustomEvent("open-chat-request", {
          detail: { requestId: dest.requestId, scrollToCounter: n.type === "terms_counter_proposed" },
        })
      );
    }
  };

  // Filter by tab
  const filtered = notifications.filter((n) => matchesTab(n.type, activeTab));

  // Group by time
  const groups: { label: string; items: SelectNotification[] }[] = [];
  const today = filtered.filter((n) => isToday(new Date(n.createdAt)));
  const thisWeek = filtered.filter((n) => !isToday(new Date(n.createdAt)) && isThisWeek(new Date(n.createdAt), { weekStartsOn: 1 }));
  const earlier = filtered.filter((n) => !isToday(new Date(n.createdAt)) && !isThisWeek(new Date(n.createdAt), { weekStartsOn: 1 }));
  if (today.length) groups.push({ label: "Today", items: today });
  if (thisWeek.length) groups.push({ label: "This week", items: thisWeek });
  if (earlier.length) groups.push({ label: "Earlier", items: earlier });

  const unreadCount = notifications.filter((n) => !n.isRead && !NOISE_TYPES.has(n.type)).length;

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <Zap className="h-6 w-6 text-primary" />
            Activity
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {unreadCount > 0
              ? `${unreadCount} new event${unreadCount > 1 ? "s" : ""} since your last visit`
              : "You're all caught up"}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-muted/50 rounded-lg p-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${activeTab === tab.id
                  ? "bg-white shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded-xl" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-16">
            <Zap className="h-12 w-12 text-gray-200 mx-auto mb-3" />
            <p className="font-medium text-gray-500">No activity here yet</p>
            <p className="text-sm text-gray-400 mt-1">Events will appear as you and your neighbours share</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <div key={activeTab}>
              {groups.map((group) => (
                <div key={group.label}>
                  <GroupLabel label={group.label} />
                  <div className="space-y-0.5">
                    {group.items.map((n) => (
                      <ActivityRow key={n.id} n={n} onAction={handleClick} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </AnimatePresence>
        )}
      </main>

      {/* Wishlist match modal */}
      <AnimatePresence>
        {showWishlistModal && (
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="bg-gradient-to-r from-pink-500 to-rose-500 p-4 text-white flex items-center gap-2">
                <Heart className="h-5 w-5" />
                <div>
                  <p className="font-bold">Wishlist match</p>
                  <p className="text-white/80 text-xs">A neighbour has an item you wanted</p>
                </div>
                <Button variant="ghost" size="sm" className="ml-auto text-white hover:bg-white/20"
                  onClick={() => { setShowWishlistModal(false); setWishlistItem(null); }}>
                  ✕
                </Button>
              </div>
              <div className="p-4">
                {loadingItem ? (
                  <div className="space-y-3 animate-pulse">
                    <div className="h-36 bg-gray-200 rounded-lg" />
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                  </div>
                ) : wishlistItem ? (
                  <>
                    {wishlistItem.photos?.[0] && (
                      <img src={wishlistItem.photos[0]} alt={wishlistItem.name}
                        className="w-full h-44 object-cover rounded-lg mb-3" />
                    )}
                    <h3 className="font-bold text-lg">{wishlistItem.name}</h3>
                    {wishlistItem.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{wishlistItem.description}</p>
                    )}
                    <div className="flex gap-3 mt-4">
                      <Button variant="outline" className="flex-1"
                        onClick={() => { setShowWishlistModal(false); setWishlistItem(null); }}>
                        Not now
                      </Button>
                      <Button className="flex-1 bg-primary hover:bg-primary/90"
                        onClick={() => { navigate(`/items/${wishlistItem.id}`); setShowWishlistModal(false); setWishlistItem(null); }}>
                        View item
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-center text-gray-400 py-6">Item not found</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
