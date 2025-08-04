import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/shared/navbar";
import { Trophy, Award, Star, Users, Gift } from "lucide-react";

interface Achievement {
  id: number;
  name: string;
  description: string;
  badgeIcon: string;
  badgeColor: string;
  pointsRequired?: number;
  category: string;
  isActive: boolean;
}

interface UserAchievement {
  id: number;
  userId: number;
  achievementId: number;
  earnedAt: string;
  progress: number;
  isCompleted: boolean;
  achievement: Achievement;
}

export default function AchievementsPage() {
  const { data: achievements, isLoading: achievementsLoading } = useQuery<Achievement[]>({
    queryKey: ['/api/achievements'],
  });

  const { data: userAchievements, isLoading: userAchievementsLoading } = useQuery<UserAchievement[]>({
    queryKey: ['/api/user-achievements'],
  });

  const completedAchievements = userAchievements?.filter(ua => ua.isCompleted) || [];
  const inProgressAchievements = userAchievements?.filter(ua => !ua.isCompleted && ua.progress > 0) || [];
  
  // Group achievements by category
  const achievementsByCategory = achievements?.reduce((acc, achievement) => {
    if (!acc[achievement.category]) {
      acc[achievement.category] = [];
    }
    acc[achievement.category].push(achievement);
    return acc;
  }, {} as Record<string, Achievement[]>) || {};

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'milestone': return <Trophy className="h-5 w-5" />;
      case 'social': return <Users className="h-5 w-5" />;
      case 'lending': return <Gift className="h-5 w-5" />;
      case 'borrowing': return <Award className="h-5 w-5" />;
      default: return <Star className="h-5 w-5" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'milestone': return 'text-yellow-600';
      case 'social': return 'text-blue-600';
      case 'lending': return 'text-green-600';
      case 'borrowing': return 'text-purple-600';
      default: return 'text-gray-600';
    }
  };

  if (achievementsLoading || userAchievementsLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-12">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center justify-center gap-2">
            <Trophy className="h-8 w-8 text-primary" />
            Your Achievements
          </h1>
          <p className="text-muted-foreground">
            Unlock badges by participating in the sharing community
          </p>
        </div>

        {/* Stats Overview */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-green-600">{completedAchievements.length}</p>
                  <p className="text-sm text-muted-foreground">Achievements Earned</p>
                </div>
                <Trophy className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-blue-600">{inProgressAchievements.length}</p>
                  <p className="text-sm text-muted-foreground">In Progress</p>
                </div>
                <Award className="h-8 w-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-purple-600">{achievements?.length || 0}</p>
                  <p className="text-sm text-muted-foreground">Total Available</p>
                </div>
                <Star className="h-8 w-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Completed Achievements */}
        {completedAchievements.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-green-600" />
                Completed Achievements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {completedAchievements.map((userAchievement) => (
                  <div
                    key={userAchievement.id}
                    className="p-4 rounded-lg border bg-green-50 border-green-200"
                  >
                    <div className="flex items-start gap-3">
                      <div 
                        className="text-2xl p-2 rounded-full"
                        style={{ backgroundColor: userAchievement.achievement.badgeColor + '20' }}
                      >
                        {userAchievement.achievement.badgeIcon}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-green-800">{userAchievement.achievement.name}</h3>
                        <p className="text-sm text-green-600 mb-2">
                          {userAchievement.achievement.description}
                        </p>
                        <Badge variant="secondary" className="bg-green-100 text-green-800">
                          Completed {new Date(userAchievement.earnedAt).toLocaleDateString()}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Achievement Categories */}
        {Object.entries(achievementsByCategory).map(([category, categoryAchievements]) => (
          <Card key={category} className="mb-6">
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 capitalize ${getCategoryColor(category)}`}>
                {getCategoryIcon(category)}
                {category} Achievements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categoryAchievements.map((achievement) => {
                  const userAchievement = userAchievements?.find(ua => ua.achievementId === achievement.id);
                  const isCompleted = userAchievement?.isCompleted || false;
                  const progress = userAchievement?.progress || 0;
                  const progressPercentage = achievement.pointsRequired 
                    ? Math.min((progress / achievement.pointsRequired) * 100, 100)
                    : isCompleted ? 100 : 0;

                  return (
                    <div
                      key={achievement.id}
                      className={`p-4 rounded-lg border transition-colors ${
                        isCompleted 
                          ? 'bg-green-50 border-green-200' 
                          : progress > 0 
                            ? 'bg-yellow-50 border-yellow-200' 
                            : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div 
                          className={`text-2xl p-2 rounded-full ${
                            isCompleted ? 'opacity-100' : 'opacity-50'
                          }`}
                          style={{ backgroundColor: achievement.badgeColor + '20' }}
                        >
                          {achievement.badgeIcon}
                        </div>
                        <div className="flex-1">
                          <h3 className={`font-semibold ${isCompleted ? 'text-green-800' : 'text-gray-800'}`}>
                            {achievement.name}
                          </h3>
                          <p className={`text-sm mb-3 ${isCompleted ? 'text-green-600' : 'text-gray-600'}`}>
                            {achievement.description}
                          </p>
                          
                          {achievement.pointsRequired && !isCompleted && (
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span>Progress</span>
                                <span>{progress}/{achievement.pointsRequired}</span>
                              </div>
                              <Progress value={progressPercentage} className="h-2" />
                            </div>
                          )}
                          
                          {isCompleted && (
                            <Badge variant="secondary" className="bg-green-100 text-green-800">
                              ✓ Completed
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}