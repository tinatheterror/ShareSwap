import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LocationAlerts } from "@/components/location-alerts";
import { Recommendations } from "@/components/recommendations";
import { SeasonalRecommendations } from "@/components/seasonal-recommendations";
import { useAuth } from "@/hooks/use-auth";
import { User, Settings, Bell, Sparkles } from "lucide-react";

export default function ProfilePage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 py-8">
          <div className="text-center">
            <p>Please log in to view your profile.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <User className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">My Profile</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - User Info & Alerts */}
          <div className="lg:col-span-1 space-y-6">
            {/* User Info Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Account Info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Username</label>
                  <p className="font-semibold">{user.username}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">ShareCoins Balance</label>
                  <p className="text-2xl font-bold text-primary">
                    {Number(user.shareCoins).toFixed(2)}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Reputation Level</label>
                  <p className="font-semibold">{user.reputationLevel}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Reputation Score</label>
                  <p className="font-semibold">{user.reputationScore} points</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Verification Status</label>
                  <p className={`font-semibold ${user.isVerified ? 'text-green-600' : 'text-orange-600'}`}>
                    {user.isVerified ? 'Verified' : 'Pending Verification'}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Location Alerts */}
            <LocationAlerts />
          </div>

          {/* Right Column - Recommendations */}
          <div className="lg:col-span-2 space-y-8">
            {/* Personal Recommendations */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-yellow-500" />
                  Your Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Recommendations limit={8} showTitle={false} />
              </CardContent>
            </Card>

            {/* Seasonal Picks */}
            <Card>
              <CardHeader>
                <CardTitle>Seasonal Highlights</CardTitle>
              </CardHeader>
              <CardContent>
                <SeasonalRecommendations limit={8} />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}