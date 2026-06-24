import { useState, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/shared/navbar";
import { useAuth } from "@/hooks/use-auth";
import {
  Shield,
  BadgeCheck,
  Handshake,
  Gift,
  Zap,
  Sprout,
  CheckCircle,
  Heart,
  Sparkles,
  Star,
  User,
  Users,
  ArrowLeftRight,
  Crown,
  Medal,
  Gem,
  TrendingUp,
  Package,
  MessageSquare,
  Quote,
  Trophy,
  Flame,
  Timer,
  Repeat2,
  HeartHandshake,
  ShoppingBag,
  Key,
  Layers,
  Truck,
} from "lucide-react";

interface UserStats {
  totalBorrowed: number;
  totalLent: number;
  totalSwaps: number;
  totalGifts: number;
  successfulHandoffs: number;
  referrals: number;
  helpedUrgent: number;
  reviewsLeft: number;
  reviewsReceived: number;
  itemsListed: number;
  weeklyActivity: number;
  fastResponder: boolean;
  fiveStarNeighbour: boolean;
  earlyMember: boolean;
  courierDeliveries: number;
}

interface Review {
  id: number;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewer: {
    id: number;
    username: string;
    profilePhoto?: string;
  };
}

const LEVELS = [
  { name: "Newcomer", minScore: 0, perks: ["Access to community ShareChest", "Browse and request items"], color: "from-slate-400 to-slate-500" },
  { name: "Neighbour", minScore: 50, perks: ["Reduced deposit requirements", "Priority in item requests"], color: "from-teal-400 to-teal-500" },
  { name: "Trusted Member", minScore: 150, perks: ["Lower deposits on high-value items", "Access to premium items"], color: "from-teal-500 to-emerald-500" },
  { name: "Community Pillar", minScore: 300, perks: ["Minimal deposits", "Featured profile", "Early access to new features"], color: "from-emerald-500 to-green-500" },
  { name: "ShareSwap Champion", minScore: 500, perks: ["No deposits required", "Verified badge", "Community ambassador status"], color: "from-amber-400 to-yellow-500" },
];

type BadgeItem = { id: string; name: string; icon: React.ReactNode; earned: boolean; color: string; description: string; requirement: string };

function BadgeCard({ badge, popoverSide = "bottom" }: { badge: BadgeItem; popoverSide?: "bottom" | "left" | "right" | "top" }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={`w-full p-3 rounded-xl border-2 text-center transition-all cursor-pointer hover:scale-105 active:scale-95 ${badge.earned ? badge.color : "bg-slate-50 text-slate-400 border-slate-200"}`}>
          <div className="flex justify-center mb-2 scale-150">{badge.icon}</div>
          <div className="text-[8px] font-semibold leading-tight">{badge.name}</div>
        </button>
      </PopoverTrigger>
      <PopoverContent side={popoverSide} align="center" className="w-56 p-3 z-50">
        <div className="flex items-center gap-2 mb-2">
          <div className={`p-1.5 rounded-lg border ${badge.earned ? badge.color : "bg-slate-100 text-slate-400 border-slate-200"}`}>
            {badge.icon}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800 leading-tight">{badge.name}</p>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badge.earned ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
              {badge.earned ? "✓ Earned" : "Locked"}
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-600 mb-2 leading-snug">{badge.description}</p>
        <div className="bg-slate-50 rounded p-2">
          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-0.5">How to earn</p>
          <p className="text-xs text-slate-700 leading-snug">{badge.requirement}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function AchievementsPage() {
  const { user } = useAuth();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const fromParam = params.get("from");
  const fromScore = fromParam !== null ? parseInt(fromParam) : null;

  const { data: stats } = useQuery<UserStats>({ queryKey: ["/api/user-stats"] });
  const { data: reviews } = useQuery<Review[]>({
    queryKey: [`/api/users/username/${user?.username}/reviews`],
    enabled: !!user?.username,
  });

  const reputationScore = user?.reputationScore || 0;

  const [displayScore, setDisplayScore] = useState(fromScore !== null ? fromScore : reputationScore);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (fromScore === null || fromScore === reputationScore) {
      setDisplayScore(reputationScore);
      return;
    }
    const start = fromScore;
    const end = reputationScore;
    const duration = 1400;
    let startTime: number | null = null;
    const tick = (now: number) => {
      if (!startTime) startTime = now;
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(start + (end - start) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    const delay = setTimeout(() => { rafRef.current = requestAnimationFrame(tick); }, 300);
    return () => { clearTimeout(delay); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [fromScore, reputationScore]);

  const displayTrustPercentage = Math.min(100, Math.round((displayScore / 500) * 100));
  const trustPercentage = Math.min(100, Math.round((reputationScore / 500) * 100));

  const currentLevelIndex = LEVELS.findIndex((level, index) => {
    const nextLevel = LEVELS[index + 1];
    return !nextLevel || reputationScore < nextLevel.minScore;
  });
  const currentLevel = LEVELS[Math.max(0, currentLevelIndex)];
  const nextLevel = LEVELS[currentLevelIndex + 1];
  const progressToNext = nextLevel
    ? ((reputationScore - currentLevel.minScore) / (nextLevel.minScore - currentLevel.minScore)) * 100
    : 100;

  const badges: BadgeItem[] = [
    // Verification & identity
    { id: "verified", name: "Verified Neighbour", icon: <BadgeCheck className="h-5 w-5" />, earned: user?.isVerified || false, color: "bg-teal-100 text-teal-700 border-teal-200", description: "A confirmed member of the ShareSwap community.", requirement: "Complete identity verification — selfie + government ID." },
    { id: "early-member", name: "Early Member", icon: <span className="relative inline-flex"><User className="h-5 w-5" /><Crown className="h-2.5 w-2.5 absolute -top-1 -right-1 fill-current" /></span>, earned: stats?.earlyMember || false, color: "bg-violet-100 text-violet-700 border-violet-200", description: "You were here from the beginning — a founding member of the ShareSwap neighbourhood.", requirement: "Joined during the ShareSwap beta period." },

    // First steps (1 transaction each — onboarding wins)
    { id: "first-share", name: "First Share", icon: <Sprout className="h-5 w-5" />, earned: (stats?.totalLent || 0) >= 1, color: "bg-green-100 text-green-700 border-green-200", description: "You opened your ShareChest and shared with a neighbour for the first time.", requirement: "Complete 1 item lending transaction." },
    { id: "first-borrow", name: "First Borrow", icon: <Heart className="h-5 w-5" />, earned: (stats?.totalBorrowed || 0) >= 1, color: "bg-sky-100 text-sky-700 border-sky-200", description: "You experienced the joy of borrowing from your community.", requirement: "Complete 1 borrow transaction." },
    { id: "first-swap", name: "Swap Starter", icon: <ArrowLeftRight className="h-5 w-5" />, earned: (stats?.totalSwaps || 0) >= 1, color: "bg-indigo-100 text-indigo-700 border-indigo-200", description: "You made your first trade — giving something to get something.", requirement: "Complete 1 item swap." },
    { id: "generous", name: "Generous Gifter", icon: <Gift className="h-5 w-5" />, earned: (stats?.totalGifts || 0) >= 3, color: "bg-pink-100 text-pink-700 border-pink-200", description: "You give freely and often — a true spirit of generosity.", requirement: "Complete at least 3 gift transactions." },
    { id: "urgent", name: "Urgent Helper", icon: <Zap className="h-5 w-5" />, earned: (stats?.helpedUrgent || 0) >= 1, color: "bg-amber-100 text-amber-700 border-amber-200", description: "You stepped up when a neighbour needed something urgently.", requirement: "Fulfil at least 1 urgent wishlist request." },

    // Growing activity
    { id: "active-borrower", name: "Active Borrower", icon: <ShoppingBag className="h-5 w-5" />, earned: (stats?.totalBorrowed || 0) >= 5, color: "bg-cyan-100 text-cyan-700 border-cyan-200", description: "You make the most of what your community has to offer.", requirement: "Complete 5 borrow transactions." },
    { id: "swap-star", name: "Swap Star", icon: <span className="relative inline-flex"><Repeat2 className="h-5 w-5" /><Star className="h-2.5 w-2.5 absolute -top-1 -right-1 fill-current" /></span>, earned: (stats?.totalSwaps || 0) >= 5, color: "bg-indigo-100 text-indigo-700 border-indigo-200", description: "You've mastered the art of the swap — trading fairly and often.", requirement: "Complete 5 item swaps." },
    { id: "generous-soul", name: "Generous Soul", icon: <HeartHandshake className="h-5 w-5" />, earned: (stats?.totalGifts || 0) >= 10, color: "bg-rose-100 text-rose-700 border-rose-200", description: "Your generosity is legendary — you give freely and often.", requirement: "Complete 10 gift transactions." },
    { id: "sharechest-curator", name: "ShareChest Curator", icon: <Key className="h-5 w-5" />, earned: (stats?.itemsListed || 0) >= 5, color: "bg-teal-100 text-teal-700 border-teal-200", description: "Your ShareChest is open for business — you've built a real lending library.", requirement: "List 5 or more items." },
    { id: "power-lister", name: "Power Lister", icon: <Layers className="h-5 w-5" />, earned: (stats?.itemsListed || 0) >= 10, color: "bg-emerald-100 text-emerald-700 border-emerald-200", description: "Your ShareChest is stocked — 10 items ready for the neighbourhood.", requirement: "List 10 or more items." },
    { id: "courier-rider", name: "Courier Rider", icon: <Truck className="h-5 w-5" />, earned: (stats?.courierDeliveries || 0) >= 1, color: "bg-cyan-100 text-cyan-700 border-cyan-200", description: "You went the extra distance — used courier delivery for a transaction.", requirement: "Complete at least 1 transaction using courier delivery." },
    { id: "weekly-warrior", name: "Weekly Warrior", icon: <Flame className="h-5 w-5" />, earned: (stats?.weeklyActivity || 0) >= 3, color: "bg-red-100 text-red-700 border-red-200", description: "You're on a sharing streak — active and engaged every week.", requirement: "Complete 3 transactions in a single week." },
    { id: "community-builder", name: "Community Builder", icon: <Users className="h-5 w-5" />, earned: (stats?.referrals || 0) >= 1, color: "bg-blue-100 text-blue-700 border-blue-200", description: "You've started growing the ShareSwap community — your first referral is in.", requirement: "Refer 1 friend who completes their first transaction." },
    { id: "neighbour-connector", name: "Neighbour Connector", icon: <span className="relative inline-flex"><Users className="h-5 w-5" /><Star className="h-2.5 w-2.5 absolute top-1 right-0 fill-current" /></span>, earned: (stats?.referrals || 0) >= 5, color: "bg-blue-100 text-blue-700 border-blue-200", description: "You're actively growing the ShareSwap community around you.", requirement: "Refer 5 friends who each complete their first transaction." },

    // Lending & handoffs
    { id: "reliable", name: "Reliable Borrower", icon: <Handshake className="h-5 w-5" />, earned: (stats?.successfulHandoffs || 0) >= 5, color: "bg-blue-100 text-blue-700 border-blue-200", description: "You return items on time and treat neighbours' belongings with care.", requirement: "Complete 5 successful item exchanges." },
    { id: "trusted-exchanger", name: "Trusted Exchanger", icon: <Shield className="h-5 w-5" />, earned: (stats?.successfulHandoffs || 0) >= 10, color: "bg-sky-100 text-sky-800 border-sky-200", description: "Neighbours know they can trust you to follow through every time.", requirement: "Complete 10 successful item exchanges." },
    { id: "super-lender", name: "Super Lender", icon: <Package className="h-5 w-5" />, earned: (stats?.totalLent || 0) >= 10, color: "bg-purple-100 text-purple-700 border-purple-200", description: "Your ShareChest is a community staple — neighbours borrow from you regularly.", requirement: "Lend out items in 10 completed transactions." },
    { id: "rising-star", name: "Rising Star", icon: <TrendingUp className="h-5 w-5" />, earned: (stats?.successfulHandoffs || 0) >= 20, color: "bg-orange-100 text-orange-700 border-orange-200", description: "You're on a roll — an exchange veteran that neighbours rely on.", requirement: "Complete 20 successful item exchanges." },
    { id: "exchange-veteran", name: "Exchange Veteran", icon: <Trophy className="h-5 w-5" />, earned: (stats?.successfulHandoffs || 0) >= 25, color: "bg-amber-100 text-amber-700 border-amber-200", description: "25 exchanges — you've built something most people only dream about.", requirement: "Complete 25 successful item exchanges." },

    // Reviews
    { id: "community-voice", name: "Community Voice", icon: <MessageSquare className="h-5 w-5" />, earned: (stats?.reviewsLeft || 0) >= 5, color: "bg-orange-100 text-orange-700 border-orange-200", description: "Your feedback helps neighbours make great decisions.", requirement: "Leave 5 reviews for other members." },
    { id: "well-loved", name: "Well Loved", icon: <Crown className="h-5 w-5" />, earned: (stats?.reviewsReceived || 0) >= 10, color: "bg-purple-100 text-purple-700 border-purple-200", description: "A well-known and trusted face in the community.", requirement: "Receive 10 or more reviews." },

    // Performance & prestige
    { id: "fast-responder", name: "Fast Responder", icon: <Timer className="h-5 w-5" />, earned: stats?.fastResponder || false, color: "bg-lime-100 text-lime-700 border-lime-200", description: "Neighbours know they can count on you to move quickly.", requirement: "Complete 5 exchanges as a lender within 48 hours of the request." },
    { id: "five-star-neighbour", name: "Five-Star Neighbour", icon: <Star className="h-5 w-5" />, earned: stats?.fiveStarNeighbour || false, color: "bg-yellow-100 text-yellow-800 border-yellow-300", description: "Your neighbours consistently rate their experience with you at the highest level.", requirement: "Receive 5+ reviews with an average rating of 4.8 stars or above." },
    { id: "neighbourhood-hero", name: "Neighbourhood Hero", icon: <Medal className="h-5 w-5" />, earned: reputationScore >= 300, color: "bg-yellow-100 text-yellow-700 border-yellow-200", description: "Your reputation speaks for itself — a pillar of the local sharing community.", requirement: "Reach a trust score of 300 or above." },
    { id: "shareswap-legend", name: "ShareSwap Legend", icon: <Gem className="h-5 w-5" />, earned: reputationScore >= 500 && (stats?.totalLent || 0) >= 20, color: "bg-gradient-to-br from-amber-100 to-yellow-100 text-amber-700 border-amber-300", description: "The rarest badge on the platform. You've built something extraordinary.", requirement: "Reach a trust score of 500 and lend out 20+ items." },
    { id: "shareswap-ambassador", name: "ShareSwap Ambassador", icon: <span className="relative inline-flex"><Star className="h-2.5 w-2.5 absolute top-1 -left-1 fill-current" /><Users className="h-5 w-5" /><Star className="h-2.5 w-2.5 absolute top-1 -right-1 fill-current" /></span>, earned: (stats?.referrals || 0) >= 20, color: "bg-indigo-100 text-indigo-700 border-indigo-200", description: "You've brought 20 neighbours into the ShareSwap community — a true ambassador.", requirement: "Refer 20 friends who each complete their first transaction." },
  ];

  const earnedBadges = badges.filter((b) => b.earned);
  const CIRCUMFERENCE = 2 * Math.PI * 42;

  const TrustRing = ({ gradientId }: { gradientId: string }) => (
    <Card className="overflow-hidden">
      <CardContent className="py-4 px-5">
        <div className="flex items-start gap-5">
          <div className="flex flex-col items-center flex-shrink-0 gap-1">
            <div className="relative w-28 h-28">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <defs>
                  <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#0DCEA1" />
                    <stop offset="100%" stopColor="#10B981" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" strokeWidth="8" />
                <circle cx="50" cy="50" r="42" fill="none" stroke={`url(#${gradientId})`} strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={`${(displayTrustPercentage / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                  style={{ transition: fromScore !== null ? "none" : "stroke-dasharray 1s ease-out" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <Shield className="h-8 w-8 text-teal-500 mb-1" />
                <span className="text-sm font-medium text-slate-600">Trust</span>
                <span className="text-sm font-medium text-slate-600">Score</span>
              </div>
            </div>
            <span className="text-lg font-bold text-slate-800 tabular-nums">{displayScore}</span>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-800 mb-1">
              {trustPercentage >= 80 ? "You're a trusted neighbour!" : trustPercentage >= 50 ? "You're doing great!" : trustPercentage >= 25 ? "You're on your way!" : "You're new here!"}
            </h2>
            <p className="text-slate-600 text-sm mb-2">
              {trustPercentage >= 80 ? "Your neighbours trust you with their items." : trustPercentage >= 50 ? "Building a solid reputation." : trustPercentage >= 25 ? "Each exchange builds more trust." : "Start sharing to build your trust score."}
            </p>
            <div className="flex flex-wrap gap-1">
              {user?.isVerified && (
                <Badge className="bg-teal-100 text-teal-700 border-teal-200 text-xs">
                  <BadgeCheck className="h-3 w-3 mr-1" />Verified
                </Badge>
              )}
              <Badge variant="outline" className="text-slate-600 text-xs">
                {earnedBadges.length} / {badges.length} badges earned
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const LevelCard = () => (
    <Card>
      <CardContent className="py-4 px-5">
        <div className="flex items-center gap-4">
          <div className={`p-2.5 rounded-xl bg-gradient-to-br ${currentLevel.color}`}>
            <Crown className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-base font-semibold text-slate-800">{currentLevel.name}</h3>
              <Badge variant="outline" className="text-xs">Level {currentLevelIndex + 1}</Badge>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 mb-2">
              {currentLevel.perks.map((perk, i) => (
                <span key={i} className="flex items-center gap-1"><CheckCircle className="h-3 w-3 text-teal-500" />{perk}</span>
              ))}
            </div>
            {nextLevel && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full bg-gradient-to-r ${currentLevel.color} transition-all duration-500`} style={{ width: `${Math.min(progressToNext, 100)}%` }} />
                </div>
                <span className="text-xs text-slate-500 whitespace-nowrap">Next: {nextLevel.name}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const ReviewsSection = () => (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-teal-500" />What Neighbours Say
        </h2>
        {(stats?.reviewsLeft || 0) > 0 && (
          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            {stats!.reviewsLeft} review{stats!.reviewsLeft !== 1 ? "s" : ""} left for others
          </span>
        )}
      </div>
      {reviews && reviews.length > 0 ? (
        <div className="space-y-2">
          {reviews.slice(0, 3).map((review) => (
            <div key={review.id} className="p-3 rounded-lg bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-100">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0">
                  {(review.reviewer as any).profilePhoto ? (
                    <img src={(review.reviewer as any).profilePhoto} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-teal-600 flex items-center justify-center text-white text-[10px] font-bold">
                      {((review.reviewer as any).displayName || review.reviewer.username).charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {review.comment && <p className="text-sm text-slate-700 italic mb-2 line-clamp-2">"{review.comment}"</p>}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">— {(review.reviewer as any).displayName || (review.reviewer as any).handle || review.reviewer.username}</span>
                    <div className="flex items-center gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`h-3 w-3 ${i < review.rating ? "text-amber-400 fill-amber-400" : "text-slate-200"}`} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 rounded-lg bg-slate-50 border border-slate-100 text-center">
          <Quote className="h-6 w-6 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No reviews yet. Complete transactions to receive feedback from neighbours!</p>
        </div>
      )}
    </div>
  );

  const BadgesGrid = ({ cols = 5 }: { cols?: number }) => (
    <div>
      <h2 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-2 whitespace-nowrap"><Star className="h-4 w-4 text-teal-500" />Your Badges</span>
        <span className="text-xs font-normal text-slate-400 whitespace-nowrap">Tap any badge to learn more</span>
      </h2>
      <div className={`grid gap-2 ${cols === 5 ? "grid-cols-5" : "grid-cols-3"}`}>
        {badges.map((badge) => (
          <BadgeCard key={badge.id} badge={badge} popoverSide="bottom" />
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold mb-2 flex items-start justify-center gap-2">
            <Trophy className="h-8 w-8 text-primary mt-1 flex-shrink-0" />
            Achievements
          </h1>
        </div>

        {/* ── Desktop Layout ── */}
        <div className="hidden lg:block space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <TrustRing gradientId="trustGradientDesktop" />
            <LevelCard />
          </div>
          <ReviewsSection />
          <BadgesGrid cols={5} />
        </div>

        {/* ── Mobile Layout ── */}
        <div className="lg:hidden space-y-4">
          <TrustRing gradientId="trustGradientMobile" />
          <LevelCard />
          <ReviewsSection />
          <BadgesGrid cols={3} />
        </div>

        <div className="mt-6 text-center text-sm text-slate-400">
          You're part of a growing community of sharers.
        </div>
      </main>
    </div>
  );
}
