import { useState, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Check,
  Heart,
  Sparkles,
  Star,
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

type MilestoneItem = { id: string; title: string; description: string; achieved: boolean; icon: React.ReactNode };

function MilestoneRow({ milestone, size = "md" }: { milestone: MilestoneItem; size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <div className="flex items-start gap-2">
      <div className={`mt-0.5 flex-shrink-0 rounded border-2 flex items-center justify-center ${sm ? "w-4 h-4" : "w-5 h-5"} ${milestone.achieved ? "bg-teal-500 border-teal-500" : "border-slate-300 bg-white"}`}>
        {milestone.achieved && <Check className={sm ? "h-2.5 w-2.5 text-white" : "h-3 w-3 text-white"} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-medium leading-tight ${sm ? "text-xs" : "text-sm"} ${milestone.achieved ? "text-slate-800" : "text-slate-500"}`}>{milestone.title}</p>
        <p className={`text-slate-400 leading-tight mt-0.5 ${sm ? "text-[10px]" : "text-xs"}`}>{milestone.description}</p>
      </div>
    </div>
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

  // Animated display score — counts up from fromScore to reputationScore
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
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(start + (end - start) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    // Small delay so the page renders before animating
    const delay = setTimeout(() => {
      rafRef.current = requestAnimationFrame(tick);
    }, 300);

    return () => {
      clearTimeout(delay);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
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

  const badges = [
    { id: "verified", name: "Verified Neighbour", icon: <BadgeCheck className="h-6 w-6" />, earned: user?.isVerified || false, color: "bg-teal-100 text-teal-700 border-teal-200" },
    { id: "reliable", name: "Reliable Borrower", icon: <Handshake className="h-6 w-6" />, earned: (stats?.successfulHandoffs || 0) >= 5, color: "bg-blue-100 text-blue-700 border-blue-200" },
    { id: "generous", name: "Generous Gifter", icon: <Gift className="h-6 w-6" />, earned: (stats?.totalGifts || 0) >= 1, color: "bg-pink-100 text-pink-700 border-pink-200" },
    { id: "urgent", name: "Urgent Helper", icon: <Zap className="h-6 w-6" />, earned: (stats?.helpedUrgent || 0) >= 1, color: "bg-amber-100 text-amber-700 border-amber-200" },
    { id: "builder", name: "Community Builder", icon: <Sprout className="h-6 w-6" />, earned: (stats?.referrals || 0) >= 1 || (stats?.totalSwaps || 0) >= 3, color: "bg-green-100 text-green-700 border-green-200" },
    { id: "super-lender", name: "Super Lender", icon: <Package className="h-6 w-6" />, earned: (stats?.totalLent || 0) >= 10, color: "bg-purple-100 text-purple-700 border-purple-200" },
    { id: "swap-star", name: "Swap Star", icon: <ArrowLeftRight className="h-6 w-6" />, earned: (stats?.totalSwaps || 0) >= 5, color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
    { id: "neighbourhood-hero", name: "Neighbourhood Hero", icon: <Medal className="h-6 w-6" />, earned: reputationScore >= 300, color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
    { id: "rising-star", name: "Rising Star", icon: <TrendingUp className="h-6 w-6" />, earned: (stats?.successfulHandoffs || 0) >= 20, color: "bg-orange-100 text-orange-700 border-orange-200" },
    { id: "shareswap-legend", name: "ShareSwap Legend", icon: <Gem className="h-6 w-6" />, earned: reputationScore >= 500 && (stats?.totalLent || 0) >= 20, color: "bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-700 border-amber-300" },
  ];

  const milestones: MilestoneItem[] = [
    // Column 1
    { id: "first-lend", title: "First item shared", description: "Opened your ShareChest to neighbours", achieved: (stats?.totalLent || 0) >= 1, icon: <Gift className="h-5 w-5" /> },
    { id: "ten-handoffs", title: "10 successful handoffs", description: "Building trust one exchange at a time", achieved: (stats?.successfulHandoffs || 0) >= 10, icon: <Handshake className="h-5 w-5" /> },
    { id: "helped-neighbour", title: "Helped a neighbour in need", description: "Responded to an urgent request", achieved: (stats?.helpedUrgent || 0) >= 1, icon: <Sparkles className="h-5 w-5" /> },
    { id: "level-up", title: `Reached ${currentLevel.name}`, description: "Your reputation is growing", achieved: currentLevelIndex >= 1, icon: <Star className="h-5 w-5" /> },
    { id: "first-review-left", title: "Left your first review", description: "Gave feedback to help the community", achieved: (stats?.reviewsLeft || 0) >= 1, icon: <MessageSquare className="h-5 w-5" /> },
    { id: "five-swaps", title: "5 swaps completed", description: "Become a trading pro in your neighbourhood", achieved: (stats?.totalSwaps || 0) >= 5, icon: <ArrowLeftRight className="h-5 w-5" /> },
    // Column 2
    { id: "ten-gifts", title: "10 gifts given", description: "Generosity that inspires the whole community", achieved: (stats?.totalGifts || 0) >= 10, icon: <Gift className="h-5 w-5" /> },
    { id: "five-borrows", title: "5 borrows completed", description: "Making the most of what your community offers", achieved: (stats?.totalBorrowed || 0) >= 5, icon: <Package className="h-5 w-5" /> },
    { id: "five-listed", title: "5 items listed", description: "Your ShareChest is open for business", achieved: (stats?.itemsListed || 0) >= 5, icon: <TrendingUp className="h-5 w-5" /> },
    { id: "five-reviews-left", title: "5 reviews left", description: "Helping neighbours make great decisions", achieved: (stats?.reviewsLeft || 0) >= 5, icon: <MessageSquare className="h-5 w-5" /> },
    { id: "first-referral", title: "Referred a friend", description: "Growing the ShareSwap neighbourhood", achieved: (stats?.referrals || 0) >= 1, icon: <Users className="h-5 w-5" /> },
    { id: "weekly-warrior", title: "3 transactions in a week", description: "On a sharing roll — keep the momentum going!", achieved: (stats?.weeklyActivity || 0) >= 3, icon: <Zap className="h-5 w-5" /> },
    // Column 3
    { id: "five-reviews-received", title: "Received 5 reviews", description: "Your neighbours love working with you", achieved: (stats?.reviewsReceived || 0) >= 5, icon: <Star className="h-5 w-5" /> },
    { id: "first-borrow", title: "First borrow completed", description: "Experienced the joy of sharing firsthand", achieved: (stats?.totalBorrowed || 0) >= 1, icon: <Heart className="h-5 w-5" /> },
    { id: "ten-lent", title: "10 items lent out", description: "A true pillar of the lending community", achieved: (stats?.totalLent || 0) >= 10, icon: <Package className="h-5 w-5" /> },
    { id: "three-referrals", title: "Invited 3 friends", description: "Building the neighbourhood, one invite at a time", achieved: (stats?.referrals || 0) >= 3, icon: <Users className="h-5 w-5" /> },
    { id: "ten-reviews-received", title: "Received 10 reviews", description: "A well-known face in the community", achieved: (stats?.reviewsReceived || 0) >= 10, icon: <Star className="h-5 w-5" /> },
    { id: "twenty-five-handoffs", title: "25 successful handoffs", description: "An exchange veteran — neighbours count on you", achieved: (stats?.successfulHandoffs || 0) >= 25, icon: <Trophy className="h-5 w-5" /> },
  ];

  const earnedBadges = badges.filter((b) => b.earned);
  const col1 = milestones.slice(0, 6);
  const col2 = milestones.slice(6, 12);
  const col3 = milestones.slice(12, 18);

  // SVG circle constants
  const CIRCUMFERENCE = 2 * Math.PI * 42; // r=42 → ~263.9

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
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke={`url(#${gradientId})`}
                  strokeWidth="8"
                  strokeLinecap="round"
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
                {earnedBadges.length} badge{earnedBadges.length !== 1 ? "s" : ""} earned
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

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold mb-2 flex items-start justify-center gap-2">
            <Trophy className="h-8 w-8 text-primary mt-1 flex-shrink-0" />
            Achievements
          </h1>
        </div>

        {/* ── Desktop Layout ── */}
        <div className="hidden lg:block space-y-6">
          {/* Top row: Trust + Level + Reviews | Badges */}
          <div className="grid lg:grid-cols-[1fr,200px] gap-6">
            <div className="space-y-4">
              <TrustRing gradientId="trustGradientDesktop" />
              <LevelCard />
              <ReviewsSection />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Star className="h-4 w-4 text-teal-500" />Your Badges
              </h2>
              <div className="space-y-2">
                {badges.map((badge) => (
                  <div key={badge.id} className={`p-3 rounded-lg border-2 text-center transition-all ${badge.earned ? badge.color : "bg-slate-50 text-slate-400 border-slate-200 opacity-50"}`}>
                    <div className="flex justify-center mb-1">{badge.icon}</div>
                    <div className="text-xs font-medium leading-tight">{badge.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Milestones: 3 columns of 6 */}
          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-teal-500" />Milestones
            </h2>
            <div className="grid grid-cols-3 gap-x-8 gap-y-0">
              <div className="space-y-2">
                {col1.map((m) => <MilestoneRow key={m.id} milestone={m} />)}
              </div>
              <div className="space-y-2">
                {col2.map((m) => <MilestoneRow key={m.id} milestone={m} />)}
              </div>
              <div className="space-y-2">
                {col3.map((m) => <MilestoneRow key={m.id} milestone={m} />)}
              </div>
            </div>
          </div>
        </div>

        {/* ── Mobile Layout ── */}
        <div className="lg:hidden space-y-4">
          <TrustRing gradientId="trustGradientMobile" />
          <LevelCard />
          <ReviewsSection />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-teal-500" />Milestones
              </h2>
              <div className="space-y-2">
                {milestones.map((m) => <MilestoneRow key={m.id} milestone={m} size="sm" />)}
              </div>
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Star className="h-4 w-4 text-teal-500" />Your Badges
              </h2>
              <div className="space-y-2">
                {badges.map((badge) => (
                  <div key={badge.id} className={`p-2 rounded-lg border-2 text-center transition-all ${badge.earned ? badge.color : "bg-slate-50 text-slate-400 border-slate-200 opacity-50"}`}>
                    <div className="flex justify-center mb-1">{badge.icon}</div>
                    <div className="text-[10px] font-medium leading-tight">{badge.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <span>You're part of a growing community of sharers.</span>
        </div>
      </main>
    </div>
  );
}
