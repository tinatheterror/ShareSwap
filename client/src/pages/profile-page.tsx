import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useState, useRef, useCallback, useEffect } from "react";
import ReactCrop, {
  type Crop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  User,
  Mail,
  MapPin,
  Calendar,
  Star,
  Coins,
  Package,
  Heart,
  HandHeart,
  Bell,
  Settings,
  Shield,
  BadgeCheck,
  CreditCard,
  Award,
  TrendingUp,
  Edit3,
  Save,
  X,
  BookOpen,
  Camera,
  DollarSign,
  ArrowLeftRight,
  Crown,
  Zap,
  Gift,
  Check,
  Headphones,
  Percent,
  UserCheck,
  Wallet,
  Clock,
  MessageSquare,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
} from "lucide-react";
import { UserBadges } from "@/components/user-badges";
import { useLocation, Link } from "wouter";
import type { SelectItem } from "@db/schema";

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
  completedShares: number;
  itemsBorrowed: number;
  rating: number;
  totalTransactions: number;
  isVerified: boolean;
  subscription?: string;
  activeStatus?: string | null;
  responseTime?: string | null;
}

interface LocationAlert {
  id: number;
  keyword: string;
  location: string;
  isActive: boolean;
}

const LEVELS = [
  { name: "Newcomer", minScore: 0 },
  { name: "Neighbour", minScore: 50 },
  { name: "Trusted Member", minScore: 150 },
  { name: "Community Pillar", minScore: 300 },
  { name: "ShareSwap Champion", minScore: 500 },
];

export default function ProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const [expandedReviewers, setExpandedReviewers] = useState<Set<number>>(new Set());
  const toggleReviewer = (reviewerId: number) =>
    setExpandedReviewers(prev => {
      const next = new Set(prev);
      next.has(reviewerId) ? next.delete(reviewerId) : next.add(reviewerId);
      return next;
    });

  // Group flat review list by reviewer, sorted by most-recent unique reviewer first
  const groupReviews = (reviews: any[]) => {
    const map = new Map<number, { reviewer: any; reviews: any[]; avgRating: number; latestDate: string }>();
    for (const r of reviews) {
      const id = r.reviewer.id;
      if (!map.has(id)) map.set(id, { reviewer: r.reviewer, reviews: [], avgRating: 0, latestDate: r.createdAt });
      const g = map.get(id)!;
      g.reviews.push(r);
      if (new Date(r.createdAt) > new Date(g.latestDate)) g.latestDate = r.createdAt;
    }
    for (const g of map.values()) {
      g.avgRating = g.reviews.reduce((s, r) => s + r.rating, 0) / g.reviews.length;
    }
    return [...map.values()].sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());
  };

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    fullName: "",
    bio: "",
    location: "",
    phone: "",
    displayName: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Crop state
  const [showCropDialog, setShowCropDialog] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [originalFile, setOriginalFile] = useState<File | null>(null);

  const [, navigate] = useLocation();

  // Auto-enter edit mode when redirected from public profile with ?edit=true
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("edit=true")) {
      setIsEditing(true);
      window.history.replaceState(null, "", "/profile");
    }
  }, []);

  // Extract username/handle from URL path
  const pathParts = location.split("/");
  const usernameFromUrl = pathParts[2]; // /profile/:username or /profile/:handle
  const isOwnProfile = !usernameFromUrl;
  const isViewingOwnPublicProfile =
    !!usernameFromUrl &&
    !!user &&
    (usernameFromUrl === user.username ||
      usernameFromUrl === (user as any).handle);

  // Fetch user profile by username if viewing another user's profile
  const { data: publicProfile, isLoading: isLoadingPublicProfile } =
    useQuery<any>({
      queryKey: [`/api/users/username/${usernameFromUrl}`],
      enabled: !!usernameFromUrl && !isOwnProfile,
    });

  // Fetch user's items if viewing another user's profile
  const { data: userItems = [] } = useQuery<SelectItem[]>({
    queryKey: [`/api/users/username/${usernameFromUrl}/items`],
    enabled: !!usernameFromUrl && !isOwnProfile,
  });

  // Fetch reviews — for another user's profile use the URL username,
  // for own profile use the logged-in user's username.
  const { data: userReviews = [] } = useQuery<any[]>({
    queryKey: [`/api/users/username/${usernameFromUrl}/reviews`],
    enabled: !!usernameFromUrl && !isOwnProfile,
  });

  const { data: ownReviews = [] } = useQuery<any[]>({
    queryKey: [`/api/users/username/${user?.username}/reviews`],
    enabled: !!isOwnProfile && !!user?.username,
  });

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/user-profile"],
    enabled: !!isOwnProfile || !!isViewingOwnPublicProfile,
  });

  const { data: locationAlerts = [] } = useQuery<LocationAlert[]>({
    queryKey: ["/api/location-alerts"],
    enabled: !!isOwnProfile,
  });

  // Pre-populate editForm when entering edit mode from own public profile view
  useEffect(() => {
    if (isEditing && isViewingOwnPublicProfile && publicProfile) {
      setEditForm({
        fullName: (publicProfile as any).fullName || "",
        bio: (publicProfile as any).bio || "",
        location: (publicProfile as any).location || "",
        phone: (publicProfile as any).phone || "",
        displayName: (publicProfile as any).displayName || "",
      });
    }
  }, [isEditing, isViewingOwnPublicProfile]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", "/api/user-profile", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      if (usernameFromUrl) {
        queryClient.invalidateQueries({ queryKey: [`/api/users/username/${usernameFromUrl}`] });
      }
      setIsEditing(false);
      toast({
        title: "Profile updated",
        description: "Your profile information has been saved successfully.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  const profilePhotoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("profilePhoto", file);

      const csrfToken = document.cookie
        .split("; ")
        .find((row) => row.startsWith("x-csrf-token="))
        ?.split("=")[1];

      const res = await fetch("/api/users/profile-photo", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to upload photo");
      }

      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-profile"] });

      if (data.shareCoinsAwarded > 0) {
        toast({
          title: "Photo Approved!",
          description: "You earned 1 ShareCoin for adding a profile photo!",
        });
      } else if (data.validationStatus === "rejected") {
        toast({
          title: "Photo Saved",
          description:
            data.validationReason || "Try another photo to earn 1 ShareCoin.",
        });
      } else {
        toast({
          title: "Photo Updated!",
          description: "Your profile photo has been updated.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload profile photo",
        variant: "destructive",
      });
    },
  });

  // Scroll to verification-status section if hash is present
  useEffect(() => {
    if (window.location.hash === "#verification-status") {
      setTimeout(() => {
        const element = document.getElementById("verification-status");
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 300);
    }
  }, [profile]);

  // Initialize crop when image loads
  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { width, height } = e.currentTarget;
      const cropInit = centerCrop(
        makeAspectCrop({ unit: "%", width: 80 }, 1, width, height),
        width,
        height,
      );
      setCrop(cropInit);
    },
    [],
  );

  // Convert cropped image to file
  const getCroppedImage = useCallback(async (): Promise<File | null> => {
    if (!imgRef.current || !crop) return null;

    const image = imgRef.current;
    const canvas = document.createElement("canvas");
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    const pixelCrop = {
      x: (crop.x / 100) * image.width * scaleX,
      y: (crop.y / 100) * image.height * scaleY,
      width: (crop.width / 100) * image.width * scaleX,
      height: (crop.height / 100) * image.height * scaleY,
    };

    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;
    const ctx = canvas.getContext("2d");

    if (!ctx) return null;

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height,
    );

    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const file = new File([blob], originalFile?.name || "profile.jpg", {
              type: "image/jpeg",
            });
            resolve(file);
          } else {
            resolve(null);
          }
        },
        "image/jpeg",
        0.9,
      );
    });
  }, [crop, originalFile]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Please select an image under 10MB",
          variant: "destructive",
        });
        return;
      }
      // Show crop dialog instead of uploading directly
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string);
        setOriginalFile(file);
        setShowCropDialog(true);
      };
      reader.readAsDataURL(file);
    }
    // Reset file input
    if (e.target) e.target.value = "";
  };

  const handleCropConfirm = async () => {
    const croppedFile = await getCroppedImage();
    if (croppedFile) {
      profilePhotoMutation.mutate(croppedFile);
    }
    setShowCropDialog(false);
    setImageSrc(null);
    setCrop(undefined);
  };

  const handleCropCancel = () => {
    setShowCropDialog(false);
    setImageSrc(null);
    setCrop(undefined);
  };

  const handleEditProfile = () => {
    if (profile) {
      setEditForm({
        fullName: profile.fullName || "",
        bio: profile.bio || "",
        location:
          profile.location ||
          user?.defaultCity ||
          user?.defaultPostalCode ||
          "",
        phone: profile.phone || "",
        displayName: (user as any)?.displayName || "",
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
      fullName: "",
      bio: "",
      location: "",
      phone: "",
      displayName: "",
    });
  };

  // Calculate current level based on reputation score
  const reputationScore = user?.reputationScore || 0;
  const currentLevelIndex = LEVELS.findIndex((level, index) => {
    const nextLevel = LEVELS[index + 1];
    return !nextLevel || reputationScore < nextLevel.minScore;
  });
  const currentLevel = LEVELS[Math.max(0, currentLevelIndex)];

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-800 mb-4">
              Please log in to view profiles
            </h1>
          </div>
        </main>
      </div>
    );
  }

  // Show public profile if viewing another user
  if (!isOwnProfile) {
    if (isLoadingPublicProfile) {
      return (
        <div className="min-h-screen bg-[#F3F4F6]">
          <Navbar />
          <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center">
              <p className="text-lg text-muted-foreground">
                Loading profile...
              </p>
            </div>
          </main>
        </div>
      );
    }

    if (!publicProfile) {
      return (
        <div className="min-h-screen bg-[#F3F4F6]">
          <Navbar />
          <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-slate-800 mb-4">
                User not found
              </h1>
              <p className="text-muted-foreground">
                The user @{usernameFromUrl} does not exist.
              </p>
            </div>
          </main>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-[#F3F4F6] overflow-x-hidden">
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 overflow-x-hidden">
          <Card className="mb-6" style={{ backgroundColor: "#D4F7F1" }}>
            <CardHeader className="bg-transparent relative">
              {isEditing && isViewingOwnPublicProfile ? (
                <div className="space-y-4 py-1">
                  {/* Photo upload */}
                  <div>
                    <label className="block text-sm font-medium mb-2">Profile Photo</label>
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <Avatar className="h-16 w-16 border-2 border-gray-200">
                          <AvatarImage src={(user as any)?.profilePhoto} alt={(user as any).displayName || user?.username} />
                          <AvatarFallback className="bg-teal-100 text-teal-600 text-xl font-medium">
                            {((user as any).displayName || (user as any).handle || user?.username)?.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="absolute -bottom-1 -right-1 p-1.5 bg-teal-500 rounded-full text-white hover:bg-teal-600 transition-colors shadow-md" disabled={profilePhotoMutation.isPending}>
                          <Camera className="h-3.5 w-3.5" />
                        </button>
                        <input ref={fileInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/gif,image/webp" onChange={handlePhotoUpload} className="hidden" />
                      </div>
                      <div className="text-sm text-gray-500">
                        {profilePhotoMutation.isPending ? "Uploading..." : (user as any)?.profilePhoto ? "Click camera to change" : "Add a photo"}
                        {!(user as any)?.hasUploadedProfilePhoto && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                            <Coins className="h-3 w-3" />
                            <span>Earn 1 ShareCoin</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Display Name */}
                  <div>
                    <label className="block text-sm font-medium mb-2">Display Name</label>
                    <Input value={editForm.displayName} onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })} placeholder="e.g. Sarah M." maxLength={40} />
                  </div>
                  {/* Bio */}
                  <div>
                    <label className="block text-sm font-medium mb-2">Bio</label>
                    <Textarea value={editForm.bio} onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })} placeholder="Tell us about yourself..." rows={3} />
                  </div>
                  {/* Location */}
                  <div>
                    <label className="block text-sm font-medium mb-2">Location</label>
                    <Input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} placeholder="Your city (e.g. Toronto)" />
                  </div>
                  {/* Buttons */}
                  <div className="flex gap-3 pt-2">
                    <Button onClick={handleSaveProfile} disabled={updateProfileMutation.isPending} style={{ backgroundColor: "#0DCEA1" }}>
                      <Save className="h-4 w-4 mr-2" />
                      {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                    <Button variant="outline" onClick={handleCancelEdit} disabled={updateProfileMutation.isPending}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
              <>
              {/* Edit Profile button — top-left corner */}
              {isViewingOwnPublicProfile && (
                <div className="absolute top-3 left-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                    className="justify-start bg-white hover:bg-gray-50 h-7 text-xs px-2"
                  >
                    <Edit3 className="h-3 w-3 mr-1" />
                    Edit Profile
                  </Button>
                </div>
              )}

              <div className={`flex items-start gap-4 ${isViewingOwnPublicProfile ? "mt-7" : ""}`}>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div className="w-20 h-20 rounded-full overflow-hidden">
                    {(publicProfile as any).profilePhoto ? (
                      <img
                        src={(publicProfile as any).profilePhoto}
                        alt={
                          (publicProfile as any).handle || publicProfile.username
                        }
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-teal-600 flex items-center justify-center text-white text-3xl font-bold">
                        {(
                          (publicProfile as any).displayName ||
                          (publicProfile as any).handle ||
                          publicProfile.username
                        )
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                    )}
                  </div>
                  {isViewingOwnPublicProfile && !(publicProfile as any).profilePhoto && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="flex items-center gap-0.5 text-[10px] text-amber-600 font-medium whitespace-nowrap hover:text-amber-700"
                    >
                      <span>+1</span>
                      <Coins className="h-2.5 w-2.5 text-amber-500" />
                      <span>· Add photo</span>
                    </button>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <CardTitle className="text-2xl text-slate-800">
                      {(publicProfile as any).displayName ||
                        (publicProfile as any).handle ||
                        publicProfile.username.split("@")[0]}
                    </CardTitle>
                    <UserBadges
                      isVerified={publicProfile.isVerified}
                      reputationLevel={publicProfile.reputationLevel}
                      size="md"
                      showLabels
                    />
                  </div>
                  <p className="text-slate-500 text-sm mb-0.5">
                    @
                    {(publicProfile as any).handle ||
                      publicProfile.username.split("@")[0]}
                  </p>
                  {(publicProfile as any).activeStatus && (
                    <p className="text-[10px] text-slate-400 mb-0.5">
                      {(publicProfile as any).activeStatus}
                    </p>
                  )}
                  {(publicProfile as any).responseTime && (
                    <p className="text-[10px] text-slate-400 mb-2">
                      {(publicProfile as any).responseTime}
                    </p>
                  )}
                </div>
              </div>

              {/* Reviews + shares — full-width, centered in the banner */}
              <div className="flex items-center justify-center gap-6 mt-5 mb-5 text-sm text-muted-foreground">
                <div className="flex items-start gap-1.5">
                  <Star className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-px" />
                  <span>
                    {publicProfile.averageRating.toFixed(1)} (
                    {publicProfile.reviewCount} reviews)
                  </span>
                </div>
                <div className="flex items-start gap-1.5">
                  <Package className="h-5 w-5 text-slate-500 flex-shrink-0 mt-px" />
                  <span>
                    {(publicProfile as any).completedShares ?? 0} completed
                    shares
                  </span>
                </div>
              </div>

              {/* Trust stats — full-width row below avatar+info, left-aligned */}
              <div className="mt-5 space-y-1 text-xxs text-slate-500">
                {(publicProfile as any).onTimeReturnRate != null && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-teal-500 flex-shrink-0" />
                    <span>
                      {(publicProfile as any).onTimeReturnRate}% on-time returns
                    </span>
                  </div>
                )}
                {(publicProfile as any).replyRate != null && (
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-teal-500 flex-shrink-0" />
                    <span>
                      {(publicProfile as any).replyRate}% of the time replies
                    </span>
                  </div>
                )}
                <div className="mt-2 space-y-0.5 text-[10px] text-slate-400">
                  <div className="flex items-center gap-1">
                    <AlertTriangle
                      className={`h-3 w-3 flex-shrink-0 ${((publicProfile as any).issuesCount ?? 0) === 0 ? "text-green-400" : "text-amber-400"}`}
                    />
                    <span>
                      {(() => {
                        const n = (publicProfile as any).issuesCount ?? 0;
                        return n === 0
                          ? "No issues reported"
                          : `${n} issue${n !== 1 ? "s" : ""} reported`;
                      })()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Shield className="h-3 w-3 text-teal-400 flex-shrink-0" />
                    <span>Trust Score: {(publicProfile as any).trustScore ?? 0}</span>
                  </div>
                  {(publicProfile as any).createdAt && (
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 flex-shrink-0" />
                      <span>
                        Member since{" "}
                        {new Date((publicProfile as any).createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              </>
              )}
            </CardHeader>
          </Card>

          {/* Shared Items */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-4">Shared Items</h2>
            {userItems.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto pb-3 -mx-4 px-4 snap-x snap-mandatory scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] md:grid md:grid-cols-3 md:gap-6 md:overflow-x-visible md:pb-0 md:mx-0 md:px-0 md:snap-none">
                {userItems.map((item) => (
                  <div key={item.id} className="w-[78vw] flex-shrink-0 snap-start md:w-auto h-full">
                    <Card className={`hover:shadow-lg transition-shadow bg-white rounded-xl overflow-hidden h-full flex flex-col ${item.isGift ? "border-pink-100" : ""}`}>
                      {/* Mobile: horizontal compact layout | Desktop: vertical layout */}
                      <div className="flex md:flex-col h-full">
                        {/* Image */}
                        <div className="p-1.5 flex-shrink-0 md:p-2 md:w-full">
                          <div
                            className={`w-[72px] h-[72px] md:w-full rounded-lg flex items-center justify-center overflow-hidden relative flex-shrink-0 ${item.isGift ? "bg-pink-50" : "bg-gray-100"}`}
                            style={{ aspectRatio: undefined }}
                          >
                            <div className="hidden md:block absolute inset-0" style={{ paddingBottom: "90%" }} />
                            {item.isGift && (
                              <Badge className="absolute top-1 right-1 bg-pink-500 text-white text-[9px] px-1 py-0 md:top-2 md:right-2 md:text-[10px]">
                                FREE
                              </Badge>
                            )}
                            {item.photos && item.photos[0] ? (
                              <img
                                src={item.photos[0]}
                                alt={item.name}
                                className="w-full h-full object-cover rounded-lg"
                              />
                            ) : (
                              <div className={`w-full h-full flex items-center justify-center rounded-lg ${item.isGift ? "bg-pink-100" : "bg-gray-200"}`}>
                                {item.isGift
                                  ? <Gift className="h-6 w-6 text-pink-400 md:h-10 md:w-10" />
                                  : <Camera className="h-6 w-6 text-gray-400 md:h-10 md:w-10" />
                                }
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Content */}
                        <div className="flex flex-col flex-1 px-2 py-1.5 min-w-0 md:px-3 md:pt-0 md:pb-2">
                          <h3 className="font-bold text-[11px] md:text-sm leading-tight mb-0.5 truncate text-slate-800">
                            {item.name}
                          </h3>
                          <div className="flex-1 space-y-0.5 mb-1">
                            <p className="text-[10px] md:text-xs text-slate-600 leading-tight">
                              Cond: {item.conditionRating}/10
                            </p>
                            {!item.isGift && (item.isLendable || item.isRentable) && (
                              <div className="flex items-center gap-0.5 text-[10px] md:text-xs text-slate-700 flex-wrap">
                                <Coins className="h-2.5 w-2.5 text-teal-600 flex-shrink-0" />
                                <span className="leading-tight">
                                  {Math.round(Number(item.shareCoinPrice || item.shareCoinsReward || 5))} SC
                                </span>
                                {item.isRentable && (
                                  <>
                                    <span className="text-slate-400">·</span>
                                    <span className="leading-tight">${Number(item.dollarsPrice || 10).toFixed(0)}/wk</span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1 flex-wrap">
                            {item.isGift ? (
                              <Button
                                size="sm"
                                className="bg-pink-500 hover:bg-pink-600 text-white rounded-md text-[9px] h-5 px-1.5 whitespace-nowrap md:w-full md:h-6 md:text-[10px] md:rounded-lg"
                                onClick={() => navigate(`/items/${item.id}`)}
                              >
                                <Gift className="h-2 w-2 mr-0.5" />
                                Claim
                              </Button>
                            ) : (
                              <>
                                {item.isLendable && (
                                  <Button
                                    size="sm"
                                    className="text-white rounded-md text-[9px] px-1.5 h-5 whitespace-nowrap md:h-6 md:text-[10px] md:rounded-lg"
                                    style={{ backgroundColor: "#0DCEA1" }}
                                    onClick={() => navigate(`/items/${item.id}`)}
                                  >
                                    <HandHeart className="h-2 w-2 mr-0.5" />
                                    Borrow
                                  </Button>
                                )}
                                {item.isRentable && (
                                  <Button
                                    size="sm"
                                    className="text-white rounded-md text-[9px] px-1.5 h-5 whitespace-nowrap md:h-6 md:text-[10px] md:rounded-lg"
                                    style={{ backgroundColor: "#0DCEA1" }}
                                    onClick={() => navigate(`/items/${item.id}`)}
                                  >
                                    <DollarSign className="h-2 w-2 mr-0.5" />
                                    Rent
                                  </Button>
                                )}
                                {item.isSwappable && (
                                  <Button
                                    size="sm"
                                    className="text-white rounded-md text-[9px] px-1.5 h-5 whitespace-nowrap md:h-6 md:text-[10px] md:rounded-lg"
                                    style={{ backgroundColor: "#0DCEA1" }}
                                    onClick={() => navigate(`/items/${item.id}`)}
                                  >
                                    <ArrowLeftRight className="h-2 w-2 mr-0.5" />
                                    Swap
                                  </Button>
                                )}
                                {!item.isLendable && !item.isRentable && !item.isSwappable && (
                                  <Button
                                    size="sm"
                                    className="text-white rounded-md text-[9px] px-1.5 h-5 whitespace-nowrap md:h-6 md:text-[10px] md:rounded-lg"
                                    style={{ backgroundColor: "#0DCEA1" }}
                                    onClick={() => navigate(`/items/${item.id}`)}
                                  >
                                    View
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>
                ))}
              </div>
            ) : (
              <Card className="p-6 text-center text-muted-foreground">
                No items shared yet
              </Card>
            )}
          </div>

          {/* Reviews — grouped by reviewer */}
          <div>
            <h2 className="text-2xl font-bold mb-4">Reviews</h2>
            {userReviews.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto pb-3 -mx-4 px-4 snap-x snap-mandatory scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] md:flex-col md:overflow-x-visible md:pb-0 md:mx-0 md:px-0 md:snap-none md:gap-4">
                {groupReviews(userReviews).map((group) => {
                  const isExpanded = expandedReviewers.has(group.reviewer.id);
                  const mostRecent = group.reviews[0];
                  const displayName = group.reviewer.displayName || group.reviewer.handle || group.reviewer.username.split("@")[0];
                  return (
                    <div key={group.reviewer.id} className="w-[85vw] flex-shrink-0 snap-start md:w-auto">
                      <Card className="p-4" style={{ backgroundColor: "#D4F7F1" }}>
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
                            {group.reviewer.profilePhoto ? (
                              <img src={group.reviewer.profilePhoto} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-teal-600 flex items-center justify-center text-white font-bold">
                                {displayName.charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Link href={`/profile/${group.reviewer.handle || group.reviewer.username}`} className="font-medium text-teal-600 hover:text-teal-700 cursor-pointer">
                                {displayName}
                              </Link>
                              <UserBadges isVerified={group.reviewer.isVerified} reputationLevel={group.reviewer.reputationLevel} size="sm" />
                            </div>
                            {/* Summary row */}
                            <div className="flex items-center gap-2 mb-1">
                              <div className="flex items-center gap-0.5">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star key={i} className={`h-3.5 w-3.5 ${i < Math.round(group.avgRating) ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
                                ))}
                              </div>
                              <span className="text-sm font-medium">{group.avgRating.toFixed(1)}</span>
                              <span className="text-xs text-muted-foreground">· {group.reviews.length} transaction{group.reviews.length !== 1 ? "s" : ""}</span>
                            </div>
                            {/* Most recent comment preview */}
                            {mostRecent.comment && !isExpanded && (
                              <p className="text-sm text-muted-foreground italic line-clamp-2">"{mostRecent.comment}"</p>
                            )}
                            {/* Expanded: all individual reviews */}
                            {isExpanded && (
                              <div className="mt-3 space-y-2 border-t border-teal-200 pt-3">
                                {group.reviews.map((r: any) => (
                                  <div key={r.id} className="bg-white/60 rounded-lg p-2.5">
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="flex items-center gap-0.5">
                                        {Array.from({ length: 5 }).map((_, i) => (
                                          <Star key={i} className={`h-3 w-3 ${i < r.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
                                        ))}
                                      </div>
                                      <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    {r.comment && <p className="text-xs text-muted-foreground italic">"{r.comment}"</p>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Expand / collapse toggle */}
                            {group.reviews.length > 1 && (
                              <button
                                onClick={() => toggleReviewer(group.reviewer.id)}
                                className="mt-2 flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium"
                              >
                                {isExpanded ? <><ChevronUp className="h-3 w-3" /> Hide reviews</> : <><ChevronDown className="h-3 w-3" /> View all {group.reviews.length} reviews</>}
                              </button>
                            )}
                          </div>
                        </div>
                      </Card>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Card className="p-6 text-center text-muted-foreground">
                No reviews yet
              </Card>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Show own profile if viewing logged-in user's profile
  return (
    <div className="min-h-screen bg-[#F3F4F6] overflow-x-hidden">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 overflow-x-hidden">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Profile Information */}
          <div className="lg:col-span-2 space-y-6">
            {/* Main Profile Card */}
            <Card className="border-2 border-teal-100 overflow-hidden">
              <Link href={`/profile/${(user as any).handle || user.username}`}>
                <div className="flex items-center gap-3 p-4 bg-[#D4F7F1] hover:bg-[#C0EFE6] cursor-pointer transition-colors">
                  <Avatar className="h-12 w-12 border-2 border-white shadow-md flex-shrink-0">
                    <AvatarImage
                      src={(user as any)?.profilePhoto}
                      alt={(user as any).displayName || (user as any).handle || user.username}
                    />
                    <AvatarFallback className="bg-teal-600 text-white text-xl font-bold">
                      {((user as any).displayName || (user as any).handle || user.username)
                        .charAt(0)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-800 truncate">
                        {(user as any).displayName || (user as any).handle || user.username}
                      </span>
                      <UserBadges isVerified={profile?.isVerified || false} size="sm" />
                    </div>
                    <p className="text-sm text-slate-500 truncate">
                      @{(user as any).handle || user.username.split("@")[0]}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400 flex-shrink-0" />
                </div>
              </Link>
              {(isEditing || profile?.bio || profile?.email || profile?.location) && (
              <CardContent className="p-6">
                {isEditing ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Profile Photo
                      </label>
                      <div className="flex items-center gap-4">
                        <div className="relative">
                          <Avatar className="h-16 w-16 border-2 border-gray-200">
                            <AvatarImage
                              src={(user as any)?.profilePhoto}
                              alt={
                                (user as any).displayName ||
                                (user as any).handle ||
                                user.username
                              }
                            />
                            <AvatarFallback className="bg-teal-100 text-teal-600 text-xl font-medium">
                              {(
                                (user as any).displayName ||
                                (user as any).handle ||
                                user.username
                              )
                                ?.charAt(0)
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="absolute -bottom-1 -right-1 p-1.5 bg-teal-500 rounded-full text-white hover:bg-teal-600 transition-colors shadow-md"
                            disabled={profilePhotoMutation.isPending}
                          >
                            <Camera className="h-3.5 w-3.5" />
                          </button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                            onChange={handlePhotoUpload}
                            className="hidden"
                          />
                        </div>
                        <div className="text-sm text-gray-500">
                          {profilePhotoMutation.isPending
                            ? "Uploading..."
                            : (user as any)?.profilePhoto
                              ? "Click camera to change"
                              : "Add a photo"}
                          {!(user as any)?.hasUploadedProfilePhoto && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                              <Coins className="h-3 w-3" />
                              <span>Earn 1 ShareCoin</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Display Name
                      </label>
                      {(() => {
                        const changedAt = (profile as any)?.displayNameChangedAt;
                        const isLocked = !!changedAt && (Date.now() - new Date(changedAt).getTime()) < 30 * 24 * 60 * 60 * 1000;
                        const nextAllowed = changedAt
                          ? new Date(new Date(changedAt).getTime() + 30 * 24 * 60 * 60 * 1000)
                          : null;
                        return (
                          <>
                            <Input
                              value={editForm.displayName}
                              onChange={(e) =>
                                setEditForm({ ...editForm, displayName: e.target.value })
                              }
                              placeholder="e.g. Sarah M."
                              maxLength={40}
                              disabled={isLocked}
                            />
                            {isLocked && nextAllowed && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Can be changed again on {nextAllowed.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Bio
                      </label>
                      <Textarea
                        value={editForm.bio}
                        onChange={(e) =>
                          setEditForm({ ...editForm, bio: e.target.value })
                        }
                        placeholder="Tell us about yourself..."
                        rows={3}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Location
                      </label>
                      <Input
                        value={editForm.location}
                        onChange={(e) =>
                          setEditForm({ ...editForm, location: e.target.value })
                        }
                        placeholder="Your city (e.g. Toronto)"
                      />
                    </div>
                    <div className="flex gap-3 pt-4">
                      <Button
                        onClick={handleSaveProfile}
                        disabled={updateProfileMutation.isPending}
                        className=""
                        style={{ backgroundColor: "#0DCEA1" }}
                      >
                        <Save className="h-4 w-4 mr-2" />
                        {updateProfileMutation.isPending
                          ? "Saving..."
                          : "Save Changes"}
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
                        <h4 className="font-medium text-slate-800 mb-2">
                          About
                        </h4>
                        <p className="text-slate-600 leading-relaxed">
                          {profile.bio}
                        </p>
                      </div>
                    )}

                    <div className="grid md:grid-cols-2 gap-4">
                      {profile?.email && (
                        <div className="flex items-center gap-3 min-w-0">
                          <Mail className="h-4 w-4 text-slate-500 flex-shrink-0" />
                          <span className="text-slate-600 text-sm truncate">
                            {profile.email}
                          </span>
                        </div>
                      )}
                      {profile?.location && (
                        <div className="flex items-center gap-3 min-w-0">
                          <MapPin className="h-4 w-4 text-slate-500 flex-shrink-0" />
                          <span className="text-slate-600 text-sm truncate">
                            {profile.location}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
              )}
            </Card>

            {/* My Balance + Account Settings — Mobile Only */}
            <div className="lg:hidden flex flex-col gap-2 mt-6">
              <Link href="/my-balance" className="flex-1">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Wallet className="h-4 w-4 mr-2" />
                  My Balance
                </Button>
              </Link>
              <Link href="/settings" className="flex-1">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Settings className="h-4 w-4 mr-2" />
                  Account Settings
                </Button>
              </Link>
            </div>

            {/* Verification Status - Mobile Only (shown above Premium) */}
            <Card
              className={`lg:hidden mt-6 ${
                profile?.isVerified
                  ? "border-green-200 bg-green-50"
                  : "border-orange-200 bg-orange-50"
              }`}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BadgeCheck
                    className={`h-5 w-5 ${profile?.isVerified ? "text-green-600" : "text-orange-600"}`}
                  />
                  Verification Status
                  {!profile?.isVerified && (
                    <Badge
                      variant="outline"
                      className="ml-auto bg-orange-100 text-orange-700 border-orange-300"
                    >
                      Unverified
                    </Badge>
                  )}
                  {profile?.isVerified && (
                    <Badge
                      variant="outline"
                      className="ml-auto bg-green-100 text-green-700 border-green-300"
                    >
                      Verified
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  {(profile as any)?.paymentMethodLast4 ? (
                    <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <X className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                  <Link href="/payment-methods" className="flex-1">
                    <Button
                      variant="outline"
                      className="w-full justify-start bg-white/80 hover:bg-white"
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Payment Methods
                    </Button>
                  </Link>
                </div>
                <div className="flex items-center gap-2">
                  {(profile as any)?.idVerified ? (
                    <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <X className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                  <Link href="/verification" className="flex-1">
                    <Button
                      variant="outline"
                      className="w-full justify-start bg-white/80 hover:bg-white"
                    >
                      <BadgeCheck className="h-4 w-4 mr-2" />
                      Identity Verification
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Upgrade to Premium */}
            <div className="mt-6">
              <div className="text-center mb-3 md:mb-4">
                <h2 className="flex flex-wrap items-center justify-center gap-1.5 md:gap-2 text-base md:text-xl font-bold">
                  <Crown className="h-4 w-4 md:h-6 md:w-6 text-teal-600" />
                  <span>Upgrade to Premium</span>
                </h2>
                <p className="text-xs md:text-sm text-gray-500 mt-1">
                  Get priority access, lower fees, and exclusive features to
                  maximize your sharing experience
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                {/* ShareSwap Premium Card */}
                <div className="relative border border-gray-200 rounded-lg p-3 md:p-4 bg-white">
                  <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-teal-500 text-white text-[10px] md:text-xs px-2 md:px-3">
                    Most Popular
                  </Badge>
                  <div className="text-center pt-2 md:pt-3">
                    <div className="flex items-center justify-center gap-1.5 md:gap-2">
                      <Crown className="h-3.5 w-3.5 md:h-5 md:w-5 text-teal-600" />
                      <span className="font-semibold text-sm md:text-lg">
                        ShareSwap Premium
                      </span>
                    </div>
                    <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                      Unlock priority access, lower fees, and exclusive features
                    </p>
                    <div className="mt-2 md:mt-3">
                      <span className="text-xl md:text-3xl font-bold text-teal-600">
                        $9.99
                      </span>
                      <span className="text-xs md:text-sm text-gray-500">/month</span>
                    </div>
                    <p className="text-[10px] md:text-xs text-teal-600 mt-1">
                      Save $19.89/year with annual billing
                    </p>
                  </div>
                  <div className="mt-3 md:mt-4 space-y-1.5 md:space-y-2 text-xs md:text-sm">
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Zap className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>Priority access to high-demand items</span>
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Gift className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>50% reduction in transaction fees</span>
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Star className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>Early access to new features</span>
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Shield className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>Premium customer support</span>
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Check className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>Advanced search filters</span>
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Check className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>Unlimited wishlist items</span>
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Check className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>Enhanced profile visibility</span>
                    </div>
                  </div>
                  <Link href="/premium">
                    <Button className="w-full mt-3 md:mt-4 h-8 md:h-10 text-xs md:text-sm bg-teal-500 hover:bg-teal-600 text-white">
                      Upgrade to ShareSwap Premium
                    </Button>
                  </Link>
                  <p className="text-[10px] md:text-xs text-center text-gray-500 mt-1.5 md:mt-2">
                    Or pay $99.99 annually (2 months free!)
                  </p>
                </div>

                {/* ShareSwap Pro Card */}
                <div className="border border-gray-200 rounded-lg p-3 md:p-4 bg-white">
                  <div className="text-center pt-2 md:pt-3">
                    <div className="flex items-center justify-center gap-1.5 md:gap-2">
                      <Crown className="h-3.5 w-3.5 md:h-5 md:w-5 text-gray-600" />
                      <span className="font-semibold text-sm md:text-lg">
                        ShareSwap Pro
                      </span>
                    </div>
                    <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                      Perfect for active community members
                    </p>
                    <div className="mt-2 md:mt-3">
                      <span className="text-xl md:text-3xl font-bold text-gray-700">
                        $4.99
                      </span>
                      <span className="text-xs md:text-sm text-gray-500">/month</span>
                    </div>
                    <p className="text-[10px] md:text-xs text-teal-600 mt-1">
                      Save $9.89/year with annual billing
                    </p>
                  </div>
                  <div className="mt-3 md:mt-4 space-y-1.5 md:space-y-2 text-xs md:text-sm">
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Gift className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>25% reduction in transaction fees</span>
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Check className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>Advanced search filters</span>
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Check className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>Up to 20 wishlist items</span>
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Shield className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>Priority customer support</span>
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <Check className="h-3 w-3 md:h-4 md:w-4 text-teal-600 flex-shrink-0" />
                      <span>Extended borrowing periods</span>
                    </div>
                  </div>
                  <Link href="/premium">
                    <Button variant="outline" className="w-full mt-3 md:mt-4 h-8 md:h-10 text-xs md:text-sm">
                      Upgrade to ShareSwap Pro
                    </Button>
                  </Link>
                  <p className="text-[10px] md:text-xs text-center text-gray-500 mt-1.5 md:mt-2">
                    Or pay $49.99 annually (2 months free!)
                  </p>
                </div>
              </div>

              {/* Why Go Premium? */}
              <div className="mt-3 md:mt-4 py-2.5 md:py-3 bg-gray-50 rounded-lg px-3 md:px-4">
                <h3 className="text-sm md:text-lg font-bold text-center mb-2 md:mb-3">
                  Why Go Premium?
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
                  <div className="text-center">
                    <div className="w-8 h-8 md:w-10 md:h-10 mx-auto mb-1.5 md:mb-2 bg-teal-100 rounded-full flex items-center justify-center">
                      <UserCheck className="h-4 w-4 md:h-5 md:w-5 text-teal-600" />
                    </div>
                    <h4 className="font-semibold text-xs md:text-sm mb-0.5 md:mb-1">
                      Priority Access
                    </h4>
                    <p className="text-[10px] md:text-xs text-gray-500">
                      Get first dibs on the most popular items
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="w-8 h-8 md:w-10 md:h-10 mx-auto mb-1.5 md:mb-2 bg-teal-100 rounded-full flex items-center justify-center">
                      <Percent className="h-4 w-4 md:h-5 md:w-5 text-teal-600" />
                    </div>
                    <h4 className="font-semibold text-xs md:text-sm mb-0.5 md:mb-1">Lower Fees</h4>
                    <p className="text-[10px] md:text-xs text-gray-500">
                      Reduced transaction fees on all your sharing activities
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="w-8 h-8 md:w-10 md:h-10 mx-auto mb-1.5 md:mb-2 bg-teal-100 rounded-full flex items-center justify-center">
                      <Headphones className="h-4 w-4 md:h-5 md:w-5 text-teal-600" />
                    </div>
                    <h4 className="font-semibold text-xs md:text-sm mb-0.5 md:mb-1">
                      Premium Support
                    </h4>
                    <p className="text-[10px] md:text-xs text-gray-500">
                      Get faster responses and dedicated support from our team
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Account Statistics — Mobile Only (mirrors sidebar card) */}
            <div className="lg:hidden mt-2">
              <Card style={{ backgroundColor: "#D4F7F1" }}>
                <CardHeader className="py-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="h-4 w-4 text-teal-600" />
                    Account Statistics
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Crown className="h-4 w-4 text-teal-500" />
                        <span className="text-sm text-slate-600">Level</span>
                      </div>
                      <span className="font-semibold text-teal-700">{currentLevel.name}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Coins className="h-4 w-4 text-teal-500" />
                        <span className="text-sm text-slate-600">ShareCoins</span>
                      </div>
                      <span className="font-semibold text-teal-700">{Math.round(Number(profile?.shareCoins || 0))}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-teal-500" />
                        <span className="text-sm text-slate-600">Completed Shares</span>
                      </div>
                      <span className="font-semibold text-teal-700">{profile?.completedShares || 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Heart className="h-4 w-4 text-teal-500" />
                        <span className="text-sm text-slate-600">Items Borrowed</span>
                      </div>
                      <span className="font-semibold text-teal-700">{profile?.itemsBorrowed || 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Star className="h-4 w-4 text-teal-500" />
                        <span className="text-sm text-slate-600">Rating</span>
                      </div>
                      <span className="font-semibold text-teal-700">{profile?.rating || 0}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* My Balance + Account Settings — Desktop Sidebar */}
            <div className="hidden lg:flex flex-col gap-2">
              <Link href="/my-balance" className="w-full">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Wallet className="h-4 w-4 mr-2" />
                  My Balance
                </Button>
              </Link>
              <Link href="/settings" className="w-full">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Settings className="h-4 w-4 mr-2" />
                  Account Settings
                </Button>
              </Link>
            </div>

            {/* Verification Checklist - Desktop Only (shown in sidebar) */}
            <Card
              id="verification-status"
              className={`hidden lg:block ${
                profile?.isVerified
                  ? "border-green-200 bg-green-50"
                  : "border-orange-200 bg-orange-50"
              }`}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BadgeCheck
                    className={`h-5 w-5 ${profile?.isVerified ? "text-green-600" : "text-orange-600"}`}
                  />
                  Verification Status
                  {!profile?.isVerified && (
                    <Badge
                      variant="outline"
                      className="ml-auto bg-orange-100 text-orange-700 border-orange-300"
                    >
                      Unverified
                    </Badge>
                  )}
                  {profile?.isVerified && (
                    <Badge
                      variant="outline"
                      className="ml-auto bg-green-100 text-green-700 border-green-300"
                    >
                      Verified
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  {(profile as any)?.paymentMethodLast4 ? (
                    <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <X className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                  <Link href="/payment-methods" className="flex-1">
                    <Button
                      variant="outline"
                      className="w-full justify-start bg-white/80 hover:bg-white"
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Payment Methods
                    </Button>
                  </Link>
                </div>
                <div className="flex items-center gap-2">
                  {(profile as any)?.idVerified ? (
                    <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <X className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                  <Link href="/verification" className="flex-1">
                    <Button
                      variant="outline"
                      className="w-full justify-start bg-white/80 hover:bg-white"
                    >
                      <BadgeCheck className="h-4 w-4 mr-2" />
                      Identity Verification
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Account Statistics — Desktop Sidebar Only */}
            <Card style={{ backgroundColor: "#D4F7F1" }} className="hidden lg:block">
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4 text-teal-600" />
                  Account Statistics
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Crown className="h-4 w-4 text-teal-500" />
                      <span className="text-sm text-slate-600">Level</span>
                    </div>
                    <span className="font-semibold text-teal-700">
                      {currentLevel.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coins className="h-4 w-4 text-teal-500" />
                      <span className="text-sm text-slate-600">ShareCoins</span>
                    </div>
                    <span className="font-semibold text-teal-700">
                      {Math.round(Number(profile?.shareCoins || 0))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-teal-500" />
                      <span className="text-sm text-slate-600">
                        Completed Shares
                      </span>
                    </div>
                    <span className="font-semibold text-teal-700">
                      {profile?.completedShares || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Heart className="h-4 w-4 text-teal-500" />
                      <span className="text-sm text-slate-600">
                        Items Borrowed
                      </span>
                    </div>
                    <span className="font-semibold text-teal-700">
                      {profile?.itemsBorrowed || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-teal-500" />
                      <span className="text-sm text-slate-600">Rating</span>
                    </div>
                    <span className="font-semibold text-teal-700">
                      {profile?.rating || 0}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Location Alerts */}
            {locationAlerts && locationAlerts.length > 0 && (
              <Card style={{ backgroundColor: "#D4F7F1" }}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-teal-600" />
                    Location Alerts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {locationAlerts.slice(0, 3).map((alert) => (
                      <div
                        key={alert.id}
                        className="flex items-center justify-between p-2 bg-teal-50 rounded"
                      >
                        <div>
                          <div className="font-medium text-sm">
                            {alert.keyword}
                          </div>
                          <div className="text-xs text-slate-600">
                            {alert.location}
                          </div>
                        </div>
                        <Badge
                          variant={alert.isActive ? "default" : "secondary"}
                        >
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

        {/* Photo Crop Dialog */}
        <Dialog
          open={showCropDialog}
          onOpenChange={(open) => {
            if (!open) handleCropCancel();
            setShowCropDialog(open);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Crop Your Photo</DialogTitle>
            </DialogHeader>
            <div className="flex justify-center py-4">
              {imageSrc && (
                <ReactCrop
                  crop={crop}
                  onChange={(_, percentCrop) => setCrop(percentCrop)}
                  aspect={1}
                  circularCrop
                >
                  <img
                    ref={imgRef}
                    src={imageSrc}
                    alt="Crop preview"
                    onLoad={onImageLoad}
                    style={{ maxHeight: "400px", maxWidth: "100%" }}
                  />
                </ReactCrop>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleCropCancel}>
                Cancel
              </Button>
              <Button
                onClick={handleCropConfirm}
                disabled={profilePhotoMutation.isPending}
              >
                {profilePhotoMutation.isPending
                  ? "Uploading..."
                  : "Upload Photo"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
