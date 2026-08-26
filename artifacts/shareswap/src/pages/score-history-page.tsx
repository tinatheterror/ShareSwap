import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock, Shield } from "lucide-react";
import { useLocation } from "wouter";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

interface ReputationActivity {
  activityType: string;
  points: number;
  description: string;
  createdAt?: string | null;
}

interface ReputationData {
  reputationScore: number;
  reputationLevel: string;
  recentActivities: ReputationActivity[];
}

function formatScoreHistoryDate(dateString: string | null | undefined): string {
  if (!dateString) return "–";

  const parsedDate = new Date(dateString);
  if (Number.isNaN(parsedDate.getTime())) return "–";

  return parsedDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function ScoreHistoryPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { data: reputation, isLoading } = useQuery<ReputationData>({
    queryKey: [`/api/users/${user?.id}/reputation`],
    enabled: !!user?.id,
  });

  const activities = (reputation?.recentActivities ?? []).filter((activity) => activity.points !== 0);

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <button
          type="button"
          onClick={() => navigate("/achievements")}
          className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 rounded-md"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Achievements
        </button>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
              <Shield className="h-7 w-7 text-teal-500" aria-hidden="true" />
              Score History
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              See how your sharing activity has shaped your trust score.
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs uppercase tracking-wide text-slate-400">Current score</p>
            <p className="text-3xl font-bold text-teal-600 tabular-nums">
              {reputation?.reputationScore ?? user?.reputationScore ?? 0}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Trust score changes</h2>
            {isLoading ? (
              <p className="text-sm text-slate-500 py-8 text-center">Loading your score history…</p>
            ) : activities.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {activities.map((activity, index) => {
                  const isPositive = activity.points > 0;
                  return (
                    <div
                      key={`${activity.createdAt}-${activity.activityType}-${index}`}
                      className="flex items-center gap-3 py-4 first:pt-0 last:pb-0"
                    >
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${isPositive ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
                        <Shield className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800">{activity.description}</p>
                        <p className="text-xs text-slate-500 mt-1 inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          {formatScoreHistoryDate(activity.createdAt)}
                        </p>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
                        {isPositive ? "+" : "−"}{Math.abs(activity.points)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-10 text-center">
                <Shield className="h-8 w-8 text-slate-300 mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-700">No score changes yet</p>
                <p className="text-sm text-slate-500 mt-1">Complete your first share to start building history.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}