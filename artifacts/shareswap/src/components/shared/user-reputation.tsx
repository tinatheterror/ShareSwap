import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, Award, Clock } from "lucide-react";
import { format } from "date-fns";

type ReputationActivity = {
  activityType: string;
  points: number;
  description: string;
  createdAt: string;
};

type UserReview = {
  id: number;
  rating: number;
  comment: string;
  createdAt: string;
  reviewer: {
    id: number;
    username: string;
  };
};

type Props = {
  userId: number;
};

export function UserReputation({ userId }: Props) {
  const { data: reputation } = useQuery({
    queryKey: [`/api/users/${userId}/reputation`],
    enabled: !!userId,
  });

  if (!reputation) return null;

  const levelColors = {
    Newcomer: "bg-gray-500",
    Regular: "bg-teal-500",
    Trusted: "bg-teal-500",
    Expert: "bg-teal-500",
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Reputation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-2xl font-semibold">
                {reputation.reputationScore} points
              </p>
              <Badge
                className={`${
                  levelColors[
                    reputation.reputationLevel as keyof typeof levelColors
                  ]
                }`}
              >
                <Award className="w-3 h-3 mr-1" />
                {reputation.reputationLevel}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Recent Activities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {reputation.recentActivities.map((activity: ReputationActivity) => (
            <div
              key={activity.createdAt}
              className="flex items-center justify-between"
            >
              <div>
                <p className="font-medium">{activity.description}</p>
                <p className="text-sm text-muted-foreground">
                  <Clock className="w-3 h-3 inline mr-1" />
                  {format(new Date(activity.createdAt), "MMM d, yyyy")}
                </p>
              </div>
              <Badge variant="secondary">+{activity.points} points</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Recent Reviews</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {reputation.reviews.map((review: UserReview) => (
            <div key={review.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {review.reviewer.username}
                </p>
                <div className="flex items-center">
                  {Array.from({ length: review.rating }).map((_, i) => (
                    <Star
                      key={i}
                      className="w-4 h-4 text-teal-500 fill-current"
                    />
                  ))}
                </div>
              </div>
              {review.comment && (
                <p className="text-sm text-muted-foreground">{review.comment}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {format(new Date(review.createdAt), "MMM d, yyyy")}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
