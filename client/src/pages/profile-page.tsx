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
} from "lucide-react";
import { OnboardingTutorial } from "@/components/onboarding-tutorial";
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
  const [isEditing, setIsEditing] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
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
    (user && (usernameFromUrl === user.username || usernameFromUrl === (user as any).handle));

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

  // Fetch user's reviews if viewing another user's profile
  const { data: userReviews = [] } = useQuery<any[]>({
    queryKey: [`/api/users/username/${usernameFromUrl}/reviews`],
    enabled: !!usernameFromUrl && !isOwnProfile,
  });

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/user-profile"],
    enabled: !!isOwnProfile,
  });

  const { data: locationAlerts = [] } = useQuery<LocationAlert[]>({
    queryKey: ["/api/location-alerts"],
    enabled: !!isOwnProfile,
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
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update profile. Please try again.",
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
    if (window.location.hash === '#verification-status') {
      setTimeout(() => {
        const element = document.getElementById('verification-status');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        location: profile.location || user?.defaultCity || user?.defaultPostalCode || "",
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

  // Check if the tutorial has been seen before
  const hasSeenTutorial =
    typeof window !== "undefined"
      ? localStorage.getItem("hasSeenTutorial") === "true"
      : false;

  // Automatically show tutorial if not seen and user is logged in
  useState(() => {
    if (user && !hasSeenTutorial) {
      setShowTutorial(true);
    }
  });

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
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card className="mb-6" style={{ backgroundColor: "#D4F7F1" }}>
            <CardHeader className="bg-transparent">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full overflow-hidden flex-shrink-0">
                  {(publicProfile as any).profilePhoto ? (
                    <img
                      src={(publicProfile as any).profilePhoto}
                      alt={(publicProfile as any).handle || publicProfile.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-teal-600 flex items-center justify-center text-white text-3xl font-bold">
                      {((publicProfile as any).displayName || (publicProfile as any).handle || publicProfile.username).charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <CardTitle className="text-2xl text-slate-800">
                      @{(publicProfile as any).handle || publicProfile.username.split('@')[0]}
                    </CardTitle>
                    <UserBadges
                      isVerified={publicProfile.isVerified}
                      reputationLevel={publicProfile.reputationLevel}
                      size="md"
                      showLabels
                    />
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Star className="h-4 w-4 text-yellow-500" />
                      <span>
                        {publicProfile.averageRating.toFixed(1)} (
                        {publicProfile.reviewCount} reviews)
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Package className="h-4 w-4" />
                      <span>{userItems.length} items shared</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Shared Items */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-4">Shared Items</h2>
            {userItems.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {userItems.map((item) => (
                  <Card
                    key={item.id}
                    className="hover:shadow-lg transition-shadow bg-white rounded-xl overflow-hidden"
                  >
                    <div className="p-4">
                      <div className="aspect-square bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden">
                        {item.photos && item.photos[0] ? (
                          <img
                            src={item.photos[0]}
                            alt={item.name}
                            className="w-full h-full object-cover rounded-lg"
                          />
                        ) : (
                          <div className="w-full h-full bg-gray-200 flex items-center justify-center rounded-lg">
                            <Camera className="h-16 w-16 text-gray-400" />
                          </div>
                        )}
                      </div>
                    </div>
                    <CardContent className="px-6 pt-0 pb-4">
                      <h3 className="font-bold text-lg mb-2 truncate">
                        {item.name}
                      </h3>
                      <div className="space-y-1 text-sm mb-3">
                        <p className="text-muted-foreground">
                          Condition: {item.conditionRating}/10
                        </p>
                        {(item.isLendable || item.isRentable) && (
                          <div className="flex items-center gap-2">
                            <Coins className="h-4 w-4 text-teal-600" />
                            <span>{item.shareCoinPrice || item.shareCoinsReward || "5"} ShareCoins</span>
                            {item.isRentable && (
                              <>
                                <span className="text-slate-400">|</span>
                                <DollarSign className="h-4 w-4 text-teal-600" />
                                <span>${Number(item.dollarsPrice || 10).toFixed(2)}/day</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {item.isLendable && (
                          <Button
                            size="sm"
                            className="text-white rounded-lg text-xs px-2 whitespace-nowrap"
                            style={{ backgroundColor: "#0DCEA1" }}
                            onClick={() => navigate(`/items/${item.id}`)}
                          >
                            <HandHeart className="h-3 w-3 mr-0.5" />
                            Borrow It
                          </Button>
                        )}
                        {item.isRentable && (
                          <Button
                            size="sm"
                            className="text-white rounded-lg text-xs px-2 whitespace-nowrap"
                            style={{ backgroundColor: "#0DCEA1" }}
                            onClick={() => navigate(`/items/${item.id}`)}
                          >
                            <DollarSign className="h-3 w-3 mr-0.5" />
                            Rent It
                          </Button>
                        )}
                        {item.isSwappable && (
                          <Button
                            size="sm"
                            className="text-white rounded-lg text-xs px-2 whitespace-nowrap"
                            style={{ backgroundColor: "#0DCEA1" }}
                            onClick={() => navigate(`/items/${item.id}`)}
                          >
                            <ArrowLeftRight className="h-3 w-3 mr-0.5" />
                            Swap It
                          </Button>
                        )}
                        {!item.isLendable &&
                          !item.isRentable &&
                          !item.isSwappable && (
                            <Button
                              size="sm"
                              className="text-white rounded-lg text-xs px-2 whitespace-nowrap"
                              style={{ backgroundColor: "#0DCEA1" }}
                              onClick={() => navigate(`/items/${item.id}`)}
                            >
                              View
                            </Button>
                          )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="p-6 text-center text-muted-foreground">
                No items shared yet
              </Card>
            )}
          </div>

          {/* Reviews */}
          <div>
            <h2 className="text-2xl font-bold mb-4">Reviews</h2>
            {userReviews.length > 0 ? (
              <div className="space-y-4">
                {userReviews.map((review: any) => (
                  <Card
                    key={review.id}
                    className="p-4"
                    style={{ backgroundColor: "#D4F7F1" }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-teal-600 rounded-full flex items-center justify-center text-white font-bold">
                        {review.reviewer.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Link href={`/profile/${(review.reviewer as any).handle || review.reviewer.username}`}>
                            <span className="font-medium text-teal-600 hover:text-teal-700 cursor-pointer">
                              @{(review.reviewer as any).handle || review.reviewer.username.split('@')[0]}
                            </span>
                          </Link>
                          <UserBadges
                            isVerified={review.reviewer.isVerified}
                            reputationLevel={review.reviewer.reputationLevel}
                            size="sm"
                          />
                          <span className="text-muted-foreground text-sm">
                            {new Date(review.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mb-2">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`h-4 w-4 ${i < review.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
                            />
                          ))}
                        </div>
                        {review.comment && (
                          <p className="text-sm text-muted-foreground">
                            {review.comment}
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
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
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Profile Information */}
          <div className="lg:col-span-2 space-y-6">
            {/* Main Profile Card */}
            <Card className="border-2 border-teal-100 overflow-hidden">
              <CardHeader className="bg-[#D4F7F1]">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <Avatar className="h-16 w-16 border-2 border-white shadow-md flex-shrink-0">
                      <AvatarImage
                        src={(user as any)?.profilePhoto}
                        alt={(user as any).displayName || (user as any).handle || user.username}
                      />
                      <AvatarFallback className="bg-teal-600 text-white text-2xl font-bold">
                        {((user as any).displayName || (user as any).handle || user.username).charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <CardTitle className="text-xl sm:text-2xl text-slate-800 truncate">
                          {(user as any).displayName || (user as any).handle || user.username}
                        </CardTitle>
                        <UserBadges
                          isVerified={profile?.isVerified || false}
                          reputationLevel="Newcomer"
                          size="sm"
                        />
                      </div>
                      <p className="text-slate-600 text-sm sm:text-base truncate">@{(user as any).handle || user.username.split('@')[0]}</p>
                      {profile?.subscription && (
                        <Badge variant="secondary" className="mt-1">
                          {profile.subscription}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-row sm:flex-col gap-2 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 sm:w-full justify-center sm:justify-start"
                      onClick={isEditing ? handleCancelEdit : handleEditProfile}
                      disabled={updateProfileMutation.isPending}
                    >
                      {isEditing ? (
                        <>
                          <X className="h-4 w-4 mr-1 sm:mr-2" />
                          <span className="hidden sm:inline">Cancel</span>
                        </>
                      ) : (
                        <>
                          <Edit3 className="h-4 w-4 mr-1 sm:mr-2" />
                          <span className="hidden sm:inline">Edit Profile</span>
                          <span className="sm:hidden">Edit</span>
                        </>
                      )}
                    </Button>
                    <Link href="/my-balance" className="flex-1 sm:w-full">
                      <Button variant="outline" size="sm" className="w-full justify-center sm:justify-start">
                        <Wallet className="h-4 w-4 mr-1 sm:mr-2" />
                        <span className="hidden sm:inline">My Balance</span>
                        <span className="sm:hidden">Balance</span>
                      </Button>
                    </Link>
                    <Link href="/settings" className="flex-1 sm:w-full">
                      <Button variant="outline" size="sm" className="w-full justify-center sm:justify-start">
                        <Settings className="h-4 w-4 mr-1 sm:mr-2" />
                        <span className="hidden sm:inline">Account Settings</span>
                        <span className="sm:hidden">Account</span>
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardHeader>
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
                              alt={(user as any).displayName || (user as any).handle || user.username}
                            />
                            <AvatarFallback className="bg-teal-100 text-teal-600 text-xl font-medium">
                              {((user as any).displayName || (user as any).handle || user.username)?.charAt(0).toUpperCase()}
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
                      <Input
                        value={editForm.displayName}
                        onChange={(e) =>
                          setEditForm({ ...editForm, displayName: e.target.value })
                        }
                        placeholder="e.g. Sarah M."
                        maxLength={40}
                      />
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
                      <div className="flex items-center gap-3">
                        <Calendar className="h-4 w-4 text-slate-500" />
                        <span className="text-slate-600">
                          Joined{" "}
                          {profile?.joinedDate
                            ? new Date(profile.joinedDate).toLocaleDateString()
                            : "Recently"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

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
                    <Button variant="outline" className="w-full justify-start bg-white/80 hover:bg-white">
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
                    <Button variant="outline" className="w-full justify-start bg-white/80 hover:bg-white">
                      <BadgeCheck className="h-4 w-4 mr-2" />
                      Identity Verification
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Upgrade to Premium */}
            <div className="mt-6">
              <div className="text-center mb-4">
                <h2 className="flex items-center justify-center gap-2 text-xl font-bold">
                  <Crown className="h-6 w-6 text-teal-600" />
                  Upgrade to Premium
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Get priority access, lower fees, and exclusive features to
                  maximize your sharing experience
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ShareSwap Premium Card */}
                <div className="relative border border-gray-200 rounded-lg p-4 bg-white">
                  <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-teal-500 text-white text-xs px-3">
                    Most Popular
                  </Badge>
                  <div className="text-center pt-3">
                    <div className="flex items-center justify-center gap-2">
                      <Crown className="h-5 w-5 text-teal-600" />
                      <span className="font-semibold text-lg">
                        ShareSwap Premium
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Unlock priority access, lower fees, and exclusive features
                    </p>
                    <div className="mt-3">
                      <span className="text-3xl font-bold text-teal-600">
                        $9.99
                      </span>
                      <span className="text-sm text-gray-500">/month</span>
                    </div>
                    <p className="text-xs text-teal-600 mt-1">
                      Save $19.89/year with annual billing
                    </p>
                  </div>
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-teal-600" />
                      <span>Priority access to high-demand items</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Gift className="h-4 w-4 text-teal-600" />
                      <span>50% reduction in transaction fees</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-teal-600" />
                      <span>Early access to new features</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-teal-600" />
                      <span>Premium customer support</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-teal-600" />
                      <span>Advanced search filters</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-teal-600" />
                      <span>Unlimited wishlist items</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-teal-600" />
                      <span>Enhanced profile visibility</span>
                    </div>
                  </div>
                  <Link href="/premium">
                    <Button className="w-full mt-4 bg-teal-500 hover:bg-teal-600 text-white">
                      Upgrade to ShareSwap Premium
                    </Button>
                  </Link>
                  <p className="text-xs text-center text-gray-500 mt-2">
                    Or pay $99.99 annually (2 months free!)
                  </p>
                </div>

                {/* ShareSwap Pro Card */}
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="text-center pt-3">
                    <div className="flex items-center justify-center gap-2">
                      <Crown className="h-5 w-5 text-gray-600" />
                      <span className="font-semibold text-lg">
                        ShareSwap Pro
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Perfect for active community members
                    </p>
                    <div className="mt-3">
                      <span className="text-3xl font-bold text-gray-700">
                        $4.99
                      </span>
                      <span className="text-sm text-gray-500">/month</span>
                    </div>
                    <p className="text-xs text-teal-600 mt-1">
                      Save $9.89/year with annual billing
                    </p>
                  </div>
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Gift className="h-4 w-4 text-teal-600" />
                      <span>25% reduction in transaction fees</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-teal-600" />
                      <span>Advanced search filters</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-teal-600" />
                      <span>Up to 20 wishlist items</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-teal-600" />
                      <span>Priority customer support</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-teal-600" />
                      <span>Extended borrowing periods</span>
                    </div>
                  </div>
                  <Link href="/premium">
                    <Button variant="outline" className="w-full mt-4">
                      Upgrade to ShareSwap Pro
                    </Button>
                  </Link>
                  <p className="text-xs text-center text-gray-500 mt-2">
                    Or pay $49.99 annually (2 months free!)
                  </p>
                </div>
              </div>

              {/* Why Go Premium? */}
              <div className="mt-4 py-3 bg-gray-50 rounded-lg px-4">
                <h3 className="text-lg font-bold text-center mb-3">
                  Why Go Premium?
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="w-10 h-10 mx-auto mb-2 bg-teal-100 rounded-full flex items-center justify-center">
                      <UserCheck className="h-5 w-5 text-teal-600" />
                    </div>
                    <h4 className="font-semibold text-sm mb-1">
                      Priority Access
                    </h4>
                    <p className="text-xs text-gray-500">
                      Get first dibs on the most popular items
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="w-10 h-10 mx-auto mb-2 bg-teal-100 rounded-full flex items-center justify-center">
                      <Percent className="h-5 w-5 text-teal-600" />
                    </div>
                    <h4 className="font-semibold text-sm mb-1">Lower Fees</h4>
                    <p className="text-xs text-gray-500">
                      Reduced transaction fees on all your sharing activities
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="w-10 h-10 mx-auto mb-2 bg-teal-100 rounded-full flex items-center justify-center">
                      <Headphones className="h-5 w-5 text-teal-600" />
                    </div>
                    <h4 className="font-semibold text-sm mb-1">
                      Premium Support
                    </h4>
                    <p className="text-xs text-gray-500">
                      Get faster responses and dedicated support from our team
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
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
                    <Button variant="outline" className="w-full justify-start bg-white/80 hover:bg-white">
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
                    <Button variant="outline" className="w-full justify-start bg-white/80 hover:bg-white">
                      <BadgeCheck className="h-4 w-4 mr-2" />
                      Identity Verification
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Community Connections */}
            <Card style={{ backgroundColor: "#D4F7F1" }}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Community Connections
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-teal-600" />
                  <div>
                    <div className="text-2xl font-bold text-teal-700">
                      {profile?.totalTransactions || 0}
                    </div>
                    <p className="text-sm text-slate-600">Total Transactions</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Account Statistics */}
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
                      {profile?.shareCoins || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-teal-500" />
                      <span className="text-sm text-slate-600">
                        Items Shared
                      </span>
                    </div>
                    <span className="font-semibold text-teal-700">
                      {profile?.itemsShared || 0}
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

        {/* Onboarding Tutorial */}
        {showTutorial && (
          <OnboardingTutorial
            onComplete={() => {
              setShowTutorial(false);
              localStorage.setItem("hasSeenTutorial", "true");
            }}
          />
        )}

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
