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
import { formatDisplayName } from "@/lib/utils";
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
  Bell,
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
import { Switch } from "@/components/ui/switch";
import { motion, AnimatePresence } from "framer-motion";
import { useVerification } from "@/hooks/use-verification";

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
  5: "Tier 5 – Luxury Item",
  6: "Tier 6 – Ultra Luxury",
};

const TIER_WEEKLY_BANDS: Record<
  number,
  { min: number; max: number; display: string }
> = {
  1: { min: 5, max: 5, display: "5" },
  2: { min: 10, max: 10, display: "10" },
  3: { min: 20, max: 20, display: "20" },
  4: { min: 40, max: 40, display: "40" },
  5: { min: 80, max: 80, display: "80" },
  6: { min: 150, max: 150, display: "150" },
};

const calculateTier = (originalValue: string, condition: string): number => {
  let baseTier = 1;
  if (originalValue === "Under $50") baseTier = 1;
  else if (originalValue === "$50–$150") baseTier = 2;
  else if (originalValue === "$150–$300") baseTier = 3;
  else if (originalValue === "$300–$1,000") baseTier = 4;
  else if (originalValue === "$1,000–$5,000") baseTier = 5;
  else if (originalValue === "$5,000+") baseTier = 6;
  else if (originalValue === "$300+") baseTier = 4; // Legacy support

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
    isLendable: z.boolean().default(true),
    isSwappable: z.boolean().default(false),
    isRentable: z.boolean().default(false),
    isGift: z.boolean().default(false),
    swapDesiredItem: z.string().optional(),
    swapNotifyOnMatch: z.boolean().default(false),
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
  const { requireVerification, VerificationModal } = useVerification();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const editItemId = searchParams.get("edit");
  const prefillItemName = searchParams.get("prefill");
  const isEditMode = !!editItemId;

  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [detectedLocality, setDetectedLocality] = useState<string>("");
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
  const [showMatchConfirmation, setShowMatchConfirmation] = useState(false);
  const [matchedRequesterName, setMatchedRequesterName] = useState("");
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
      isLendable: true,
      isSwappable: false,
      isRentable: false,
      isGift: false,
      swapDesiredItem: "",
      swapNotifyOnMatch: false,
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
        swapDesiredItem: item.swapDesiredItem || "",
        swapNotifyOnMatch: item.swapNotifyOnMatch || false,
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
      // If we have coordinates but no address, reverse geocode to get the address
      if (lat && lng && !item.address) {
        (async () => {
          try {
            const response = await fetch(
              `https://api-bdc.net/data/reverse-geocode?latitude=${lat}&longitude=${lng}&localityLanguage=en&key=bdc_4ab1a85e94d34be09afcd6d3c03f8bd3`
            );
            if (response.ok) {
              const data = await response.json();
              const postcode = data.postcode || "";
              const locality = data.locality || data.city || "";
              if (postcode) {
                form.setValue("postalCode", postcode);
              }
              if (locality) {
                setDetectedLocality(locality);
              }
            }
          } catch (e) {
            console.log("Reverse geocoding for edit failed");
          }
        })();
      }
    }
  }, [editItem, isEditMode]);

  // Pre-fill item name when coming from wishlist "I Have This Item!" button
  useEffect(() => {
    if (prefillItemName && !isEditMode) {
      form.setValue("name", prefillItemName);
      // Also detect the item category for prefilled names
      detectItemCategory(prefillItemName);
    }
  }, [prefillItemName, isEditMode]);

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

    // Auto-fill value range if AI suggested one (especially important for luxury items)
    if (
      analysis.suggestedValueRange &&
      ORIGINAL_VALUES.includes(analysis.suggestedValueRange)
    ) {
      form.setValue("originalValue", analysis.suggestedValueRange);
    } else if (analysis.isLuxuryBrand && analysis.estimatedValue) {
      // If luxury brand detected, auto-select appropriate tier based on estimated value
      const value = parseFloat(analysis.estimatedValue);
      if (value >= 5000) {
        form.setValue("originalValue", "$5,000+");
      } else if (value >= 1000) {
        form.setValue("originalValue", "$1,000–$5,000");
      } else if (value >= 300) {
        form.setValue("originalValue", "$300–$1,000");
      }
    }

    setSmartScanPhotos(photos);
    setSmartScanAnalysis(analysis); // Store full analysis for submission

    toast({
      title: "✨ Form Auto-Filled!",
      description: analysis.isLuxuryBrand
        ? "Luxury brand detected! Value range auto-selected. Review and adjust as needed."
        : "Review and adjust the AI-detected details as needed.",
    });
  };

  const getCurrentLocation = async () => {
    setIsLoadingLocation(true);

    let latitude: number | null = null;
    let longitude: number | null = null;
    let postcode: string | null = null;
    let locality: string | null = null;
    let region: string | null = null;

    // Step 1: Try IP-based geolocation first (works without permissions)
    try {
      const ipResponse = await fetch(
        "https://api.bigdatacloud.net/data/reverse-geocode-client",
      );
      if (ipResponse.ok) {
        const ipData = await ipResponse.json();
        console.log("IP geolocation response:", ipData);

        if (ipData.latitude && ipData.longitude) {
          latitude = ipData.latitude;
          longitude = ipData.longitude;
        }
        postcode = ipData.postcode || null;
        locality = ipData.locality || ipData.city || null;
        region = ipData.principalSubdivision || null;
      }
    } catch (e) {
      console.log("IP-based geolocation failed, trying browser geolocation...");
    }

    // Step 2: Try browser geolocation if IP didn't give coordinates
    if (!latitude && !longitude && "geolocation" in navigator) {
      try {
        const position = await new Promise<GeolocationPosition>(
          (resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false,
              timeout: 30000,
              maximumAge: 600000,
            });
          },
        );
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
        console.log("Browser geolocation:", latitude, longitude);
      } catch (error: any) {
        console.log("Browser geolocation failed:", error?.code, error?.message);
      }
    }

    // Step 3: If we have coordinates but no postal code, try reverse geocoding
    if (latitude && longitude && !postcode) {
      try {
        const bdcResponse = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
        );
        if (bdcResponse.ok) {
          const bdcData = await bdcResponse.json();
          console.log("Reverse geocode response:", bdcData);
          postcode = bdcData.postcode || postcode;
          locality = bdcData.locality || bdcData.city || locality;
          region = bdcData.principalSubdivision || region;
        }
      } catch (e) {
        console.log("Reverse geocoding failed");
      }
    }

    // Step 4: Determine success - coordinates OR city/region is enough
    const hasCoordinates = latitude !== null && longitude !== null;
    const hasLocation = hasCoordinates || locality || region;

    if (hasLocation) {
      // Save coordinates if we have them
      if (hasCoordinates) {
        form.setValue("latitude", latitude!);
        form.setValue("longitude", longitude!);
      }

      // Save postal code if we have it (enhancement, not required)
      if (postcode) {
        form.setValue("postalCode", postcode);
      }

      // Save locality for display
      const displayLocality = locality || region || "";
      if (displayLocality) {
        setDetectedLocality(displayLocality);
      }

      // No toast - auto-fill silently, UI shows the detected location
    } else {
      // Only show error if we truly have nothing (low confidence)
      toast({
        title: "Could Not Find Location",
        description: "Please enter your postal code manually.",
        variant: "destructive",
      });
    }

    setIsLoadingLocation(false);
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
      setListedItemData(data);
      if (matchedWishlists.length > 0) {
        setSelectedWishlistMatch(matchedWishlists[0]);
        setShowMatchingModal(true);
      } else {
        toast({
          title: "Successfully Listed!",
          description: "Your item has been added to the ShareChest.",
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

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setSelectedPhotos((prev) => [...prev, ...newFiles]);
      
      // Use FileReader for better iOS compatibility (data URLs instead of blob URLs)
      const readFileAsDataURL = (file: File): Promise<string> => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => resolve('');
          reader.readAsDataURL(file);
        });
      };
      
      const newUrls = await Promise.all(newFiles.map(readFileAsDataURL));
      setPhotoPreviewUrls((prev) => [...prev, ...newUrls]);
    }
  };

  const removePhoto = (index: number) => {
    setSelectedPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviewUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const watchIsLendable = form.watch("isLendable");
  const watchIsRentable = form.watch("isRentable");
  const watchIsSwappable = form.watch("isSwappable");
  const watchIsGift = form.watch("isGift");
  const watchPostalCode = form.watch("postalCode");

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />

      {/* Hero Section */}
      <div
        className="w-full relative -mt-[1px] bg-cover bg-bottom sm:bg-center rounded-b-[32px]"
        style={{
          backgroundImage: "url('/hero-banner.png')",
        }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4 pb-16 sm:py-10">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-1.5 sm:gap-6">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-3xl md:text-4xl font-bold mb-0 sm:mb-1 text-black">
                {isEditMode ? "Edit Your Item" : "List Your Item"}
              </h1>
              <p className="text-black/90 text-[11px] sm:text-base">
                {isEditMode
                  ? " "
                  : "Make your neighbourhood richer without spending a cent"}
              </p>
            </div>

            {!isEditMode && (
              <div className="flex flex-col gap-1 sm:gap-2 w-full md:w-80 md:max-w-80 flex-shrink-0">
                <div className="bg-white rounded-lg shadow-sm p-1.5 sm:p-3">
                  <div className="flex items-center gap-1 mb-1 sm:mb-2">
                    <Download className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5 text-teal-600" />
                    <h3 className="font-medium text-[9px] sm:text-xs text-black">
                      Transfer listings from other apps
                    </h3>
                  </div>
                  <div className="flex gap-1.5 sm:gap-2 mb-0.5 sm:mb-2">
                    <Input
                      placeholder="Paste listing URL..."
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      className="flex-1 min-w-0 text-[10px] sm:text-xs h-6 sm:h-9 px-1.5 sm:px-3"
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
                      className="text-white text-[10px] sm:text-xs h-6 sm:h-9 px-2 sm:px-4 shrink-0"
                      style={{ backgroundColor: "#0DCEA1" }}
                    >
                      {isImporting ? "..." : "Import"}
                    </Button>
                  </div>
                  <p className="text-[8px] sm:text-[10px] text-gray-400">
                    Facebook, Marketplace & Craigslist
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Inverted corner on bottom left - grey circle overlay creating cutout effect */}
        <div
          className="absolute bottom-0 left-0 w-6 h-6 sm:w-8 sm:h-8"
          style={{ borderTopRightRadius: "100%", backgroundColor: "#f3f4f6" }}
        />
      </div>

      <VerificationModal />
      <main className="max-w-7xl mx-auto px-4 pt-0 md:pt-4 pb-8">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => {
              if (isEditMode) {
                updateItemMutation.mutate(data);
              } else {
                createItemMutation.mutate(data);
              }
            })}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            {/* Left Column - Form Fields */}
            <div className="lg:col-span-2">
              <Card>
                <CardContent className="pt-6 space-y-6">
                  {/* Question 1: Item Name with Item Type inline */}
                  <div className="space-y-4">
                    <h3 className="font-medium">I'm Sharing my</h3>
                    <div className="flex flex-col sm:flex-row gap-3">
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
                      <div className="flex flex-col sm:w-48">
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
                        <p className="text-xs text-gray-400 mt-1">
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
                              <div className="grid grid-cols-4 gap-2">
                                {ORIGINAL_VALUES.map((value) => (
                                  <Button
                                    key={value}
                                    type="button"
                                    variant="outline"
                                    className={`h-10 px-2 text-xs rounded-full transition-all ${
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
                            <div className="grid grid-cols-4 gap-2">
                              {CONDITIONS.map((cond) => (
                                <Button
                                  key={cond}
                                  type="button"
                                  variant="outline"
                                  className={`h-auto min-h-[48px] md:h-12 py-2 px-2 flex flex-col items-center justify-center transition-all ${
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
                                  <span className="text-xs md:text-sm font-medium text-center whitespace-normal md:whitespace-nowrap">
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

                  {/* Mobile Photos Section - shown only on small screens */}
                  <div className="lg:hidden border-t pt-4">
                    <h3 className="font-medium mb-2">Photos</h3>
                    <p className="text-xs text-muted-foreground mb-4">
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
                        <TabsTrigger value="smartscan">
                          ✨ SmartScan
                        </TabsTrigger>
                        <TabsTrigger value="manual">Manual Upload</TabsTrigger>
                      </TabsList>
                      <TabsContent value="smartscan" className="mt-4">
                        <SmartScan
                          onAnalysisComplete={handleSmartScanComplete}
                        />
                      </TabsContent>
                      <TabsContent value="manual" className="mt-4">
                        {selectedPhotos.length === 0 ? (
                          <div className="border-2 border-dashed rounded-lg p-6 text-center">
                            <Input
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              id="photos-mobile"
                              onChange={handlePhotoChange}
                            />
                            <label htmlFor="photos-mobile">
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
                                    src={photoPreviewUrls[idx]}
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
                                htmlFor="photos-mobile-add"
                                className="w-16 h-16 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-teal-400 hover:bg-teal-50 transition-colors"
                              >
                                <Plus className="w-5 h-5 text-gray-400" />
                              </label>
                              <Input
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                id="photos-mobile-add"
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
                          ✨ SmartScan detected {smartScanPhotos.length} photos
                          - form auto-filled!
                        </p>
                      </div>
                    )}
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
                            <span className="text-black font-medium">
                              {TIER_NAMES[calculatedTier]}
                            </span>
                            {valuationResult && !isLoadingValuation && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1.5 bg-teal-50 px-3 py-1 rounded-full cursor-help">
                                    <Sparkles className="h-3.5 w-3.5 text-teal-600" />
                                    <span className="text-xs text-teal-700 font-medium">
                                      AI valued
                                    </span>
                                  </div>
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
                            )}
                          </div>
                          <div className="mt-2">
                            {valuationResult && !isLoadingValuation ? (
                              <div className="flex items-center gap-1.5 text-sm">
                                <Coins className="h-5 w-5 text-teal-600" />
                                <span className="font-semibold text-black-700 text-lg">
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
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Location</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowLocationModal(true)}
                      className="rounded-full h-8 px-3 text-sm"
                    >
                      <MapPin className="h-3.5 w-3.5 mr-1.5" />
                      {detectedLocality || watchPostalCode || "Set location"}
                    </Button>
                  </div>

                  {/* Sharing options */}
                  <div className="space-y-3 border-t pt-4">
                    <h3 className="font-medium">Neighbours can</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className={`h-10 rounded-full flex items-center justify-center gap-1.5 transition-all px-2 ${watchIsLendable ? "bg-[#0DCEA1] hover:bg-[#0bb88f] text-black border-[#0DCEA1]" : "bg-white hover:bg-gray-50"} ${watchIsGift ? "opacity-50 cursor-not-allowed" : ""}`}
                        disabled={watchIsGift}
                        onClick={() => {
                          if (!watchIsGift) {
                            form.setValue("isLendable", !watchIsLendable);
                          }
                        }}
                      >
                        <HandHeart className="h-4 w-4 shrink-0" />
                        <span className="text-xs sm:text-sm font-medium truncate">
                          Borrow It
                        </span>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className={`h-10 rounded-full flex items-center justify-center gap-1.5 transition-all px-2 ${watchIsRentable ? "bg-[#0DCEA1] hover:bg-[#0bb88f] text-black border-[#0DCEA1]" : "bg-white hover:bg-gray-50"} ${watchIsGift ? "opacity-50 cursor-not-allowed" : ""}`}
                        disabled={watchIsGift}
                        onClick={() => {
                          if (!watchIsGift) {
                            form.setValue("isRentable", !watchIsRentable);
                          }
                        }}
                      >
                        <DollarSign className="h-4 w-4 shrink-0" />
                        <span className="text-xs sm:text-sm font-medium truncate">
                          Rent It
                        </span>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className={`h-10 rounded-full flex items-center justify-center gap-1.5 transition-all px-2 ${watchIsSwappable ? "bg-[#0DCEA1] hover:bg-[#0bb88f] text-black border-[#0DCEA1]" : "bg-white hover:bg-gray-50"} ${watchIsGift ? "opacity-50 cursor-not-allowed" : ""}`}
                        disabled={watchIsGift}
                        onClick={() => {
                          if (!watchIsGift) {
                            form.setValue("isSwappable", !watchIsSwappable);
                          }
                        }}
                      >
                        <ArrowLeftRight className="h-4 w-4 shrink-0" />
                        <span className="text-xs sm:text-sm font-medium truncate">
                          Swap It
                        </span>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className={`h-10 rounded-full flex items-center justify-center gap-1.5 transition-all px-2 ${watchIsGift ? "bg-pink-500 hover:bg-pink-600 text-white border-pink-500" : "bg-white hover:bg-gray-50"}`}
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
                        <Gift className="h-4 w-4 shrink-0" />
                        <span className="text-xs sm:text-sm font-medium truncate">
                          Have It
                        </span>
                      </Button>
                    </div>
                    <p className="text-sm text-gray-400">
                      Select one or more options
                    </p>

                    {/* Borrow, Rental, and Swap Cards - show side by side when selected */}
                    {(watchIsLendable || watchIsRentable || watchIsSwappable) &&
                      calculatedTier && (
                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {/* Borrow Card */}
                          {watchIsLendable && (
                            <div className="p-3 bg-gradient-to-r from-teal-50 to-emerald-50 rounded-lg border border-teal-100">
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
                                    {TIER_WEEKLY_BANDS[calculatedTier].display}
                                  </>
                                )}
                                <span className="font-normal text-black">
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
                                      Deposit varies by borrower's trust score
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Rental Card */}
                          {watchIsRentable && (
                            <div className="p-3 bg-gradient-to-r from-emerald-50 to-green-50 rounded-lg border border-emerald-100">
                              {(() => {
                                const getEstimatedValue = () => {
                                  if (valuationResult?.internalItemValue) {
                                    return valuationResult.internalItemValue;
                                  }
                                  const valueMap: Record<string, number> = {
                                    "Under $50": 30,
                                    "$50–$150": 100,
                                    "$150–$300": 225,
                                    "$300–$1,000": 650,
                                    "$1,000–$5,000": 3000,
                                    "$5,000+": 10000,
                                    "$300+": 500, // Legacy support
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
                                          0% for 2026
                                        </span>
                                      </div>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          )}

                          {/* Swap Card */}
                          {watchIsSwappable && (
                            <div className="p-3 bg-gradient-to-r from-[#E6FBF5] to-teal-50 rounded-lg border border-[#0DCEA1]/20">
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

                                    {/* Swap Preferences */}
                                    <div className="mt-3 pt-3 border-t border-[#0DCEA1]/20 space-y-3">
                                      <div>
                                        <label className="block text-xs text-[#0BB88C] mb-1">
                                          What would you like to trade for?
                                        </label>
                                        <Input
                                          placeholder="e.g. baby monitor, stroller, or similar"
                                          className="text-sm h-9"
                                          {...form.register("swapDesiredItem")}
                                        />
                                        <p className="hidden md:block text-xs text-gray-500 mt-1">
                                          Tell neighbours what you're hoping to
                                          swap for
                                        </p>
                                      </div>

                                      <div className="flex items-start justify-between">
                                        <div className="flex items-start gap-2">
                                          <Bell className="h-4 w-4 text-[#0DCEA1] mt-0.5 shrink-0" />
                                          <span className="text-[13px] text-gray-700">
                                            Notify me of matching items
                                          </span>
                                        </div>
                                        <Switch
                                          checked={form.watch(
                                            "swapNotifyOnMatch",
                                          )}
                                          onCheckedChange={(checked) =>
                                            form.setValue(
                                              "swapNotifyOnMatch",
                                              checked,
                                            )
                                          }
                                        />
                                      </div>
                                    </div>
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

                      {/* Quick-select Buttons - responsive wrap */}
                      <div className="flex flex-wrap gap-2">
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

            {/* Right Column - Photos (Desktop only) */}
            <div className="hidden lg:block lg:col-span-1">
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
                                  src={photoPreviewUrls[idx]}
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
                              {formatDisplayName(selectedWishlistMatch.username)
                                ?.charAt(0)
                                .toUpperCase()}
                            </span>
                          </div>
                          <span className="font-medium">
                            {formatDisplayName(selectedWishlistMatch.username)}
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
                          Earn {(() => {
                            if (selectedWishlistMatch.neededDate && selectedWishlistMatch.returnDate) {
                              const startDate = new Date(selectedWishlistMatch.neededDate);
                              const endDate = new Date(selectedWishlistMatch.returnDate);
                              const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                              return 10 + Math.min(days, 10);
                            }
                            return 10;
                          })()} ShareCoins for helping!
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
                          // Send notification to wishlist owner
                          if (listedItemData && selectedWishlistMatch) {
                            try {
                              await apiRequest(
                                "POST",
                                "/api/wishlist-match-notification",
                                {
                                  itemId: listedItemData.id,
                                  wishlistId: selectedWishlistMatch.id,
                                  wishlistOwnerId: selectedWishlistMatch.userId,
                                },
                              );
                              // Show confirmation modal
                              setMatchedRequesterName(
                                formatDisplayName(selectedWishlistMatch.username) ||
                                  selectedWishlistMatch.firstName ||
                                  "this neighbour",
                              );
                              setShowMatchingModal(false);
                              setShowMatchConfirmation(true);
                            } catch (error) {
                              toast({
                                title: "Successfully Listed!",
                                description: `Your item has been added to ShareChest.`,
                              });
                              setShowMatchingModal(false);
                              navigate("/borrow");
                            }
                          }
                        }}
                        className="w-full h-12 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white font-semibold shadow-lg"
                      >
                        Match with {formatDisplayName(selectedWishlistMatch?.username)}
                      </Button>
                    </motion.div>
                  </motion.div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Match Confirmation Modal */}
        <AnimatePresence>
          {showMatchConfirmation && (
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden"
                initial={{ scale: 0.8, opacity: 0, y: 50 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.8, opacity: 0, y: 50 }}
                transition={{ type: "spring", damping: 20, stiffness: 300 }}
              >
                <div className="bg-gradient-to-r from-teal-500 to-teal-600 p-6 text-white text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.2, damping: 10 }}
                    className="mb-3"
                  >
                    <div className="w-16 h-16 bg-white/20 backdrop-blur rounded-full flex items-center justify-center mx-auto">
                      <CheckCircle className="h-8 w-8 text-white" />
                    </div>
                  </motion.div>
                  <h2 className="text-xl font-bold">Nice!</h2>
                  <p className="text-white/90 mt-1">
                    You matched with {matchedRequesterName}
                  </p>
                </div>

                <div className="p-6 text-center">
                  <p className="text-gray-600 mb-6">
                    We've let them know your item matches what they're looking
                    for. If they want it, they'll send you a request.
                  </p>
                  <Button
                    onClick={() => {
                      setShowMatchConfirmation(false);
                      navigate("/borrow");
                    }}
                    className="w-full h-12 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white font-semibold"
                  >
                    Got it
                  </Button>
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
          if (listedItemData?.id) {
            navigate(`/items/${listedItemData.id}`);
          } else {
            navigate("/borrow");
          }
        }}
      />
    </div>
  );
}
