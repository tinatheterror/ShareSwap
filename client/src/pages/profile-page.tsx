import { useState } from "react";
import { ProgressTracker, CommunityBadge } from "@/components/gamification/progress-tracker";
import { VerificationBadge, UserReputation } from "@/components/trust/verification-badge";
import { SafetyTips } from "@/components/safety/safety-tips";
import { useAuth } from "@/hooks/use-auth";
import { Settings, Star, Heart, Zap, Users, Award, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const communityBadges = [
  {
    title: "First Share",
    description: "Share your first item with the community",
    icon: <Heart className="w-5 h-5" />,
    earned: true,
    progress: 100
  },
  {
    title: "Helpful Neighbor",
    description: "Complete 10 successful transactions",
    icon: <Users className="w-5 h-5" />,
    earned: true,
    progress: 100
  },
  {
    title: "Community Champion",
    description: "Maintain a 5-star rating for 30 days",
    icon: <Award className="w-5 h-5" />,
    earned: false,
    progress: 75
  },
  {
    title: "Super Sharer",
    description: "Share 50 different items",
    icon: <Zap className="w-5 h-5" />,
    earned: false,
    progress: 40
  },
  {
    title: "Trust Builder",
    description: "Reach expert verification level",
    icon: <Target className="w-5 h-5" />,
    earned: false,
    progress: 60
  }
];

export default function ProfilePage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");

  if (!user) {
    return <div>Please log in to view your profile.</div>;
  }

  return (
    <div className="min-h-screen pb-20 bg-gray-50">
      <div className="max-w-4xl mx-auto p-4">
        {/* Profile Header */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center text-2xl font-bold text-white">
                {user.username.substring(0, 2).toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-2xl font-bold">{user.username}</h1>
                  <VerificationBadge level="trusted" />
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-yellow-400 fill-current" />
                    4.9 (127 reviews)
                  </span>
                  <span>Member since Jan 2024</span>
                </div>
              </div>
              <Button variant="outline" size="sm">
                <Settings className="w-4 h-4 mr-1" />
                Settings
              </Button>
            </div>
            
            {/* Reputation Progress */}
            <div className="mb-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium">Community Reputation</span>
                <span className="text-gray-600">87/100</span>
              </div>
              <UserReputation score={87} maxScore={100} />
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-primary">23</div>
                <div className="text-xs text-gray-600">Items Shared</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">45</div>
                <div className="text-xs text-gray-600">Successful Loans</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">12</div>
                <div className="text-xs text-gray-600">Day Streak</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">Level 3</div>
                <div className="text-xs text-gray-600">Community Level</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="achievements">Achievements</TabsTrigger>
            <TabsTrigger value="safety">Safety</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            {/* Progress Tracker */}
            <ProgressTracker
              currentLevel={3}
              currentXP={750}
              nextLevelXP={1000}
              streak={12}
              contributions={23}
            />

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                      <Heart className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Lent camera equipment to Sarah</p>
                      <p className="text-sm text-gray-600">2 hours ago</p>
                    </div>
                    <div className="text-green-600 font-medium">+15 XP</div>
                  </div>
                  
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <Star className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Received 5-star review from Mike</p>
                      <p className="text-sm text-gray-600">1 day ago</p>
                    </div>
                    <div className="text-blue-600 font-medium">+10 XP</div>
                  </div>
                  
                  <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg">
                    <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                      <Award className="w-4 h-4 text-purple-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Earned "Helpful Neighbor" badge</p>
                      <p className="text-sm text-gray-600">3 days ago</p>
                    </div>
                    <div className="text-purple-600 font-medium">+25 XP</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="achievements" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Community Badges</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {communityBadges.map((badge, index) => (
                    <CommunityBadge
                      key={index}
                      title={badge.title}
                      description={badge.description}
                      icon={badge.icon}
                      earned={badge.earned}
                      progress={badge.progress}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Milestone Progress */}
            <Card>
              <CardHeader>
                <CardTitle>Next Milestones</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span>Complete 50 transactions</span>
                      <span className="text-gray-600">45/50</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: "90%" }} />
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span>Maintain 30-day streak</span>
                      <span className="text-gray-600">12/30</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: "40%" }} />
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span>Reach expert verification</span>
                      <span className="text-gray-600">3/5 steps</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: "60%" }} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="safety" className="space-y-6 mt-6">
            <SafetyTips />
            
            {/* Verification Status */}
            <Card>
              <CardHeader>
                <CardTitle>Verification Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                        <Star className="w-4 h-4 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium">Identity Verified</p>
                        <p className="text-sm text-gray-600">Government ID confirmed</p>
                      </div>
                    </div>
                    <VerificationBadge level="trusted" size="sm" />
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                        <Target className="w-4 h-4 text-gray-600" />
                      </div>
                      <div>
                        <p className="font-medium">Address Verification</p>
                        <p className="text-sm text-gray-600">Pending verification</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm">Verify</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}