import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  User, 
  Mail, 
  MapPin, 
  Phone, 
  Calendar, 
  Star, 
  Coins, 
  Package, 
  Heart,
  Bell,
  Settings,
  Shield,
  CreditCard,
  Award,
  TrendingUp,
  Edit3,
  Save,
  X
} from "lucide-react";
import { useState } from "react";

interface UserProfile {
  id: number;
  username: string;
  email?: string;
  fullName?: string;
  bio?: string;
  location?: string;
  phone?: string;
  joinedDate: string;
  shareCoins: number;
  itemsShared: number;
  itemsBorrowed: number;
  rating: number;
  totalTransactions: number;
  isVerified: boolean;
  subscription?: string;
}

interface LocationAlert {
  id: number;
  keyword: string;
  location: string;
  isActive: boolean;
}

export default function ProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    fullName: '',
    bio: '',
    location: '',
    phone: ''
  });

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ['/api/user-profile'],
    enabled: !!user,
  });

  const { data: locationAlerts } = useQuery<LocationAlert[]>({
    queryKey: ['/api/location-alerts'],
    enabled: !!user,
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/user-profile', 'PATCH', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user-profile'] });
      setIsEditing(false);
      toast({
        title: "Profile updated",
        description: "Your profile information has been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleEditProfile = () => {
    if (profile) {
      setEditForm({
        fullName: profile.fullName || '',
        bio: profile.bio || '',
        location: profile.location || '',
        phone: profile.phone || ''
      });
      setIsEditing(true);
    }
  };

  const handleSaveProfile = () => {
    updateProfileMutation.mutate(editForm);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditForm({
      fullName: '',
      bio: '',
      location: '',
      phone: ''
    });
  };

  if (!user) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-800 mb-4">Please log in to view your profile</h1>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Profile Information */}
          <div className="lg:col-span-2 space-y-6">
            {/* Main Profile Card */}
            <Card className="border-2 border-teal-100">
              <CardHeader className="bg-gradient-to-r from-teal-50 to-slate-50">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-teal-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                      {profile?.fullName ? profile.fullName.charAt(0).toUpperCase() : user.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <CardTitle className="text-2xl text-slate-800">
                          {profile?.fullName || user.username}
                        </CardTitle>
                        {profile?.isVerified && (
                          <Badge className="bg-teal-100 text-teal-800">
                            <Shield className="h-3 w-3 mr-1" />
                            Verified
                          </Badge>
                        )}
                      </div>
                      <p className="text-slate-600">@{user.username}</p>
                      {profile?.subscription && (
                        <Badge variant="secondary" className="mt-1">
                          {profile.subscription}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={isEditing ? handleCancelEdit : handleEditProfile}
                    disabled={updateProfileMutation.isPending}
                  >
                    {isEditing ? (
                      <>
                        <X className="h-4 w-4 mr-2" />
                        Cancel
                      </>
                    ) : (
                      <>
                        <Edit3 className="h-4 w-4 mr-2" />
                        Edit Profile
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {isEditing ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Full Name</label>
                      <Input
                        value={editForm.fullName}
                        onChange={(e) => setEditForm({...editForm, fullName: e.target.value})}
                        placeholder="Enter your full name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Bio</label>
                      <Textarea
                        value={editForm.bio}
                        onChange={(e) => setEditForm({...editForm, bio: e.target.value})}
                        placeholder="Tell us about yourself..."
                        rows={3}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Location</label>
                      <Input
                        value={editForm.location}
                        onChange={(e) => setEditForm({...editForm, location: e.target.value})}
                        placeholder="Your city or neighborhood"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Phone</label>
                      <Input
                        value={editForm.phone}
                        onChange={(e) => setEditForm({...editForm, phone: e.target.value})}
                        placeholder="Your phone number"
                      />
                    </div>
                    <div className="flex gap-3 pt-4">
                      <Button 
                        onClick={handleSaveProfile}
                        disabled={updateProfileMutation.isPending}
                        className="bg-teal-600 hover:bg-teal-700"
                      >
                        <Save className="h-4 w-4 mr-2" />
                        {updateProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={handleCancelEdit}
                        disabled={updateProfileMutation.isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {profile?.bio && (
                      <div>
                        <h4 className="font-medium text-slate-800 mb-2">About</h4>
                        <p className="text-slate-600 leading-relaxed">{profile.bio}</p>
                      </div>
                    )}
                    
                    <div className="grid md:grid-cols-2 gap-4">
                      {profile?.email && (
                        <div className="flex items-center gap-3">
                          <Mail className="h-4 w-4 text-slate-500" />
                          <span className="text-slate-600">{profile.email}</span>
                        </div>
                      )}
                      {profile?.location && (
                        <div className="flex items-center gap-3">
                          <MapPin className="h-4 w-4 text-slate-500" />
                          <span className="text-slate-600">{profile.location}</span>
                        </div>
                      )}
                      {profile?.phone && (
                        <div className="flex items-center gap-3">
                          <Phone className="h-4 w-4 text-slate-500" />
                          <span className="text-slate-600">{profile.phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <Calendar className="h-4 w-4 text-slate-500" />
                        <span className="text-slate-600">
                          Joined {profile?.joinedDate ? new Date(profile.joinedDate).toLocaleDateString() : 'Recently'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Account Statistics - Gamified */}
            <Card className="border-2 border-gradient-to-r from-teal-200 to-teal-300 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-teal-50 via-teal-100 to-teal-50">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <div className="w-8 h-8 bg-gradient-to-r from-teal-500 to-teal-600 rounded-full flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-white" />
                  </div>
                  <span className="bg-gradient-to-r from-teal-600 to-teal-700 bg-clip-text text-transparent">
                    Account Statistics
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid md:grid-cols-4 gap-6">
                  {/* ShareCoins - Light Teal Theme */}
                  <div className="text-center group hover:scale-105 transition-transform duration-300">
                    <div className="relative">
                      <div className="w-16 h-16 bg-gradient-to-r from-teal-300 to-teal-400 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg group-hover:shadow-xl transition-shadow duration-300">
                        <Coins className="h-8 w-8 text-white drop-shadow-sm" />
                      </div>
                    </div>
                    <div className="font-bold text-3xl bg-gradient-to-r from-teal-600 to-teal-700 bg-clip-text text-transparent mb-1">
                      {profile?.shareCoins || 0}
                    </div>
                    <div className="text-sm font-medium text-teal-700 bg-teal-50 px-2 py-1 rounded-full">
                      ShareCoins
                    </div>
                    <div className="mt-2 w-full bg-teal-100 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-teal-300 to-teal-400 h-2 rounded-full transition-all duration-1000"
                        style={{ width: `${Math.min((profile?.shareCoins || 0) / 100 * 100, 100)}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Items Shared - Medium Teal Theme */}
                  <div className="text-center group hover:scale-105 transition-transform duration-300">
                    <div className="relative">
                      <div className="w-16 h-16 bg-gradient-to-r from-teal-400 to-teal-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg group-hover:shadow-xl transition-shadow duration-300">
                        <Package className="h-8 w-8 text-white drop-shadow-sm" />
                      </div>
                    </div>
                    <div className="font-bold text-3xl bg-gradient-to-r from-teal-700 to-teal-800 bg-clip-text text-transparent mb-1">
                      {profile?.itemsShared || 0}
                    </div>
                    <div className="text-sm font-medium text-teal-700 bg-teal-50 px-2 py-1 rounded-full">
                      Items Shared
                    </div>
                    <div className="mt-2 w-full bg-teal-100 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-teal-400 to-teal-500 h-2 rounded-full transition-all duration-1000"
                        style={{ width: `${Math.min((profile?.itemsShared || 0) / 20 * 100, 100)}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Items Borrowed - Dark Teal Theme */}
                  <div className="text-center group hover:scale-105 transition-transform duration-300">
                    <div className="relative">
                      <div className="w-16 h-16 bg-gradient-to-r from-teal-500 to-teal-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg group-hover:shadow-xl transition-shadow duration-300">
                        <Heart className="h-8 w-8 text-white drop-shadow-sm" />
                      </div>
                    </div>
                    <div className="font-bold text-3xl bg-gradient-to-r from-teal-700 to-teal-800 bg-clip-text text-transparent mb-1">
                      {profile?.itemsBorrowed || 0}
                    </div>
                    <div className="text-sm font-medium text-teal-700 bg-teal-50 px-2 py-1 rounded-full">
                      Items Borrowed
                    </div>
                    <div className="mt-2 w-full bg-teal-100 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-teal-500 to-teal-600 h-2 rounded-full transition-all duration-1000"
                        style={{ width: `${Math.min((profile?.itemsBorrowed || 0) / 15 * 100, 100)}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Rating - Darker Teal Theme */}
                  <div className="text-center group hover:scale-105 transition-transform duration-300">
                    <div className="relative">
                      <div className="w-16 h-16 bg-gradient-to-r from-teal-600 to-teal-700 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg group-hover:shadow-xl transition-shadow duration-300">
                        <Star className="h-8 w-8 text-white drop-shadow-sm fill-current" />
                      </div>
                    </div>
                    <div className="font-bold text-3xl bg-gradient-to-r from-teal-700 to-teal-800 bg-clip-text text-transparent mb-1">
                      {profile?.rating || 0}
                    </div>
                    <div className="text-sm font-medium text-teal-700 bg-teal-50 px-2 py-1 rounded-full">
                      Rating
                    </div>
                    <div className="mt-2 w-full bg-teal-100 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-teal-600 to-teal-700 h-2 rounded-full transition-all duration-1000"
                        style={{ width: `${Math.min((profile?.rating || 0) / 5 * 100, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>

                {/* Community Impact Level */}
                <div className="mt-8 p-4 bg-gradient-to-r from-teal-50 to-teal-100 rounded-xl border border-teal-100">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-medium text-teal-700">Community Impact Level</span>
                      <div className="text-xs text-teal-600 mt-1">
                        {(() => {
                          const totalImpact = (profile?.itemsShared || 0) + (profile?.itemsBorrowed || 0);
                          const level = Math.floor(totalImpact / 5) + 1;
                          const levelNames = [
                            "New Neighbor", "Helpful Friend", "Community Helper", 
                            "Sharing Champion", "Local Legend", "Neighborhood Hero"
                          ];
                          return levelNames[Math.min(level - 1, levelNames.length - 1)] || "Sharing Master";
                        })()}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold text-teal-600">
                        Level {Math.floor(((profile?.itemsShared || 0) + (profile?.itemsBorrowed || 0)) / 5) + 1}
                      </span>
                      <div className="text-xs text-teal-600">
                        {((profile?.itemsShared || 0) + (profile?.itemsBorrowed || 0)) % 5}/5 interactions
                      </div>
                    </div>
                  </div>
                  <div className="w-full bg-teal-200 rounded-full h-3">
                    <div 
                      className="bg-gradient-to-r from-teal-500 to-teal-600 h-3 rounded-full transition-all duration-1000 relative overflow-hidden"
                      style={{ width: `${(((profile?.itemsShared || 0) + (profile?.itemsBorrowed || 0)) % 5) / 5 * 100}%` }}
                    >
                      <div className="absolute inset-0 bg-white opacity-30 animate-pulse"></div>
                    </div>
                  </div>
                  <div className="text-xs text-teal-600 mt-2">
                    <div className="font-medium mb-1">Level Benefits:</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>• Higher trust score</div>
                      <div>• Priority in requests</div>
                      <div>• Exclusive items access</div>
                      <div>• Reduced platform fees</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="outline" className="w-full justify-start">
                  <Settings className="h-4 w-4 mr-2" />
                  Account Settings
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Bell className="h-4 w-4 mr-2" />
                  Notifications
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <CreditCard className="h-4 w-4 mr-2" />
                  Payment Methods
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Shield className="h-4 w-4 mr-2" />
                  Verification Status
                </Button>
              </CardContent>
            </Card>

            {/* Recent Achievements */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-teal-600" />
                  Recent Achievements
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-2 bg-teal-50 rounded-lg">
                    <div className="w-8 h-8 bg-teal-500 rounded-full flex items-center justify-center">
                      <Star className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">Community Helper</div>
                      <div className="text-xs text-slate-600">Helped 5 neighbors</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-2 bg-teal-50 rounded-lg">
                    <div className="w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center">
                      <Package className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">Generous Sharer</div>
                      <div className="text-xs text-slate-600">Shared 10 items</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Location Alerts */}
            {locationAlerts && locationAlerts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-teal-600" />
                    Location Alerts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {locationAlerts.slice(0, 3).map((alert) => (
                      <div key={alert.id} className="flex items-center justify-between p-2 bg-teal-50 rounded">
                        <div>
                          <div className="font-medium text-sm">{alert.keyword}</div>
                          <div className="text-xs text-slate-600">{alert.location}</div>
                        </div>
                        <Badge variant={alert.isActive ? "default" : "secondary"}>
                          {alert.isActive ? "Active" : "Paused"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}