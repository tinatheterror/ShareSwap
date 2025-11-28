import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
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
} from "lucide-react";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { SmartScan } from "@/components/smartscan";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion, AnimatePresence } from "framer-motion";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(10, "Please provide a detailed description"),
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
  postalCode: z.string().min(1, "Postal code is required"),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export default function LendPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [matchedWishlists, setMatchedWishlists] = useState<any[]>([]);
  const [showMatchingModal, setShowMatchingModal] = useState(false);
  const [selectedWishlistMatch, setSelectedWishlistMatch] = useState<any>(null);
  const [uploadMethod, setUploadMethod] = useState<"smartscan" | "manual">(
    "manual",
  );
  const [smartScanPhotos, setSmartScanPhotos] = useState<string[]>([]);
  const [importUrl, setImportUrl] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);
  const [availabilityOption, setAvailabilityOption] = useState<
    "indefinitely" | "1month" | "3months" | "6months" | "1year" | "custom"
  >("indefinitely");

  // Auto-detect location on page load if not already set
  useEffect(() => {
    const currentPostalCode = form.getValues("postalCode");
    if (!currentPostalCode && "geolocation" in navigator) {
      getCurrentLocation();
    }
  }, []);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      isLendable: false,
      isSwappable: false,
      isRentable: false,
      availableFromDate: undefined,
      availableToDate: undefined,
      securityDeposit: undefined,
      conditionRating: 10,
      postalCode: "",
      latitude: undefined,
      longitude: undefined,
    },
  });

  // Get all community wishlists for matching
  const { data: allWishlists = [] } = useQuery({
    queryKey: ["/api/all-wishlists"],
  });

  // Check for wishlist matches when item name changes (debounced to not interrupt typing)
  useEffect(() => {
    const itemName = form.watch("name");
    
    // Debounce: wait 600ms after user stops typing before showing match
    const timeoutId = setTimeout(() => {
      if (itemName && itemName.length >= 4 && Array.isArray(allWishlists)) {
        const matches = allWishlists.filter(
          (wishlist: any) =>
            wishlist.itemName.toLowerCase().includes(itemName.toLowerCase()) ||
            itemName.toLowerCase().includes(wishlist.itemName.toLowerCase()),
        );
        setMatchedWishlists(matches);

        if (matches.length > 0 && !showMatchingModal) {
          setShowMatchingModal(true);
          // Auto-select the first match
          setSelectedWishlistMatch(matches[0]);

          // Auto-fill dates from the first matching wishlist
          const firstMatch = matches[0];
          if (firstMatch.neededDate && firstMatch.returnDate) {
            form.setValue(
              "availableFromDate",
              firstMatch.neededDate.split("T")[0],
            );
            form.setValue("availableToDate", firstMatch.returnDate.split("T")[0]);
          }
        }
      } else {
        setMatchedWishlists([]);
      }
    }, 600);

    // Cleanup: cancel the timeout if user keeps typing
    return () => clearTimeout(timeoutId);
  }, [form.watch("name"), allWishlists, showMatchingModal]);

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
      const formData = new FormData();

      // Use SmartScan photos or manual uploads
      if (smartScanPhotos.length > 0 && smartScanAnalysis) {
        // SmartScan photos are already uploaded, pass their URLs
        formData.append("smartScanPhotos", JSON.stringify(smartScanPhotos));
        formData.append("wasSmartScanned", "true");

        // Include SmartScan analysis data
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

      const res = await apiRequest("POST", "/api/items", formData);
      const result = await res.json();

      // If there's a selected wishlist match, create automatic connection
      if (selectedWishlistMatch) {
        await apiRequest("POST", "/api/auto-match", {
          itemId: result.id,
          wishlistId: selectedWishlistMatch.id,
          lenderUserId: result.userId,
          borrowerUserId: selectedWishlistMatch.userId,
        });
      }

      return result;
    },
    onSuccess: (data) => {
      // Invalidate item queries to refresh lists
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nearby-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-items"] });

      if (selectedWishlistMatch) {
        toast({
          title: "Item matched successfully!",
          description: `Your ${form.getValues("name")} has been automatically matched with ${selectedWishlistMatch.username}'s request!`,
        });
      } else {
        toast({
          title: "Successfully Listed!",
          description: `Your item has been added to ShareChest. You'll earn ${data.shareCoinsReward} ShareCoins for this listing.`,
        });
      }
      navigate("/borrow");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to list item",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedPhotos(Array.from(e.target.files));
    }
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
        style={{ backgroundColor: "#0DCEA1", borderBottomRightRadius: "32px" }}
      >
        <div className="max-w-7xl mx-auto px-4 py-12 pb-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div className="flex-1">
              <h1 className="text-4xl font-bold mb-3 text-black">
                List Your Item
              </h1>
              <p className="text-black/90">
                Make your neighbourhood richer without spending a cent
              </p>
            </div>

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
                <p className="text-[10px] text-gray-400">
                  Facebook groups, marketplace & Craigslist
                </p>
              </div>
            </div>
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
              createItemMutation.mutate(data),
            )}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            {/* Left Column - Form Fields */}
            <div className="lg:col-span-2">
              <Card>
                <CardContent className="pt-6 space-y-6">
                  {/* Item Name */}
                  <div className="space-y-4 border-t pt-4">
                    <h3 className="font-medium">I'm Sharing my </h3>
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Features and Details */}
                  <div className="space-y-4 border-t pt-4">
                    <h3 className="font-medium">Features and Details</h3>
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Condition Rating - Moved below Features and Details */}
                  <div className="space-y-4 border-t pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">Condition Rating (1-10)</h3>
                      <span className="text-sm font-semibold text-gray-700">
                        Rating: {form.watch("conditionRating")}/10
                      </span>
                    </div>
                    <FormField
                      control={form.control}
                      name="conditionRating"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Slider
                              value={[field.value]}
                              onValueChange={(value) =>
                                field.onChange(value[0])
                              }
                              max={10}
                              min={1}
                              step={1}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Location field */}
                  <div className="space-y-4 border-t pt-4">
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
                    <p className="text-sm text-gray-400">Select one or more options</p>
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
                        className="w-full text-muted-foreground"
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

                  {/* Security Deposit */}
                  {watchIsLendable && (
                    <div className="space-y-4 border-t pt-4">
                      <h3 className="font-medium">Lending Options</h3>
                      <FormField
                        control={form.control}
                        name="securityDeposit"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Security Deposit ($)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                {...field}
                                value={field.value || ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Photos */}
            <div className="lg:col-span-1">
              <Card className="sticky top-8">
                <CardContent className="pt-6">
                  <h3 className="font-medium mb-4">Photos</h3>
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
                        {selectedPhotos.length > 0 && (
                          <p className="mt-2 text-sm">
                            {selectedPhotos.length} photos selected
                          </p>
                        )}
                      </div>
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
                </CardContent>
              </Card>
            </div>

            {/* Submit Button - Full Width Below Both Columns */}
            <div className="lg:col-span-3">
              <Button
                type="submit"
                className="w-full"
                disabled={createItemMutation.isPending}
              >
                List Item
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
                      scale: 0.5 + Math.random() * 0.5
                    }}
                    animate={{ 
                      y: -100,
                      rotate: Math.random() * 360,
                    }}
                    transition={{ 
                      duration: 3 + Math.random() * 2,
                      repeat: Infinity,
                      delay: Math.random() * 2,
                      ease: "linear"
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
                  {/* Sparkle effects */}
                  <motion.div
                    className="absolute top-2 left-4"
                    animate={{ rotate: 360, scale: [1, 1.2, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <Sparkles className="h-5 w-5 text-yellow-300" />
                  </motion.div>
                  <motion.div
                    className="absolute top-4 right-6"
                    animate={{ rotate: -360, scale: [1, 1.3, 1] }}
                    transition={{ duration: 2.5, repeat: Infinity, delay: 0.5 }}
                  >
                    <Sparkles className="h-4 w-4 text-yellow-200" />
                  </motion.div>
                  <motion.div
                    className="absolute bottom-2 right-12"
                    animate={{ rotate: 360, scale: [1, 1.2, 1] }}
                    transition={{ duration: 3, repeat: Infinity, delay: 1 }}
                  >
                    <Sparkles className="h-3 w-3 text-pink-200" />
                  </motion.div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 text-white hover:bg-white/20"
                    onClick={() => setShowMatchingModal(false)}
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
                  <motion.p 
                    className="text-pink-100 mt-1"
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                  >
                    Your neighbor needs exactly what you're sharing!
                  </motion.p>
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

                      <div className="flex items-center gap-3 text-sm text-gray-600 mb-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-gradient-to-r from-teal-400 to-teal-500 rounded-full flex items-center justify-center">
                            <span className="text-white font-bold text-sm">
                              {selectedWishlistMatch.username?.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="font-medium">{selectedWishlistMatch.username}</span>
                        </div>
                        <span className="flex items-center gap-1 text-gray-500">
                          <MapPin className="h-4 w-4" />
                          {selectedWishlistMatch.distance}
                        </span>
                      </div>

                      {/* Compact date display */}
                      {selectedWishlistMatch.neededDate && (
                        <div className="bg-teal-50 rounded-lg px-3 py-2 mb-4">
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-teal-600" />
                            <span className="text-teal-800 font-medium">
                              {new Date(selectedWishlistMatch.neededDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              {selectedWishlistMatch.returnDate && 
                                ` - ${new Date(selectedWishlistMatch.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                              }
                            </span>
                          </div>
                        </div>
                      )}

                      {/* ShareCoins reward */}
                      <motion.div 
                        className="rounded-lg p-3 border"
                        style={{ backgroundColor: "#0D9488", borderColor: "#0D9488" }}
                        animate={{ boxShadow: ["0 0 0 0 rgba(13, 148, 136, 0)", "0 0 0 8px rgba(13, 148, 136, 0.2)", "0 0 0 0 rgba(13, 148, 136, 0)"] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🪙</span>
                          <span className="text-white font-semibold">
                            Earn 10-20 ShareCoins for helping!
                          </span>
                        </div>
                      </motion.div>
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
                        onClick={() => {
                          setShowMatchingModal(false);
                          if (
                            selectedWishlistMatch?.neededDate &&
                            selectedWishlistMatch?.returnDate
                          ) {
                            form.setValue(
                              "availableFromDate",
                              selectedWishlistMatch.neededDate.split("T")[0],
                            );
                            form.setValue(
                              "availableToDate",
                              selectedWishlistMatch.returnDate.split("T")[0],
                            );
                            form.setValue("isLendable", true);
                          }
                          toast({
                            title: "🎉 It's a Match!",
                            description: `Dates auto-filled for ${selectedWishlistMatch?.username}'s request!`,
                          });
                        }}
                        className="w-full h-12 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white font-semibold shadow-lg"
                      >
                        Match & Auto-Fill Dates
                      </Button>
                    </motion.div>
                  </motion.div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
