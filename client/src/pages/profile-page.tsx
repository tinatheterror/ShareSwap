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

  // Extract username/handle from URL path
  const pathParts = location.split("/");
  const usernameFromUrl = pathParts[2]; // /profile/:username or /profile/:handle
  const isOwnProfile =
    !usernameFromUrl ||
    (user &&
      (usernameFromUrl === user.username ||
        usernameFromUrl === (user as any).handle));

  // Fetch user profile by username if viewing another user's profile
  const { data: otherProfile, isLoading: isLoadingPublicProfile } =
    useQuery<any>({
      queryKey: [`/api/users/username/${usernameFromUrl}`],
      enabled: !!usernameFromUrl && !isOwnProfile,
    });

  // Fetch user's items if viewing another user's profile
  const { data: otherItems = [] } = useQuery<SelectItem[]>({
    queryKey: [`/api/users/username/${usernameFromUrl}/items`],
    enabled: !!usernameFromUrl && !isOwnProfile,
  });

  // Fetch reviews — for another user's profile use the URL username,
  // for own profile use the logged-in user's username.
  const { data: otherReviews = [] } = useQuery<any[]>({
    queryKey: [`/api/users/username/${usernameFromUrl}/reviews`],
    enabled: !!usernameFromUrl && !isOwnProfile,
  });

  const { data: ownReviews = [] } = useQuery<any[]>({
    queryKey: [`/api/users/username/${user?.username}/reviews`],
    enabled: !!isOwnProfile && !!user?.username,
  });

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/user-profile"],
    enabled: !!isOwnProfile,
  });

  const { data: locationAlerts = [] } = useQuery<LocationAlert[]>({
    queryKey: ["/api/location-alerts"],
    enabled: !!isOwnProfile,
  });

  // Own public profile — same data shape as other users' profiles
  const { data: ownPublicProfile, isLoading: isLoadingOwnPublicProfile } = useQuery<any>({
    queryKey: [`/api/users/username/${user?.username}`],
    enabled: !!isOwnProfile && !!user?.username,
  });
  const { data: ownPublicItems = [] } = useQuery<SelectItem[]>({
    queryKey: [`/api/users/username/${user?.username}/items`],
    enabled: !!isOwnProfile && !!user?.username,
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", "/api/user-profile", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
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

  // Unified display data — own profile uses public-endpoint data (same shape as others)
  const displayProfile = isOwnProfile ? ownPublicProfile : otherProfile;
  const displayItems = isOwnProfile ? ownPublicItems : otherItems;
  const displayReviews = isOwnProfile ? ownReviews : otherReviews;
  const isLoadingDisplayProfile = isOwnProfile ? isLoadingOwnPublicProfile : isLoadingPublicProfile;

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
  if (isLoadingDisplayProfile) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <p className="text-lg text-muted-foreground">Loading profile...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!isOwnProfile && !displayProfile) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-800 mb-4">User not found</h1>
            <p className="text-muted-foreground">The user @{usernameFromUrl} does not exist.</p>
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
            <CardHeader className="bg-transparent">
              <div className="flex items-start gap-4">
                <div className="w-20 h-20 rounded-full overflow-hidden flex-shrink-0">
                  {(displayProfile as any).profilePhoto ? (
                    <img
                      src={(displayProfile as any).profilePhoto}
                      alt={
                        (displayProfile as any).handle || displayProfile.username
                      }
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-teal-600 flex items-center justify-center text-white text-3xl font-bold">
                      {(
                        (displayProfile as any).displayName ||
                        (displayProfile as any).handle ||
                        displayProfile.username
                      )
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <CardTitle className="text-2xl text-slate-800">
                      {(displayProfile as any).displayName ||
                        (displayProfile as any).handle ||
                        displayProfile.username.split("@")[0]}
                    </CardTitle>
                    <UserBadges
                      isVerified={displayProfile.isVerified}
                      reputationLevel={displayProfile.reputationLevel}
                      size="md"
                      showLabels
                    />
                  </div>
                  <p className="text-slate-500 text-sm mb-0.5">
                    @
                    {(displayProfile as any).handle ||
                      displayProfile.username.split("@")[0]}
                  </p>
                  {(displayProfile as any).activeStatus && (
                    <p className="text-xs text-slate-500 mb-0.5">
                      {(displayProfile as any).activeStatus}
                    </p>
                  )}
                  {(displayProfile as any).responseTime && (
                    <p className="text-xs text-slate-500 mb-2">
                      {(displayProfile as any).responseTime}
                    </p>
                  )}
                </div>
              </div>

              {/* Edit Profile / Settings — own profile only */}
              {isOwnProfile && (
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" className="bg-white/80 hover:bg-white" onClick={handleEditProfile}>
                    <Edit3 className="h-3.5 w-3.5 mr-1.5" />
                    Edit Profile
                  </Button>
                  <Link href="/settings">
                    <Button size="sm" variant="outline" className="bg-white/80 hover:bg-white">
                      <Settings className="h-3.5 w-3.5 mr-1.5" />
                      Settings
                    </Button>
                  </Link>
                </div>
              )}

              {/* Reviews + shares — full-width, centered in the banner */}
              <div className="flex items-center justify-center gap-6 mt-5 mb-5 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Star className="h-5 w-5 text-yellow-400" />
                  <span>
                    {displayProfile.averageRating.toFixed(1)} (
                    {displayProfile.reviewCount} reviews)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Package className="h-5 w-5 text-slate-500" />
                  <span>
                    {(displayProfile as any).completedShares ?? 0} completed
                    shares
                  </span>
                </div>
              </div>

              {/* Trust stats — full-width row below avatar+info, left-aligned */}
              <div className="mt-5 space-y-1 text-xxs text-slate-500">
                {(displayProfile as any).onTimeReturnRate != null && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-teal-500 flex-shrink-0" />
                    <span>
                      {(displayProfile as any).onTimeReturnRate}% on-time returns
                    </span>
                  </div>
                )}
                {(displayProfile as any).replyRate != null && (
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-teal-500 flex-shrink-0" />
                    <span>
                      {(displayProfile as any).replyRate}% of the time replies
                    </span>
                  </div>
                )}
                <div className="mt-2 space-y-0.5 text-[10px] text-slate-400">
                  <div className="flex items-center gap-1">
                    <AlertTriangle
                      className={`h-3 w-3 flex-shrink-0 ${((displayProfile as any).issuesCount ?? 0) === 0 ? "text-green-400" : "text-amber-400"}`}
                    />
                    <span>
                      {(() => {
                        const n = (displayProfile as any).issuesCount ?? 0;
                        return n === 0
                          ? "No issues reported"
                          : `${n} issue${n !== 1 ? "s" : ""} reported`;
                      })()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Shield className="h-3 w-3 text-teal-400 flex-shrink-0" />
                    <span>Trust Score: {(displayProfile as any).trustScore ?? 0}</span>
                  </div>
                  {(displayProfile as any).createdAt && (
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 flex-shrink-0" />
                      <span>
                        Member since{" "}
                        {new Date((displayProfile as any).createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Shared Items */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-4">Shared Items</h2>
            {displayItems.length > 0 ? (
              <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:grid md:grid-cols-3 md:gap-6 md:overflow-x-visible md:pb-0 md:mx-0 md:px-0">
                {displayItems.map((item) => (
                  <div key={item.id} className="w-64 flex-shrink-0 md:w-auto h-full">
                    <Card className={`hover:shadow-lg transition-shadow bg-white rounded-xl overflow-hidden h-full flex flex-col ${item.isGift ? "border-pink-100" : ""}`}>
                      <div className="p-2">
                        <div
                          className={`rounded-lg flex items-center justify-center overflow-hidden relative ${item.isGift ? "bg-pink-50" : "bg-gray-100"}`}
                          style={{ aspectRatio: "1 / 0.9" }}
                        >
                          {item.isGift && (
                            <Badge className="absolute top-2 right-2 bg-pink-500 text-white text-[10px]">
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
                                ? <Gift className="h-10 w-10 text-pink-400" />
                                : <Camera className="h-10 w-10 text-gray-400" />
                              }
                            </div>
                          )}
                        </div>
                      </div>
                      <CardContent className="px-3 pt-0 pb-2 flex flex-col flex-1">
                        <h3 className="font-bold text-sm mb-0.5 truncate text-slate-800">
                          {item.name}
                        </h3>
                        <div className="space-y-0 mb-1.5 flex-1">
                          <p className="text-xs text-slate-700">
                            <span className="font-medium">Condition:</span> {item.conditionRating}/10
                          </p>
                          {!item.isGift && (item.isLendable || item.isRentable) && (
                            <div className="flex items-center gap-1 text-xs text-slate-700">
                              <Coins className="h-3 w-3 text-teal-600" />
                              <span>
                                {Math.round(Number(item.shareCoinPrice || item.shareCoinsReward || 5))} ShareCoins
                              </span>
                              {item.isRentable && (
                                <>
                                  <span className="text-slate-400">|</span>
                                  <DollarSign className="h-3 w-3 text-teal-600" />
                                  <span>${Number(item.dollarsPrice || 10).toFixed(0)}/wk</span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 mt-auto">
                          {item.isGift ? (
                            <Button
                              size="sm"
                              className="w-full bg-pink-500 hover:bg-pink-600 text-white rounded-lg text-[10px] h-6 whitespace-nowrap"
                              onClick={() => navigate(`/items/${item.id}`)}
                            >
                              <Gift className="h-2.5 w-2.5 mr-0.5" />
                              Claim Gift
                            </Button>
                          ) : (
                            <>
                              {item.isLendable && (
                                <Button
                                  size="sm"
                                  className="text-white rounded-lg text-[10px] px-1.5 h-6 whitespace-nowrap"
                                  style={{ backgroundColor: "#0DCEA1" }}
                                  onClick={() => navigate(`/items/${item.id}`)}
                                >
                                  <HandHeart className="h-2.5 w-2.5 mr-0.5" />
                                  Borrow It
                                </Button>
                              )}
                              {item.isRentable && (
                                <Button
                                  size="sm"
                                  className="text-white rounded-lg text-[10px] px-1.5 h-6 whitespace-nowrap"
                                  style={{ backgroundColor: "#0DCEA1" }}
                                  onClick={() => navigate(`/items/${item.id}`)}
                                >
                                  <DollarSign className="h-2.5 w-2.5 mr-0.5" />
                                  Rent It
                                </Button>
                              )}
                              {item.isSwappable && (
                                <Button
                                  size="sm"
                                  className="text-white rounded-lg text-[10px] px-1.5 h-6 whitespace-nowrap"
                                  style={{ backgroundColor: "#0DCEA1" }}
                                  onClick={() => navigate(`/items/${item.id}`)}
                                >
                                  <ArrowLeftRight className="h-2.5 w-2.5 mr-0.5" />
                                  Swap It
                                </Button>
                              )}
                              {!item.isLendable && !item.isRentable && !item.isSwappable && (
                                <Button
                                  size="sm"
                                  className="text-white rounded-lg text-[10px] px-1.5 h-6 whitespace-nowrap"
                                  style={{ backgroundColor: "#0DCEA1" }}
                                  onClick={() => navigate(`/items/${item.id}`)}
                                >
                                  View
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </CardContent>
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
            {displayReviews.length > 0 ? (
              <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:flex-col md:overflow-x-visible md:pb-0 md:mx-0 md:px-0">
                {groupReviews(displayReviews).map((group) => {
                  const isExpanded = expandedReviewers.has(group.reviewer.id);
                  const mostRecent = group.reviews[0];
                  const displayName = group.reviewer.displayName || group.reviewer.handle || group.reviewer.username.split("@")[0];
                  return (
                    <div key={group.reviewer.id} className="w-80 flex-shrink-0 md:w-auto">
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

          {/* Edit Profile Dialog — own profile only */}
          {isOwnProfile && (
            <Dialog open={isEditing} onOpenChange={(open) => !open && handleCancelEdit()}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Edit Profile</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <Avatar className="h-16 w-16 border-2 border-gray-200">
                        <AvatarImage src={(user as any)?.profilePhoto} alt={(user as any).displayName || user.username} />
                        <AvatarFallback className="bg-teal-100 text-teal-600 text-xl font-medium">
                          {((user as any).displayName || user.username).charAt(0).toUpperCase()}
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
                      <input ref={fileInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/gif,image/webp" onChange={handlePhotoUpload} className="hidden" />
                    </div>
                    <div className="text-sm text-gray-500">
                      {profilePhotoMutation.isPending ? "Uploading..." : (user as any)?.profilePhoto ? "Click camera to change" : "Add a photo"}
                      {!(user as any)?.hasUploadedProfilePhoto && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                          <Coins className="h-3 w-3" /><span>Earn 1 ShareCoin for a clear photo</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium mb-1.5 block">Display Name</Label>
                    {(() => {
                      const changedAt = (profile as any)?.displayNameChangedAt;
                      const isLocked = !!changedAt && (Date.now() - new Date(changedAt).getTime()) < 30 * 24 * 60 * 60 * 1000;
                      const nextAllowed = changedAt ? new Date(new Date(changedAt).getTime() + 30 * 24 * 60 * 60 * 1000) : null;
                      return (
                        <>
                          <Input value={editForm.displayName} onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })} placeholder="e.g. Sarah M." maxLength={40} disabled={isLocked} />
                          {isLocked && nextAllowed && <p className="text-xs text-muted-foreground mt-1">Can be changed again on {nextAllowed.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}</p>}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <Label className="text-sm font-medium mb-1.5 block">Bio</Label>
                    <Textarea value={editForm.bio} onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })} placeholder="Tell us about yourself..." rows={3} />
                  </div>
                  <div>
                    <Label className="text-sm font-medium mb-1.5 block">Location</Label>
                    <Input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} placeholder="Your city (e.g. Toronto)" />
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={handleCancelEdit} disabled={updateProfileMutation.isPending}>Cancel</Button>
                  <Button onClick={handleSaveProfile} disabled={updateProfileMutation.isPending} style={{ backgroundColor: "#0DCEA1" }}>
                    <Save className="h-4 w-4 mr-2" />
                    {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {/* Photo Crop Dialog */}
          <Dialog open={showCropDialog} onOpenChange={(open) => { if (!open) handleCropCancel(); setShowCropDialog(open); }}>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Crop Your Photo</DialogTitle></DialogHeader>
              <div className="flex justify-center py-4">
                {imageSrc && (
                  <ReactCrop crop={crop} onChange={(_, percentCrop) => setCrop(percentCrop)} aspect={1} circularCrop>
                    <img ref={imgRef} src={imageSrc} alt="Crop preview" onLoad={onImageLoad} style={{ maxHeight: "400px", maxWidth: "100%" }} />
                  </ReactCrop>
                )}
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={handleCropCancel}>Cancel</Button>
                <Button onClick={handleCropConfirm} disabled={profilePhotoMutation.isPending}>
                  {profilePhotoMutation.isPending ? "Uploading..." : "Upload Photo"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </main>
      </div>
    );
}
