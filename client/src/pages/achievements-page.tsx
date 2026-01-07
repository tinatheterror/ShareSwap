import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/shared/navbar";
import { useAuth } from "@/hooks/use-auth";
import {
  Shield,
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
} from "lucide-react";

interface UserStats {
  totalBorrowed: number;
  totalLent: number;
  totalSwaps: number;
  totalGifts: number;
  successfulHandoffs: number;
  referrals: number;
  helpedUrgent: number;
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
  {
    name: "Newcomer",
    minScore: 0,
    perks: ["Access to community ShareChest", "Browse and request items"],
    color: "from-slate-400 to-slate-500",
  },
  {
    name: "Neighbour",
    minScore: 50,
    perks: ["Reduced deposit requirements", "Priority in item requests"],
    color: "from-teal-400 to-teal-500",
  },
  {
    name: "Trusted Member",
    minScore: 150,
    perks: ["Lower deposits on high-value items", "Access to premium items"],
    color: "from-teal-500 to-emerald-500",
  },
  {
    name: "Community Pillar",
    minScore: 300,
    perks: [
      "Minimal deposits",
      "Featured profile",
      "Early access to new features",
    ],
    color: "from-emerald-500 to-green-500",
  },
  {
    name: "ShareSwap Champion",
    minScore: 500,
    perks: [
      "No deposits required",
      "Verified badge",
      "Community ambassador status",
    ],
    color: "from-amber-400 to-yellow-500",
  },
];

export default function AchievementsPage() {
  const { user } = useAuth();

  const { data: stats } = useQuery<UserStats>({
    queryKey: ["/api/user-stats"],
  });

  const { data: reviews } = useQuery<Review[]>({
    queryKey: ["/api/users/username", user?.username, "reviews"],
    enabled: !!user?.username,
  });

  const reputationScore = user?.reputationScore || 0;
  const trustPercentage = Math.min(
    100,
    Math.round((reputationScore / 500) * 100),
  );

  const currentLevelIndex = LEVELS.findIndex((level, index) => {
    const nextLevel = LEVELS[index + 1];
    return !nextLevel || reputationScore < nextLevel.minScore;
  });
  const currentLevel = LEVELS[Math.max(0, currentLevelIndex)];
  const nextLevel = LEVELS[currentLevelIndex + 1];

  const progressToNext = nextLevel
    ? ((reputationScore - currentLevel.minScore) /
        (nextLevel.minScore - currentLevel.minScore)) *
      100
    : 100;

  const badges = [
    {
      id: "verified",
      name: "Verified Neighbour",
      icon: <Shield className="h-6 w-6" />,
      description: "Identity verified and trusted",
      earned: user?.isVerified || false,
      color: "bg-teal-100 text-teal-700 border-teal-200",
    },
    {
      id: "reliable",
      name: "Reliable Borrower",
      icon: <Handshake className="h-6 w-6" />,
      description: "Returns items on time, every time",
      earned: (stats?.successfulHandoffs || 0) >= 5,
      color: "bg-blue-100 text-blue-700 border-blue-200",
    },
    {
      id: "generous",
      name: "Generous Gifter",
      icon: <Gift className="h-6 w-6" />,
      description: "Shared items freely with neighbours",
      earned: (stats?.totalGifts || 0) >= 1,
      color: "bg-pink-100 text-pink-700 border-pink-200",
    },
    {
      id: "urgent",
      name: "Urgent Helper",
      icon: <Zap className="h-6 w-6" />,
      description: "Helped neighbours in a pinch",
      earned: (stats?.helpedUrgent || 0) >= 1,
      color: "bg-amber-100 text-amber-700 border-amber-200",
    },
    {
      id: "builder",
      name: "Community Builder",
      icon: <Sprout className="h-6 w-6" />,
      description: "Growing our neighbourhood together",
      earned: (stats?.referrals || 0) >= 1 || (stats?.totalSwaps || 0) >= 3,
      color: "bg-green-100 text-green-700 border-green-200",
    },
    {
      id: "super-lender",
      name: "Super Lender",
      icon: <Package className="h-6 w-6" />,
      description: "Lent 10+ items to neighbours",
      earned: (stats?.totalLent || 0) >= 10,
      color: "bg-purple-100 text-purple-700 border-purple-200",
    },
    {
      id: "swap-star",
      name: "Swap Star",
      icon: <ArrowLeftRight className="h-6 w-6" />,
      description: "Completed 5+ successful swaps",
      earned: (stats?.totalSwaps || 0) >= 5,
      color: "bg-indigo-100 text-indigo-700 border-indigo-200",
    },
    {
      id: "neighbourhood-hero",
      name: "Neighbourhood Hero",
      icon: <Medal className="h-6 w-6" />,
      description: "Achieved outstanding trust score",
      earned: reputationScore >= 300,
      color: "bg-yellow-100 text-yellow-700 border-yellow-200",
    },
    {
      id: "rising-star",
      name: "Rising Star",
      icon: <TrendingUp className="h-6 w-6" />,
      description: "Growing your community impact",
      earned: (stats?.successfulHandoffs || 0) >= 20,
      color: "bg-orange-100 text-orange-700 border-orange-200",
    },
    {
      id: "shareswap-legend",
      name: "ShareSwap Legend",
      icon: <Gem className="h-6 w-6" />,
      description: "The ultimate community member",
      earned: reputationScore >= 500 && (stats?.totalLent || 0) >= 20,
      color:
        "bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-700 border-amber-300",
    },
  ];

  const milestones = [
    {
      id: "first-borrow",
      title: "First time borrowing",
      description: "Started your sharing journey",
      achieved: (stats?.totalBorrowed || 0) >= 1,
      icon: <Heart className="h-5 w-5" />,
    },
    {
      id: "first-lend",
      title: "First item shared",
      description: "Opened your ShareChest to neighbours",
      achieved: (stats?.totalLent || 0) >= 1,
      icon: <Gift className="h-5 w-5" />,
    },
    {
      id: "first-swap",
      title: "First swap completed",
      description: "Made a fair exchange",
      achieved: (stats?.totalSwaps || 0) >= 1,
      icon: <ArrowLeftRight className="h-5 w-5" />,
    },
    {
      id: "ten-handoffs",
      title: "10 successful handoffs",
      description: "Building trust one exchange at a time",
      achieved: (stats?.successfulHandoffs || 0) >= 10,
      icon: <Handshake className="h-5 w-5" />,
    },
    {
      id: "helped-neighbour",
      title: "Helped a neighbour in need",
      description: "Responded to an urgent request",
      achieved: (stats?.helpedUrgent || 0) >= 1,
      icon: <Sparkles className="h-5 w-5" />,
    },
    {
      id: "level-up",
      title: `Reached ${currentLevel.name}`,
      description: "Your reputation is growing",
      achieved: currentLevelIndex >= 1,
      icon: <Star className="h-5 w-5" />,
    },
  ];

  const earnedBadges = badges.filter((b) => b.earned);
  const achievedMilestones = milestones.filter((m) => m.achieved);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800 mb-1">
            Your Community Journey
          </h1>
          <p className="text-slate-600 text-sm">
            Every share makes our neighbourhood stronger
          </p>
        </div>

        {/* Main 2-Column Layout: Left (Trust/Level/Milestones) + Right (Badges) */}
        <div className="grid lg:grid-cols-[1fr,200px] gap-6">
          {/* Left Column */}
          <div className="space-y-4 lg:pt-9">
            {/* Community Trust - Visual Ring */}
            <Card className="overflow-hidden">
              <CardContent className="py-4 px-5">
                <div className="flex items-center gap-5">
                  {/* Trust Ring */}
                  <div className="relative w-28 h-28 flex-shrink-0">
                    <svg
                      className="w-full h-full transform -rotate-90"
                      viewBox="0 0 100 100"
                    >
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth="8"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke="url(#trustGradient)"
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${trustPercentage * 2.64} 264`}
                        className="transition-all duration-1000 ease-out"
                      />
                      <defs>
                        <linearGradient
                          id="trustGradient"
                          x1="0%"
                          y1="0%"
                          x2="100%"
                          y2="0%"
                        >
                          <stop offset="0%" stopColor="#0DCEA1" />
                          <stop offset="100%" stopColor="#10B981" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <Shield className="h-8 w-8 text-teal-500 mb-1" />
                      <span className="text-sm font-medium text-slate-600">
                        Community
                      </span>
                      <span className="text-sm font-medium text-slate-600">
                        Trust
                      </span>
                    </div>
                  </div>

                  {/* Trust Message */}
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-slate-800 mb-1">
                      {trustPercentage >= 80
                        ? "You're a trusted neighbour!"
                        : trustPercentage >= 50
                          ? "You're doing great!"
                          : trustPercentage >= 25
                            ? "You're on your way!"
                            : "Welcome to the community!"}
                    </h2>
                    <p className="text-slate-600 text-sm mb-2">
                      {trustPercentage >= 80
                        ? "Your neighbours trust you with their items."
                        : trustPercentage >= 50
                          ? "Building a solid reputation."
                          : trustPercentage >= 25
                            ? "Each exchange builds more trust."
                            : "Start sharing to build trust with your neighbours."}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {user?.isVerified && (
                        <Badge className="bg-teal-100 text-teal-700 border-teal-200 text-xs">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Verified
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="text-slate-600 text-xs"
                      >
                        {earnedBadges.length} badge
                        {earnedBadges.length !== 1 ? "s" : ""} earned
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Neighbour Level */}
            <Card>
              <CardContent className="py-4 px-5">
                <div className="flex items-center gap-4">
                  <div
                    className={`p-2.5 rounded-xl bg-gradient-to-br ${currentLevel.color}`}
                  >
                    <Crown className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-slate-800">
                        {currentLevel.name}
                      </h3>
                      <Badge variant="outline" className="text-xs">
                        Level {currentLevelIndex + 1}
                      </Badge>
                    </div>

                    {/* Perks */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 mb-2">
                      {currentLevel.perks.map((perk, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <CheckCircle className="h-3 w-3 text-teal-500" />
                          {perk}
                        </span>
                      ))}
                    </div>

                    {/* Progress bar */}
                    {nextLevel && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full bg-gradient-to-r ${currentLevel.color} transition-all duration-500`}
                            style={{
                              width: `${Math.min(progressToNext, 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          Next: {nextLevel.name}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Reviews */}
            <div>
              <h2 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-teal-500" />
                What Neighbours Say
              </h2>
              {reviews && reviews.length > 0 ? (
                <div className="space-y-2">
                  {reviews.slice(0, 3).map((review) => (
                    <div
                      key={review.id}
                      className="p-3 rounded-lg bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-100"
                    >
                      <div className="flex items-start gap-3">
                        <Quote className="h-4 w-4 text-teal-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          {review.comment && (
                            <p className="text-sm text-slate-700 italic mb-2 line-clamp-2">
                              "{review.comment}"
                            </p>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">
                              — {review.reviewer.username}
                            </span>
                            <div className="flex items-center gap-0.5">
                              {[...Array(5)].map((_, i) => (
                                <Star
                                  key={i}
                                  className={`h-3 w-3 ${
                                    i < review.rating
                                      ? "text-amber-400 fill-amber-400"
                                      : "text-slate-200"
                                  }`}
                                />
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
                  <p className="text-sm text-slate-500">
                    No reviews yet. Complete transactions to receive feedback from neighbours!
                  </p>
                </div>
              )}
            </div>

            {/* Milestones */}
            <div>
              <h2 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-teal-500" />
                Milestones
              </h2>
              <div className="space-y-2">
                {milestones.map((milestone) => (
                  <div
                    key={milestone.id}
                    className="flex items-start gap-3"
                  >
                    <div className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      milestone.achieved
                        ? "bg-teal-500 border-teal-500"
                        : "border-slate-300 bg-white"
                    }`}>
                      {milestone.achieved && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3
                        className={`text-sm font-medium ${
                          milestone.achieved
                            ? "text-slate-800"
                            : "text-slate-500"
                        }`}
                      >
                        {milestone.title}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {milestone.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Badges */}
          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <Star className="h-4 w-4 text-teal-500" />
              Your Badges
            </h2>
            <div className="space-y-2">
              {badges.map((badge) => (
                <div
                  key={badge.id}
                  className={`p-3 rounded-lg border-2 text-center transition-all ${
                    badge.earned
                      ? badge.color
                      : "bg-slate-50 text-slate-400 border-slate-200 opacity-50"
                  }`}
                >
                  <div className="flex justify-center mb-1">{badge.icon}</div>
                  <div className="text-xs font-medium leading-tight">
                    {badge.name}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Encouraging Footer */}
        <div className="mt-6 text-center">
          <span>You're part of a growing community of sharers.</span>
        </div>
      </main>
    </div>
  );
}
