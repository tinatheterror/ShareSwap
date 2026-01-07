import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WishlistFulfillmentPopup } from "@/components/wishlist-fulfillment-popup";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  calculateSecurityDeposit,
  formatDeposit,
} from "@/lib/deposit-calculator";
import {
  calculateRentalRate,
  calculateRentalDeposit,
  validateRentalRate,
  validateRentalDeposit,
  formatCurrency,
} from "@/lib/rental-calculator";
import {
  getSwapEligibility,
  getTierShareCoins,
  getAcceptableSwapsLabel,
} from "@/lib/swap-calculator";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
  Upload,
  MapPin,
  X,
  Heart,
  CheckCircle,
  Download,
  HandHeart,
  DollarSign,
  ArrowLeftRight,
  Gift,
  Sparkles,
  Calendar,
  ChevronDown,
  Lightbulb,
  Coins,
  AlertTriangle,
  Info,
  Plus,
  Check,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { SmartScan } from "@/components/smartscan";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion, AnimatePresence } from "framer-motion";

const ITEM_TYPES = [
  "Baby & Kids",
  "Clothing & Accessories",
  "Electronics",
  "Hobbies & Collectibles",
  "Home & Kitchen",
  "Tools & Equipment",
] as const;

const CONDITIONS = ["New / Like New", "Good", "Fair", "Well Loved"] as const;

const ORIGINAL_VALUES = [
  "Under $50",
  "$50–$150",
  "$150–$300",
  "$300+",
] as const;

const TIER_NAMES: Record<number, string> = {
  1: "Tier 1 – Budget Friendly",
  2: "Tier 2 – Everyday Household Item",
  3: "Tier 3 – Premium Item",
  4: "Tier 4 – High Value Item",
};

const TIER_WEEKLY_BANDS: Record<
  number,
  { min: number; max: number; display: string }
> = {
  1: { min: 5, max: 5, display: "5" },
  2: { min: 10, max: 10, display: "10" },
  3: { min: 20, max: 20, display: "20" },
  4: { min: 40, max: 40, display: "40" },
};

const calculateTier = (originalValue: string, condition: string): number => {
  let baseTier = 1;
  if (originalValue === "Under $50") baseTier = 1;
  else if (originalValue === "$50–$150") baseTier = 2;
  else if (originalValue === "$150–$300") baseTier = 3;
  else if (originalValue === "$300+") baseTier = 4;

  if (condition === "Fair" || condition === "Well Loved") {
    baseTier = Math.max(1, baseTier - 1);
  }

  return baseTier;
};

const calculateShareCoinsForDays = (
  tier: number,
  days: number,
): { min: number; max: number } => {
  const band = TIER_WEEKLY_BANDS[tier] || TIER_WEEKLY_BANDS[1];
  const dailyMin = band.min / 7;
  const dailyMax = band.max / 7;
  const minCoins = Math.max(1, Math.floor(dailyMin * days));
  const maxCoins = Math.max(1, Math.floor(dailyMax * days));
  return { min: minCoins, max: maxCoins };
};

const formSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    description: z.string().min(10, "Please provide a detailed description"),
    itemType: z.string().min(1, "Item type is required"),
    condition: z.string().min(1, "Condition is required"),
    originalValue: z.string().min(1, "Original value is required"),
    isLendable: z.boolean().default(false),
    isSwappable: z.boolean().default(false),
    isRentable: z.boolean().default(false),
    isGift: z.boolean().default(false),
    availableFromDate: z.string().optional(),
    availableToDate: z.string().optional(),
    securityDeposit: z.coerce
      .number()
      .min(0, "Security deposit must be positive")
      .optional(),
    conditionRating: z.coerce
      .number()
      .min(1)
      .max(10, "Rating must be between 1 and 10"),
    postalCode: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  })
  .refine(
    (data) => {
      // Require either postalCode or lat/lng coordinates
      return data.postalCode || (data.latitude && data.longitude);
    },
    {
      message: "Location is required - please enter a postal code",
      path: ["postalCode"],
    },
  );

export default function LendPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const editItemId = new URLSearchParams(searchString).get("edit");
  const isEditMode = !!editItemId;

  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [matchedWishlists, setMatchedWishlists] = useState<any[]>([]);
  const [showMatchingModal, setShowMatchingModal] = useState(false);
  const [selectedWishlistMatch, setSelectedWishlistMatch] = useState<any>(null);
  const [listedItemData, setListedItemData] = useState<any>(null);
  const [uploadMethod, setUploadMethod] = useState<"smartscan" | "manual">(
    "manual",
  );
  const [smartScanPhotos, setSmartScanPhotos] = useState<string[]>([]);
  const [importUrl, setImportUrl] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);
  const [showWishlistFulfillmentPopup, setShowWishlistFulfillmentPopup] =
    useState(false);
  const [availabilityOption, setAvailabilityOption] = useState<
    "indefinitely" | "1month" | "3months" | "6months" | "1year" | "custom"
  >("indefinitely");

  // Fetch existing item data if in edit mode
  const { data: editItem, isLoading: isLoadingEditItem } = useQuery({
    queryKey: [`/api/items/${editItemId}`],
    enabled: isEditMode && !!editItemId,
  });

  // Auto-detect location on page load if not already set
  useEffect(() => {
    const currentPostalCode = form.getValues("postalCode");
    if (!currentPostalCode && "geolocation" in navigator) {
      getCurrentLocation();
    }
  }, []);

  const [isDetectingCategory, setIsDetectingCategory] = useState(false);
  const [itemTypeGlow, setItemTypeGlow] = useState(false);
  const [tierGlow, setTierGlow] = useState(false);
  const lastDetectedName = useRef("");
  const previousTier = useRef<number | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      itemType: "",
      condition: "",
      originalValue: "",
      isLendable: false,
      isSwappable: false,
      isRentable: false,
      availableFromDate: undefined,
      availableToDate: undefined,
      securityDeposit: undefined,
      conditionRating: 5,
      postalCode: "",
      latitude: undefined,
      longitude: undefined,
    },
  });

  const watchItemType = form.watch("itemType");
  const watchCondition = form.watch("condition");
  const watchOriginalValue = form.watch("originalValue");
  const watchName = form.watch("name");
  const watchDescription = form.watch("description");
  const watchConditionRating = form.watch("conditionRating");

  // Check if we have at least one photo (used for tier calculation and validation)
  const hasPhotos =
    selectedPhotos.length > 0 ||
    smartScanPhotos.length > 0 ||
    existingPhotos.length > 0;

  const calculatedTier =
    watchCondition && watchOriginalValue && watchItemType && hasPhotos
      ? calculateTier(watchOriginalValue, watchCondition)
      : null;

  // AI valuation state
  const [valuationResult, setValuationResult] = useState<{
    shareCoinsValue: number;
    tierBand: { min: number; max: number };
    reasoning: string;
    internalItemValue?: number;
  } | null>(null);
  const [isLoadingValuation, setIsLoadingValuation] = useState(false);
  const valuationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Rental rate state
  const [customRentalRate, setCustomRentalRate] = useState<number | null>(null);
  const [rentalRateWarning, setRentalRateWarning] = useState<string | null>(
    null,
  );
  const [customRentalDeposit, setCustomRentalDeposit] = useState<number | null>(
    null,
  );
  const [rentalDepositWarning, setRentalDepositWarning] = useState<
    string | null
  >(null);

  // Populate form when editing an existing item
  useEffect(() => {
    if (editItem && isEditMode) {
      const item = editItem as any;
      // Parse lat/lng as numbers (they come as strings from database)
      const lat = item.latitude ? parseFloat(item.latitude) : undefined;
      const lng = item.longitude ? parseFloat(item.longitude) : undefined;
      form.reset({
        name: item.name || "",
        description: item.description || "",
        itemType: item.itemType || "",
        condition: item.condition || "",
        originalValue: item.originalValue || "",
        isLendable: item.isLendable || false,
        isSwappable: item.isSwappable || false,
        isRentable: item.isRentable || false,
        isGift: item.isGift || false,
        availableFromDate: item.availableFromDate || undefined,
        availableToDate: item.availableToDate || undefined,
        securityDeposit: item.securityDeposit || undefined,
        conditionRating: item.conditionRating || 5,
        postalCode: item.address || "",
        latitude: lat,
        longitude: lng,
      });
      if (item.photos && item.photos.length > 0) {
        setExistingPhotos(item.photos);
      }
    }
  }, [editItem, isEditMode]);

  // Convert files to base64 for AI valuation
  const getPhotoDataUrls = async (): Promise<string[]> => {
    // If we have SmartScan photos, use those (they're already URLs)
    if (smartScanPhotos.length > 0) {
      return smartScanPhotos.slice(0, 3); // Limit to 3 for API efficiency
    }

    // Convert selected files to base64
    const photoPromises = selectedPhotos.slice(0, 3).map((file) => {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    });

    return Promise.all(photoPromises);
  };

  // Fetch AI valuation when relevant fields change (debounced)
  useEffect(() => {
    if (!watchName || !watchCondition || !watchOriginalValue || !hasPhotos) {
      setValuationResult(null);
      return;
    }

    // Clear previous timeout
    if (valuationTimeoutRef.current) {
      clearTimeout(valuationTimeoutRef.current);
    }

    // Debounce the API call
    valuationTimeoutRef.current = setTimeout(async () => {
      setIsLoadingValuation(true);
      try {
        // Get photo data URLs for AI analysis
        const photoDataUrls = await getPhotoDataUrls();

        const response = await apiRequest("POST", "/api/valuation/preview", {
          name: watchName,
          description: watchDescription || "",
          itemType: watchItemType || "",
          condition: watchCondition,
          conditionRating: watchConditionRating || 5,
          originalValue: watchOriginalValue,
          photos: photoDataUrls,
        });
        const data = await response.json();
        if (data.shareCoinsValue) {
          setValuationResult({
            shareCoinsValue: data.shareCoinsValue,
            tierBand: data.tierBand,
            reasoning: data.reasoning,
            internalItemValue: data.internalItemValue,
          });
          // Reset custom rental rate when valuation changes
          setCustomRentalRate(null);
          setRentalRateWarning(null);
        }
      } catch (error) {
        console.error("Failed to get valuation:", error);
        // Use fallback band display
        setValuationResult(null);
      } finally {
        setIsLoadingValuation(false);
      }
    }, 500);

    return () => {
      if (valuationTimeoutRef.current) {
        clearTimeout(valuationTimeoutRef.current);
      }
    };
  }, [
    watchName,
    watchDescription,
    watchItemType,
    watchCondition,
    watchConditionRating,
    watchOriginalValue,
    selectedPhotos,
    smartScanPhotos,
  ]);

  // Trigger tier glow animation when tier first appears
  useEffect(() => {
    if (calculatedTier && previousTier.current === null) {
      setTierGlow(true);
      setTimeout(() => setTierGlow(false), 1500);
    }
    previousTier.current = calculatedTier;
  }, [calculatedTier]);

  const detectItemCategory = async (itemName: string) => {
    if (
      !itemName ||
      itemName.length < 3 ||
      itemName === lastDetectedName.current
    )
      return;

    lastDetectedName.current = itemName;
    setIsDetectingCategory(true);

    try {
      const response = await apiRequest("POST", "/api/detect-category", {
        itemName,
      });
      const data = await response.json();
      if (data.category && ITEM_TYPES.includes(data.category)) {
        form.setValue("itemType", data.category);
        setItemTypeGlow(true);
        setTimeout(() => setItemTypeGlow(false), 1500);
      }
    } catch (error) {
      console.error("Failed to detect category:", error);
    } finally {
      setIsDetectingCategory(false);
    }
  };

  // Get all community wishlists for matching
  const { data: allWishlists = [] } = useQuery({
    queryKey: ["/api/all-wishlists"],
  });

  // Smart matching function: requires substantial word coverage before showing match
  const isGoodMatch = (typed: string, wishlistName: string): boolean => {
    const typedWords = typed
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const wishlistWords = wishlistName
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);

    // Check if any typed word substantially matches a wishlist word
    for (const typedWord of typedWords) {
      for (const wishlistWord of wishlistWords) {
        // Word must match at least 60% of the wishlist word OR be 5+ chars matching
        if (wishlistWord.startsWith(typedWord)) {
          const coverage = typedWord.length / wishlistWord.length;
          if (coverage >= 0.6 || typedWord.length >= 5) {
            return true;
          }
        }
        // Also check if wishlist word is fully contained in typed word
        if (typedWord.includes(wishlistWord) && wishlistWord.length >= 4) {
          return true;
        }
      }
    }
    return false;
  };

  // Check for wishlist matches when item name changes (for background tracking, no popup during typing)
  useEffect(() => {
    const itemName = form.watch("name");

    if (itemName && itemName.length >= 4 && Array.isArray(allWishlists)) {
      const matches = allWishlists.filter((wishlist: any) =>
        isGoodMatch(itemName, wishlist.itemName),
      );
      setMatchedWishlists(matches);
    } else {
      setMatchedWishlists([]);
    }
  }, [form.watch("name"), allWishlists]);

  const [smartScanAnalysis, setSmartScanAnalysis] = useState<any>(null);

  const handleSmartScanComplete = (analysis: any, photos: string[]) => {
    // Auto-fill form with AI-detected values
    form.setValue("name", analysis.name);
    form.setValue("description", analysis.description);
    form.setValue("conditionRating", analysis.conditionRating);
    setSmartScanPhotos(photos);
    setSmartScanAnalysis(analysis); // Store full analysis for submission

    toast({
      title: "✨ Form Auto-Filled!",
      description: "Review and adjust the AI-detected details as needed.",
    });
  };

  const getCurrentLocation = async () => {
    if ("geolocation" in navigator) {
      setIsLoadingLocation(true);
      try {
        const position = await new Promise<GeolocationPosition>(
          (resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject);
          },
        );

        const { latitude, longitude } = position.coords;
        form.setValue("latitude", latitude);
        form.setValue("longitude", longitude);

        // Get postal code from coordinates
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
          );
          const data = await response.json();
          if (data.address?.postcode) {
            form.setValue("postalCode", data.address.postcode);
            toast({
              title: "Location Updated",
              description: "Your postal code has been automatically filled.",
            });
          } else {
            toast({
              title: "Location Error",
              description:
                "Could not get your postal code. Please enter it manually.",
              variant: "destructive",
            });
          }
        } catch (error) {
          console.error("Error getting postal code:", error);
          toast({
            title: "Location Error",
            description:
              "Could not get your postal code. Please enter it manually.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Error getting location:", error);
        toast({
          title: "Location Error",
          description:
            "Could not get your location. Please enter postal code manually.",
          variant: "destructive",
        });
      } finally {
        setIsLoadingLocation(false);
      }
    }
  };

  const queryClient = useQueryClient();

  const createItemMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      // Require at least 1 photo
      if (selectedPhotos.length === 0 && smartScanPhotos.length === 0) {
        throw new Error("Please upload at least one photo of your item");
      }

      const formData = new FormData();

      // Use SmartScan photos or manual uploads
      if (smartScanPhotos.length > 0 && smartScanAnalysis) {
        formData.append("smartScanPhotos", JSON.stringify(smartScanPhotos));
        formData.append("wasSmartScanned", "true");

        if (smartScanAnalysis.category) {
          formData.append("category", smartScanAnalysis.category);
        }
        if (smartScanAnalysis.brand) {
          formData.append("brand", smartScanAnalysis.brand);
        }
        if (smartScanAnalysis.estimatedValue) {
          formData.append("estimatedValue", smartScanAnalysis.estimatedValue);
        }
      } else {
        selectedPhotos.forEach((photo) => {
          formData.append("photos", photo);
        });
      }

      Object.entries(data).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          formData.append(key, String(value));
        }
      });

      // Calculate and add tier
      if (data.condition && data.originalValue) {
        const tier = calculateTier(data.originalValue, data.condition);
        formData.append("tier", String(tier));
      }

      const res = await apiRequest("POST", "/api/items", formData);
      const result = await res.json();
      return result;
    },
    onSuccess: (data) => {
      // Invalidate item queries to refresh lists
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nearby-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-items"] });

      // Check if there are wishlist matches - show modal after listing
      if (matchedWishlists.length > 0) {
        setListedItemData(data);
        setSelectedWishlistMatch(matchedWishlists[0]);
        setShowMatchingModal(true);
      } else {
        toast({
          title: "Successfully Listed!",
          description: `Your item has been added to ShareChest. You'll earn ${data.shareCoinsReward || 10} ShareCoins for this listing.`,
        });
        // Show wishlist fulfillment popup after successful listing
        setShowWishlistFulfillmentPopup(true);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to list item",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update item mutation for edit mode
  const updateItemMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const formData = new FormData();

      // If new photos were uploaded, use them; otherwise keep existing
      if (selectedPhotos.length > 0) {
        selectedPhotos.forEach((photo) => {
          formData.append("photos", photo);
        });
      } else if (existingPhotos.length > 0) {
        formData.append("existingPhotos", JSON.stringify(existingPhotos));
      }

      Object.entries(data).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          formData.append(key, String(value));
        }
      });

      // Calculate and add tier
      if (data.condition && data.originalValue) {
        const tier = calculateTier(data.originalValue, data.condition);
        formData.append("tier", String(tier));
      }

      const res = await apiRequest(
        "PATCH",
        `/api/items/${editItemId}`,
        formData,
      );
      const result = await res.json();
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nearby-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-items"] });

      toast({
        title: "Item Updated!",
        description: "Your item has been successfully updated.",
      });
      navigate("/my-items");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update item",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setSelectedPhotos((prev) => [...prev, ...newFiles]);
    }
  };

  const removePhoto = (index: number) => {
    setSelectedPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const getPhotoPreviewUrl = (file: File): string => {
    return URL.createObjectURL(file);
  };

  const watchIsLendable = form.watch("isLendable");
  const watchIsRentable = form.watch("isRentable");
  const watchIsSwappable = form.watch("isSwappable");
  const watchIsGift = form.watch("isGift");
  const watchPostalCode = form.watch("postalCode");

  return (
    <div className="min-h-screen">
      <Navbar />

      {/* Hero Section - Same style as Browse page */}
      <div
        className="w-full relative"
        style={{ 
          backgroundImage: "url('/hero-banner.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          borderBottomRightRadius: "32px"
        }}
      >
        <div className="max-w-7xl mx-auto px-4 py-12 pb-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div className="flex-1">
              <h1 className="text-4xl font-bold mb-1 text-black">
                {isEditMode ? "Edit Your Item" : "List Your Item"}
              </h1>
              <p className="text-black/90">
                {isEditMode
                  ? " "
                  : "Make your neighbourhood richer without spending a cent"}
              </p>
            </div>

            {!isEditMode && (
              <div className="flex flex-col gap-3 md:w-96">
                <div
                  className="bg-white rounded-lg shadow-sm"
                  style={{ height: "98px", padding: "10px" }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Download className="h-3.5 w-3.5 text-teal-600" />
                    <h3 className="font-medium text-xs text-black">
                      Import from Marketplace
                    </h3>
                  </div>
                  <div className="flex gap-1.5 mb-2">
                    <Input
                      placeholder="Paste listing URL..."
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      className="flex-1 text-[11px] h-7 px-2"
                    />
                    <Button
                      onClick={async () => {
                        if (!importUrl) {
                          toast({
                            title: "URL Required",
                            description: "Please paste a marketplace URL",
                            variant: "destructive",
                          });
                          return;
                        }
                        setIsImporting(true);
                        try {
                          const response = await apiRequest(
                            "POST",
                            "/api/import-listing",
                            { url: importUrl },
                          );
                          const data = await response.json();

                          form.setValue("name", data.name || "");
                          form.setValue("description", data.description || "");
                          form.setValue(
                            "conditionRating",
                            data.conditionRating || 8,
                          );
                          if (data.price) {
                            form.setValue("securityDeposit", data.price);
                          }

                          toast({
                            title: "Imported Successfully!",
                            description:
                              "Listing details have been auto-filled. Review and adjust as needed.",
                          });
                          setImportUrl("");
                        } catch (error: any) {
                          toast({
                            title: "Import Failed",
                            description:
                              error.message ||
                              "Unable to import listing. Please try a different URL.",
                            variant: "destructive",
                          });
                        } finally {
                          setIsImporting(false);
                        }
                      }}
                      disabled={isImporting || !importUrl}
                      className="text-white text-[11px] h-7 px-2.5"
                      style={{ backgroundColor: "#0DCEA1" }}
                    >
                      {isImporting ? "Importing..." : "Import"}
                    </Button>
                  </div>
                  <p className="text-[10px] text-gray-400 pl-2">
                    Facebook groups, Facebook marketplace & Craigslist
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Inverted corner on bottom left - grey circle overlay creating cutout effect */}
        <div
          className="absolute bottom-0 left-0 w-8 h-8"
          style={{ borderTopRightRadius: "100%", backgroundColor: "#f3f4f6" }}
        />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              isEditMode
                ? updateItemMutation.mutate(data)
                : createItemMutation.mutate(data),
            )}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            {/* Left Column - Form Fields */}
            <div className="lg:col-span-2">
              <Card>
                <CardContent className="pt-6 space-y-6">
                  {/* Question 1: Item Name with Item Type inline */}
                  <div className="space-y-4 border-t pt-4">
                    <div className="flex items-start gap-2 flex-wrap">
                      <h3 className="font-medium whitespace-nowrap pt-2">
                        I'm Sharing my
                      </h3>
                      <div className="flex-1 flex gap-2 min-w-[300px]">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem className="flex-1">
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="e.g., Baby Stroller, Power Drill..."
                                  onBlur={(e) => {
                                    field.onBlur();
                                    detectItemCategory(e.target.value);
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="flex flex-col w-1/2">
                          <FormField
                            control={form.control}
                            name="itemType"
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                  >
                                    <SelectTrigger
                                      className={`transition-all duration-500 ${
                                        itemTypeGlow
                                          ? "ring-2 ring-teal-400 ring-offset-2 shadow-[0_0_15px_rgba(13,206,161,0.5)]"
                                          : ""
                                      }`}
                                    >
                                      <SelectValue placeholder="Item type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {ITEM_TYPES.map((type) => (
                                        <SelectItem key={type} value={type}>
                                          {type}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <p className="text-xs text-gray-400 mt-1 pl-3">
                            {isDetectingCategory ? (
                              <span className="text-teal-500 animate-pulse">
                                AI detecting...
                              </span>
                            ) : (
                              "AI will auto-detect"
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Features and Details + Original Value - Side by Side */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t pt-4">
                    {/* Features and Details */}
                    <div className="space-y-4">
                      <h3 className="font-medium">Features and Details</h3>
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Textarea {...field} rows={4} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Original Value */}
                    <div className="space-y-4">
                      <h3 className="font-medium">Original Value</h3>
                      <FormField
                        control={form.control}
                        name="originalValue"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <div className="flex gap-1 w-full">
                                {ORIGINAL_VALUES.map((value) => (
                                  <Button
                                    key={value}
                                    type="button"
                                    variant="outline"
                                    className={`flex-1 h-9 px-1 text-xs rounded-full transition-all ${
                                      field.value === value
                                        ? "bg-[#0DCEA1] hover:bg-[#0bb88f] text-black border-[#0DCEA1]"
                                        : "bg-white hover:bg-gray-50"
                                    }`}
                                    onClick={() => field.onChange(value)}
                                  >
                                    {value}
                                  </Button>
                                ))}
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* Question 3: Condition - 4 Options */}
                  <div className="space-y-4 border-t pt-4">
                    <h3 className="font-medium">Condition</h3>
                    <FormField
                      control={form.control}
                      name="condition"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {CONDITIONS.map((cond) => (
                                <Button
                                  key={cond}
                                  type="button"
                                  variant="outline"
                                  className={`h-12 flex flex-col items-center justify-center transition-all ${
                                    field.value === cond
                                      ? "bg-[#0DCEA1] hover:bg-[#0bb88f] text-black border-[#0DCEA1]"
                                      : "bg-white hover:bg-gray-50"
                                  }`}
                                  onClick={() => {
                                    field.onChange(cond);
                                    const ratingMap: Record<string, number> = {
                                      "New / Like New": 10,
                                      Good: 7,
                                      Fair: 5,
                                      "Well Loved": 3,
                                    };
                                    form.setValue(
                                      "conditionRating",
                                      ratingMap[cond] || 5,
                                    );
                                  }}
                                >
                                  <span className="text-sm font-medium">
                                    {cond}
                                  </span>
                                </Button>
                              ))}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Tier Preview - show after condition and value are selected */}
                  <div className="border-t pt-4">
                    {calculatedTier && (
                      <TooltipProvider>
                        <div
                          className={`p-4 bg-white rounded-lg border border-teal-200 transition-all duration-500 ${
                            tierGlow
                              ? "ring-2 ring-teal-400 ring-offset-2 shadow-[0_0_15px_rgba(13,206,161,0.5)]"
                              : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-black font-medium">
                                {TIER_NAMES[calculatedTier]}
                              </span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Sparkles className="h-4 w-4 text-teal-500 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-sm font-medium mb-1">
                                    AI-Powered Valuation
                                  </p>
                                  <p className="text-xs">
                                    {valuationResult?.reasoning ||
                                      "AI analyzes condition, brand quality, category demand, and seasonal factors to determine the exact rate."}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            {valuationResult && !isLoadingValuation && (
                              <div className="flex items-center gap-1.5 bg-teal-50 px-3 py-1 rounded-full">
                                <Sparkles className="h-3.5 w-3.5 text-teal-600" />
                                <span className="text-xs text-teal-700 font-medium">
                                  AI valued
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="mt-2">
                            {valuationResult && !isLoadingValuation ? (
                              <div className="flex items-center gap-1.5 text-sm">
                                <Coins className="h-5 w-5 text-teal-600" />
                                <span className="font-semibold text-teal-700 text-lg">
                                  {valuationResult.shareCoinsValue}{" "}
                                  ShareCoins/week
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-sm">
                                {isLoadingValuation && (
                                  <div className="h-4 w-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                                )}
                                <Coins className="h-5 w-5 text-teal-600" />
                                <span className="font-medium text-teal-700">
                                  {TIER_WEEKLY_BANDS[calculatedTier]?.display ||
                                    "5"}{" "}
                                  ShareCoins/week
                                </span>
                                {isLoadingValuation && (
                                  <span className="text-gray-400 text-xs">
                                    (calculating...)
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </TooltipProvider>
                    )}
                  </div>

                  {/* Location field */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">Location</h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowLocationModal(true)}
                        className="flex items-center gap-2"
                      >
                        <MapPin className="h-4 w-4" />
                        {watchPostalCode ? watchPostalCode : "Set Location"}
                      </Button>
                    </div>
                  </div>

                  {/* Sharing options */}
                  <div className="space-y-3 border-t pt-4">
                    <h3 className="font-medium">Neighbours can</h3>
                    <div className="grid grid-cols-4 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className={`h-10 rounded-full flex items-center justify-center gap-2 transition-all ${watchIsLendable ? "bg-[#0DCEA1] hover:bg-[#0bb88f] text-black border-[#0DCEA1]" : "bg-white hover:bg-gray-50"} ${watchIsGift ? "opacity-50 cursor-not-allowed" : ""}`}
                        disabled={watchIsGift}
                        onClick={() => {
                          if (!watchIsGift) {
                            form.setValue("isLendable", !watchIsLendable);
                          }
                        }}
                      >
                        <HandHeart className="h-4 w-4" />
                        <span className="text-sm font-medium">Borrow It</span>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className={`h-10 rounded-full flex items-center justify-center gap-2 transition-all ${watchIsRentable ? "bg-[#0DCEA1] hover:bg-[#0bb88f] text-black border-[#0DCEA1]" : "bg-white hover:bg-gray-50"} ${watchIsGift ? "opacity-50 cursor-not-allowed" : ""}`}
                        disabled={watchIsGift}
                        onClick={() => {
                          if (!watchIsGift) {
                            form.setValue("isRentable", !watchIsRentable);
                          }
                        }}
                      >
                        <DollarSign className="h-4 w-4" />
                        <span className="text-sm font-medium">Rent It</span>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className={`h-10 rounded-full flex items-center justify-center gap-2 transition-all ${watchIsSwappable ? "bg-[#0DCEA1] hover:bg-[#0bb88f] text-black border-[#0DCEA1]" : "bg-white hover:bg-gray-50"} ${watchIsGift ? "opacity-50 cursor-not-allowed" : ""}`}
                        disabled={watchIsGift}
                        onClick={() => {
                          if (!watchIsGift) {
                            form.setValue("isSwappable", !watchIsSwappable);
                          }
                        }}
                      >
                        <ArrowLeftRight className="h-4 w-4" />
                        <span className="text-sm font-medium">Swap It</span>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className={`h-10 rounded-full flex items-center justify-center gap-2 transition-all ${watchIsGift ? "bg-pink-500 hover:bg-pink-600 text-white border-pink-500" : "bg-white hover:bg-gray-50"}`}
                        onClick={() => {
                          const newGiftValue = !watchIsGift;
                          form.setValue("isGift", newGiftValue);
                          if (newGiftValue) {
                            form.setValue("isLendable", false);
                            form.setValue("isRentable", false);
                            form.setValue("isSwappable", false);
                          }
                        }}
                      >
                        <Gift className="h-4 w-4" />
                        <span className="text-sm font-medium">Have It</span>
                      </Button>
                    </div>
                    <p className="text-sm text-gray-400">
                      Select one or more options
                    </p>

                    {/* Borrow, Rental, and Swap Cards - show side by side when selected */}
                    {(watchIsLendable || watchIsRentable || watchIsSwappable) &&
                      calculatedTier && (
                        <div className="mt-4 grid grid-cols-4 gap-2">
                          {/* Borrow Card - Column 1 */}
                          {watchIsLendable && (
                            <div className="p-3 bg-gradient-to-r from-teal-50 to-emerald-50 rounded-lg border border-teal-100 col-start-1">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <Coins className="h-4 w-4 text-teal-600" />
                                <span className="text-xs text-teal-700">
                                  Borrow Rate
                                </span>
                              </div>
                              <div className="text-sm font-semibold text-gray-800">
                                {valuationResult ? (
                                  <>{valuationResult.shareCoinsValue}</>
                                ) : isLoadingValuation ? (
                                  <span className="text-gray-500">...</span>
                                ) : (
                                  <>
                                    {
                                      TIER_WEEKLY_BANDS[calculatedTier]
                                        .display
                                    }
                                  </>
                                )}
                                <span className="font-normal text-teal-700">
                                  {" "}
                                  ShareCoins/week
                                </span>
                              </div>
                              {(() => {
                                // Show base deposit without discount - owner doesn't get discount on their own item
                                const depositCalc = calculateSecurityDeposit(
                                  calculatedTier,
                                  watchOriginalValue,
                                  0, // No trust score applied for owner's own item
                                );
                                return (
                                  <div className="mt-2 pt-2 border-t border-teal-100">
                                    <div className="text-xs font-medium text-gray-700">
                                      Trust-Based Deposit:
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <span className="text-gray-500">$</span>
                                      <span className="text-sm font-semibold text-gray-800">
                                        {Math.round(depositCalc.baseDeposit)}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      Borrowers may see lower deposits based on their trust score
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Rental Card - Column 2 */}
                          {watchIsRentable && (
                            <div className="p-3 bg-gradient-to-r from-emerald-50 to-green-50 rounded-lg border border-emerald-100 col-start-2">
                              {(() => {
                                const getEstimatedValue = () => {
                                  if (valuationResult?.internalItemValue) {
                                    return valuationResult.internalItemValue;
                                  }
                                  const valueMap: Record<string, number> = {
                                    "Under $50": 30,
                                    "$50–$150": 100,
                                    "$150–$300": 225,
                                    "$300+": 500,
                                  };
                                  return valueMap[watchOriginalValue] || 100;
                                };

                                const itemValue = getEstimatedValue();
                                const rentalCalc = calculateRentalRate(
                                  itemValue,
                                  watchItemType || "",
                                );
                                const depositCalc = calculateRentalDeposit(
                                  itemValue,
                                  calculatedTier,
                                );
                                const displayRate =
                                  customRentalRate !== null
                                    ? customRentalRate
                                    : rentalCalc.weeklyRate;
                                const displayDeposit =
                                  customRentalDeposit !== null
                                    ? customRentalDeposit
                                    : depositCalc.deposit;

                                const handleRateChange = (newRate: number) => {
                                  setCustomRentalRate(newRate);
                                };

                                const handleDepositChange = (
                                  newDeposit: number,
                                ) => {
                                  setCustomRentalDeposit(
                                    Math.max(0, newDeposit),
                                  );
                                };

                                return (
                                  <>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <DollarSign className="h-4 w-4 text-emerald-600" />
                                      <span className="text-xs text-emerald-700">
                                        Rental Rate
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-gray-500">$</span>
                                      <input
                                        type="number"
                                        min="1"
                                        value={displayRate}
                                        onChange={(e) =>
                                          handleRateChange(
                                            Math.max(
                                              1,
                                              parseInt(e.target.value) || 1,
                                            ),
                                          )
                                        }
                                        className="w-16 text-sm font-semibold text-gray-800 border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                      />
                                      <span className="text-xs text-gray-500">
                                        /week
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      AI suggested: ${rentalCalc.weeklyRate}
                                      /week
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-emerald-100">
                                      <div className="text-xs font-medium text-gray-700">
                                        Security Deposit:
                                      </div>
                                      <div className="flex items-center gap-1 mt-0.5">
                                        <span className="text-gray-500">$</span>
                                        <input
                                          type="number"
                                          min="0"
                                          step="1"
                                          value={displayDeposit}
                                          onChange={(e) =>
                                            handleDepositChange(
                                              parseInt(e.target.value) || 0,
                                            )
                                          }
                                          className="w-20 text-sm font-semibold text-gray-800 border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                        />
                                      </div>
                                      <div className="text-[10px] text-gray-400 mt-0.5">
                                        AI suggested: ${depositCalc.deposit}
                                      </div>
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-emerald-100">
                                      <div className="flex justify-between text-xs">
                                        <span className="text-gray-600">
                                          Platform fee:
                                        </span>
                                        <span className="font-medium text-emerald-600">
                                          0% for 2025
                                        </span>
                                      </div>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          )}

                          {/* Swap Card - Column 3 */}
                          {watchIsSwappable && (
                            <div className="p-3 bg-gradient-to-r from-[#E6FBF5] to-teal-50 rounded-lg border border-[#0DCEA1]/20 col-start-3">
                              {(() => {
                                const tierSC =
                                  getTierShareCoins(calculatedTier);

                                return (
                                  <>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <ArrowLeftRight className="h-4 w-4 text-[#0DCEA1]" />
                                      <span className="text-xs text-[#0BB88C]">
                                        Swap Value
                                      </span>
                                    </div>
                                    <TooltipProvider delayDuration={0}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className="text-sm font-semibold text-gray-800 cursor-help flex items-center gap-1">
                                            Tier {calculatedTier} Item
                                            <Info className="h-3 w-3 text-gray-400" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side="top"
                                          className="p-0 border-0 bg-transparent shadow-none"
                                        >
                                          <div className="bg-[#E6FBF5] border border-[#0DCEA1]/30 rounded-md p-2 text-xs text-[#0BB88C]">
                                            <Info className="h-3 w-3 inline mr-1" />
                                            Swaps allow same-tier or ±1 tier
                                            items, with ShareCoins balancing the
                                            difference.
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                  </div>

                  {/* Availability Period - Hide when Have It (gift) is selected */}
                  {!watchIsGift && (
                    <div className="space-y-4 border-t pt-4">
                      <h3 className="font-medium">Availability Period</h3>

                      {/* Quick-select Buttons - all in 1 row, full width */}
                      <div className="flex gap-2 w-full">
                        <Button
                          type="button"
                          variant={
                            availabilityOption === "indefinitely"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            setAvailabilityOption("indefinitely");
                            form.setValue("availableFromDate", undefined);
                            form.setValue("availableToDate", undefined);
                          }}
                        >
                          Indefinitely
                        </Button>

                        <Button
                          type="button"
                          variant={
                            availabilityOption === "1month"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            setAvailabilityOption("1month");
                            const today = new Date();
                            const endDate = new Date(today);
                            endDate.setMonth(endDate.getMonth() + 1);
                            form.setValue(
                              "availableFromDate",
                              today.toISOString().split("T")[0],
                            );
                            form.setValue(
                              "availableToDate",
                              endDate.toISOString().split("T")[0],
                            );
                          }}
                        >
                          1 month
                        </Button>

                        <Button
                          type="button"
                          variant={
                            availabilityOption === "3months"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            setAvailabilityOption("3months");
                            const today = new Date();
                            const endDate = new Date(today);
                            endDate.setMonth(endDate.getMonth() + 3);
                            form.setValue(
                              "availableFromDate",
                              today.toISOString().split("T")[0],
                            );
                            form.setValue(
                              "availableToDate",
                              endDate.toISOString().split("T")[0],
                            );
                          }}
                        >
                          3 months
                        </Button>

                        <Button
                          type="button"
                          variant={
                            availabilityOption === "6months"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            setAvailabilityOption("6months");
                            const today = new Date();
                            const endDate = new Date(today);
                            endDate.setMonth(endDate.getMonth() + 6);
                            form.setValue(
                              "availableFromDate",
                              today.toISOString().split("T")[0],
                            );
                            form.setValue(
                              "availableToDate",
                              endDate.toISOString().split("T")[0],
                            );
                          }}
                        >
                          6 months
                        </Button>

                        <Button
                          type="button"
                          variant={
                            availabilityOption === "1year"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            setAvailabilityOption("1year");
                            const today = new Date();
                            const endDate = new Date(today);
                            endDate.setFullYear(endDate.getFullYear() + 1);
                            form.setValue(
                              "availableFromDate",
                              today.toISOString().split("T")[0],
                            );
                            form.setValue(
                              "availableToDate",
                              endDate.toISOString().split("T")[0],
                            );
                          }}
                        >
                          1 year
                        </Button>
                      </div>

                      {/* Custom Option - Less Prominent */}
                      <Button
                        type="button"
                        variant={
                          availabilityOption === "custom" ? "default" : "ghost"
                        }
                        size="sm"
                        className="w-full text-muted-foreground text-xs mt-1"
                        onClick={() => setAvailabilityOption("custom")}
                      >
                        Custom dates
                      </Button>

                      {/* Custom Date Inputs - Only show when custom is selected */}
                      {availabilityOption === "custom" && (
                        <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg border">
                          <FormField
                            control={form.control}
                            name="availableFromDate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Available From</FormLabel>
                                <FormControl>
                                  <Input
                                    type="date"
                                    {...field}
                                    value={field.value || ""}
                                    placeholder="Select start date"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="availableToDate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Available Until</FormLabel>
                                <FormControl>
                                  <Input
                                    type="date"
                                    {...field}
                                    value={field.value || ""}
                                    placeholder="Select end date"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}

                      {selectedWishlistMatch && (
                        <div className="p-3 bg-teal-50 rounded-lg border border-teal-200">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-5 w-5 text-teal-500" />
                            <span className="text-teal-800 font-medium">
                              Dates automatically matched to{" "}
                              {selectedWishlistMatch.username}'s request
                            </span>
                          </div>
                          <p className="text-teal-700 text-sm mt-1">
                            Needed:{" "}
                            {selectedWishlistMatch.neededDate
                              ? new Date(
                                  selectedWishlistMatch.neededDate,
                                ).toLocaleDateString()
                              : "Not specified"}{" "}
                            - Return:{" "}
                            {selectedWishlistMatch.returnDate
                              ? new Date(
                                  selectedWishlistMatch.returnDate,
                                ).toLocaleDateString()
                              : "Not specified"}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Photos */}
            <div className="lg:col-span-1">
              <Card className="sticky top-8">
                <CardContent className="pt-6">
                  <h3 className="font-medium mb-2">Photos</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Minimum 1 photo required. AI needs it to valuate your item
                    more accurately.
                  </p>
                  <Tabs
                    value={uploadMethod}
                    onValueChange={(v) =>
                      setUploadMethod(v as "smartscan" | "manual")
                    }
                  >
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="smartscan">✨ SmartScan</TabsTrigger>
                      <TabsTrigger value="manual">Manual Upload</TabsTrigger>
                    </TabsList>

                    <TabsContent value="smartscan" className="mt-4">
                      <SmartScan onAnalysisComplete={handleSmartScanComplete} />
                    </TabsContent>

                    <TabsContent value="manual" className="mt-4">
                      {selectedPhotos.length === 0 ? (
                        <div className="border-2 border-dashed rounded-lg p-6 text-center">
                          <Input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            id="photos"
                            onChange={handlePhotoChange}
                          />
                          <label htmlFor="photos">
                            <div className="cursor-pointer">
                              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                              <p className="text-sm text-muted-foreground">
                                Click to upload photos
                              </p>
                            </div>
                          </label>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-sm text-green-600">
                            <Check className="w-4 h-4" />
                            <span>
                              {selectedPhotos.length} photo
                              {selectedPhotos.length > 1 ? "s" : ""} added
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {selectedPhotos.map((photo, idx) => (
                              <div
                                key={idx}
                                className="relative group w-16 h-16"
                              >
                                <img
                                  src={getPhotoPreviewUrl(photo)}
                                  alt={`Photo ${idx + 1}`}
                                  className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                                />
                                <div className="absolute inset-0 bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <button
                                    type="button"
                                    onClick={() => removePhoto(idx)}
                                    className="p-1 bg-white rounded-full hover:bg-gray-100"
                                  >
                                    <X className="w-3 h-3 text-gray-700" />
                                  </button>
                                </div>
                                {idx === 0 && (
                                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                                    <Check className="w-2.5 h-2.5 text-white" />
                                  </div>
                                )}
                              </div>
                            ))}
                            <label
                              htmlFor="photos-add"
                              className="w-16 h-16 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-teal-400 hover:bg-teal-50 transition-colors"
                            >
                              <Plus className="w-5 h-5 text-gray-400" />
                            </label>
                            <Input
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              id="photos-add"
                              onChange={handlePhotoChange}
                            />
                          </div>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>

                  {smartScanPhotos.length > 0 && (
                    <div className="p-3 bg-teal-50 rounded-lg border border-teal-200 mt-4">
                      <p className="text-sm text-teal-700">
                        ✨ SmartScan detected {smartScanPhotos.length} photos -
                        form auto-filled!
                      </p>
                    </div>
                  )}

                  {/* Show existing photos when editing */}
                  {isEditMode &&
                    existingPhotos.length > 0 &&
                    selectedPhotos.length === 0 && (
                      <div className="mt-4">
                        <p className="text-sm text-muted-foreground mb-2">
                          Current photos:
                        </p>
                        <div className="flex gap-2 flex-wrap">
                          {existingPhotos.map((photo, idx) => (
                            <img
                              key={idx}
                              src={photo}
                              alt={`Item photo ${idx + 1}`}
                              className="w-20 h-20 object-cover rounded-lg border"
                            />
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Upload new photos to replace these
                        </p>
                      </div>
                    )}
                </CardContent>
              </Card>
            </div>

            {/* Submit Button - Same Width as Card Above */}
            <div className="lg:col-span-2">
              <Button
                type="submit"
                className="w-full"
                disabled={
                  isEditMode
                    ? updateItemMutation.isPending
                    : createItemMutation.isPending
                }
              >
                {isEditMode
                  ? updateItemMutation.isPending
                    ? "Updating..."
                    : "Update Item"
                  : createItemMutation.isPending
                    ? "Listing..."
                    : "List Item"}
              </Button>
            </div>
          </form>
        </Form>

        {showLocationModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg w-full max-w-md">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">Change location</h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowLocationModal(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-muted-foreground">
                      Search by city, neighbourhood or ZIP code.
                    </label>
                    <Input
                      value={form.getValues("postalCode")}
                      onChange={(e) =>
                        form.setValue("postalCode", e.target.value)
                      }
                      placeholder="Enter location"
                      className="mt-1"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={getCurrentLocation}
                    disabled={isLoadingLocation}
                    className="w-full"
                  >
                    <MapPin className="h-4 w-4 mr-2" />
                    {isLoadingLocation
                      ? "Getting Location..."
                      : "Use Current Location"}
                  </Button>
                </div>
                <Button
                  className="w-full mt-6"
                  onClick={() => setShowLocationModal(false)}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Wishlist Matching Modal - Dating App Style */}
        <AnimatePresence>
          {showMatchingModal && matchedWishlists.length > 0 && (
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Floating Hearts Animation */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {[...Array(12)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute text-pink-400"
                    initial={{
                      x: Math.random() * window.innerWidth,
                      y: window.innerHeight + 50,
                      rotate: Math.random() * 360,
                      scale: 0.5 + Math.random() * 0.5,
                    }}
                    animate={{
                      y: -100,
                      rotate: Math.random() * 360,
                    }}
                    transition={{
                      duration: 3 + Math.random() * 2,
                      repeat: Infinity,
                      delay: Math.random() * 2,
                      ease: "linear",
                    }}
                  >
                    <Heart className="h-6 w-6 fill-current" />
                  </motion.div>
                ))}
              </div>

              <motion.div
                className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden"
                initial={{ scale: 0.8, opacity: 0, y: 50 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.8, opacity: 0, y: 50 }}
                transition={{ type: "spring", damping: 20, stiffness: 300 }}
              >
                {/* Header with gradient */}
                <div className="bg-gradient-to-r from-pink-500 via-rose-500 to-red-500 p-6 text-white text-center relative overflow-hidden">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 text-white hover:bg-white/20"
                    onClick={() => {
                      setShowMatchingModal(false);
                      toast({
                        title: "Successfully Listed!",
                        description: `Your item has been added to ShareChest.`,
                      });
                      navigate("/borrow");
                    }}
                  >
                    <X className="h-5 w-5" />
                  </Button>

                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.2, damping: 10 }}
                    className="mb-3"
                  >
                    <div className="w-16 h-16 bg-white/20 backdrop-blur rounded-full flex items-center justify-center mx-auto">
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      >
                        <Heart className="h-8 w-8 text-white fill-white" />
                      </motion.div>
                    </div>
                  </motion.div>

                  <motion.h2
                    className="text-2xl font-bold"
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    It's a Match!
                  </motion.h2>
                </div>

                {/* Match Card */}
                <div className="p-6">
                  {selectedWishlistMatch && (
                    <motion.div
                      initial={{ y: 30, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.5 }}
                      className="border-2 border-teal-400 bg-gradient-to-br from-teal-50 to-white rounded-xl p-4 shadow-lg"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="font-bold text-lg text-gray-900">
                          {selectedWishlistMatch.itemName}
                        </h3>
                        <motion.div
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 0.5, repeat: 2 }}
                        >
                          <CheckCircle className="h-5 w-5 text-teal-500" />
                        </motion.div>
                      </div>

                      <p className="text-gray-600 text-sm mb-4">
                        {selectedWishlistMatch.description}
                      </p>

                      {/* Name, location, and date on same row */}
                      <div className="flex items-center flex-wrap gap-3 text-sm text-gray-600 mb-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-gradient-to-r from-teal-400 to-teal-500 rounded-full flex items-center justify-center">
                            <span className="text-white font-bold text-sm">
                              {selectedWishlistMatch.username
                                ?.charAt(0)
                                .toUpperCase()}
                            </span>
                          </div>
                          <span className="font-medium">
                            {selectedWishlistMatch.username}
                          </span>
                        </div>
                        <span className="flex items-center gap-1 text-gray-500">
                          <MapPin className="h-4 w-4" />
                          {selectedWishlistMatch.distance}
                        </span>
                        {selectedWishlistMatch.neededDate && (
                          <span className="flex items-center gap-1 text-teal-600">
                            <Calendar className="h-4 w-4" />
                            <span className="font-medium">
                              {new Date(
                                selectedWishlistMatch.neededDate,
                              ).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                              {selectedWishlistMatch.returnDate &&
                                ` - ${new Date(selectedWishlistMatch.returnDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                            </span>
                          </span>
                        )}
                      </div>

                      {/* ShareCoins reward */}
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">🪙</span>
                        <span
                          style={{ color: "#0D9488" }}
                          className="font-semibold"
                        >
                          Earn 10-20 ShareCoins for helping!
                        </span>
                      </div>
                    </motion.div>
                  )}

                  {/* Action Buttons */}
                  <motion.div
                    className="flex gap-3 mt-6"
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.6 }}
                  >
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedWishlistMatch(null);
                        setShowMatchingModal(false);
                        toast({
                          title: "Successfully Listed!",
                          description: `Your item has been added to ShareChest.`,
                        });
                        navigate("/borrow");
                      }}
                      className="flex-1 h-12 text-gray-600 border-gray-300 hover:bg-gray-50"
                    >
                      Skip Matching
                    </Button>
                    <motion.div
                      className="flex-1"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Button
                        onClick={async () => {
                          // Create the auto-match connection
                          if (listedItemData && selectedWishlistMatch) {
                            try {
                              await apiRequest("POST", "/api/auto-match", {
                                itemId: listedItemData.id,
                                wishlistId: selectedWishlistMatch.id,
                                lenderUserId: listedItemData.userId,
                                borrowerUserId: selectedWishlistMatch.userId,
                              });
                              toast({
                                title: "🎉 It's a Match!",
                                description: `Your ${form.getValues("name")} has been matched with ${selectedWishlistMatch.username}'s request!`,
                              });
                            } catch (error) {
                              toast({
                                title: "Successfully Listed!",
                                description: `Your item has been added to ShareChest.`,
                              });
                            }
                          }
                          setShowMatchingModal(false);
                          navigate("/borrow");
                        }}
                        className="w-full h-12 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white font-semibold shadow-lg"
                      >
                        Match with {selectedWishlistMatch?.username}
                      </Button>
                    </motion.div>
                  </motion.div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Wishlist Fulfillment Popup - shown after successful listing */}
      <WishlistFulfillmentPopup
        isOpen={showWishlistFulfillmentPopup}
        onClose={() => {
          setShowWishlistFulfillmentPopup(false);
          navigate("/borrow");
        }}
      />
    </div>
  );
}
