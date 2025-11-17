import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Upload, MapPin, X, Heart, CheckCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { SmartScan } from "@/components/smartscan";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(10, "Please provide a detailed description"),
  isLendable: z.boolean().default(false),
  isSwappable: z.boolean().default(false),
  isRentable: z.boolean().default(false),
  availableFromDate: z.string().optional(),
  availableToDate: z.string().optional(),
  securityDeposit: z.coerce.number().min(0, "Security deposit must be positive").optional(),
  conditionRating: z.coerce.number().min(1).max(10, "Rating must be between 1 and 10"),
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
  const [uploadMethod, setUploadMethod] = useState<"smartscan" | "manual">("smartscan");
  const [smartScanPhotos, setSmartScanPhotos] = useState<string[]>([]);

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
    queryKey: ['/api/all-wishlists'],
  });

  // Check for wishlist matches when item name changes
  useEffect(() => {
    const itemName = form.watch("name");
    if (itemName && itemName.length > 2 && Array.isArray(allWishlists)) {
      const matches = allWishlists.filter((wishlist: any) => 
        wishlist.itemName.toLowerCase().includes(itemName.toLowerCase()) ||
        itemName.toLowerCase().includes(wishlist.itemName.toLowerCase())
      );
      setMatchedWishlists(matches);
      
      if (matches.length > 0 && !showMatchingModal) {
        setShowMatchingModal(true);
        
        // Auto-fill dates from the first matching wishlist
        const firstMatch = matches[0];
        if (firstMatch.neededDate && firstMatch.returnDate) {
          form.setValue("availableFromDate", firstMatch.neededDate.split('T')[0]); // Format for date input
          form.setValue("availableToDate", firstMatch.returnDate.split('T')[0]); // Format for date input
        }
      }
    } else {
      setMatchedWishlists([]);
    }
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
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject);
        });

        const { latitude, longitude } = position.coords;
        form.setValue("latitude", latitude);
        form.setValue("longitude", longitude);

        // Get postal code from coordinates
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
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
              description: "Could not get your postal code. Please enter it manually.",
              variant: "destructive",
            });
          }
        } catch (error) {
          console.error("Error getting postal code:", error);
          toast({
            title: "Location Error",
            description: "Could not get your postal code. Please enter it manually.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Error getting location:", error);
        toast({
          title: "Location Error",
          description: "Could not get your location. Please enter postal code manually.",
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
          borrowerUserId: selectedWishlistMatch.userId
        });
      }
      
      return result;
    },
    onSuccess: (data) => {
      // Invalidate item queries to refresh lists
      queryClient.invalidateQueries({ queryKey: ['/api/items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/nearby-items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user-items'] });
      
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
  const watchPostalCode = form.watch("postalCode");
  
  // Debug logging
  console.log("watchIsLendable:", watchIsLendable);

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">List Your Item</h1>
          <p className="text-muted-foreground">
            Share your items with the community through lending, renting, or swapping
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((data) => createItemMutation.mutate(data))}
                className="space-y-6"
              >
                {/* Item Name */}
                <div className="space-y-4 border-t pt-4">
                  <h3 className="font-medium">Item Name</h3>
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
                <div className="space-y-4 border-t pt-4">
                  <h3 className="font-medium">Sharing Options</h3>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="isLendable"
                      render={({ field }) => (
                        <FormItem className="flex items-center space-x-2">
                          <FormControl>
                            <Checkbox 
                              checked={field.value} 
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Available for Lending</FormLabel>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="isSwappable"
                      render={({ field }) => (
                        <FormItem className="flex items-center space-x-2">
                          <FormControl>
                            <Checkbox 
                              checked={field.value} 
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Available for Swaps</FormLabel>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="isRentable"
                      render={({ field }) => (
                        <FormItem className="flex items-center space-x-2">
                          <FormControl>
                            <Checkbox 
                              checked={field.value} 
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Available for Rent</FormLabel>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Availability Period - Show when lending is enabled */}
                <div className="space-y-4 border-t pt-4">
                  <h3 className="font-medium">Availability Period</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Set specific dates when your item is available for lending
                  </p>
                  
                  <div className="grid grid-cols-2 gap-4">
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
                              value={field.value || ''}
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
                              value={field.value || ''}
                              placeholder="Select end date"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {selectedWishlistMatch && (
                    <div className="p-3 bg-teal-50 rounded-lg border border-teal-200">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-teal-500" />
                        <span className="text-teal-800 font-medium">
                          Dates automatically matched to {selectedWishlistMatch.username}'s request
                        </span>
                      </div>
                      <p className="text-teal-700 text-sm mt-1">
                        Needed: {selectedWishlistMatch.neededDate ? new Date(selectedWishlistMatch.neededDate).toLocaleDateString() : 'Not specified'} - 
                        Return: {selectedWishlistMatch.returnDate ? new Date(selectedWishlistMatch.returnDate).toLocaleDateString() : 'Not specified'}
                      </p>
                    </div>
                  )}
                </div>

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
                            <Input type="number" min="0" step="0.01" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* Photos */}
                <div className="space-y-4 border-t pt-4">
                  <h3 className="font-medium">Photos</h3>
                  <Tabs value={uploadMethod} onValueChange={(v) => setUploadMethod(v as "smartscan" | "manual")}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="smartscan">
                        ✨ SmartScan
                      </TabsTrigger>
                      <TabsTrigger value="manual">
                        Manual Upload
                      </TabsTrigger>
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
                    <div className="p-3 bg-teal-50 rounded-lg border border-teal-200">
                      <p className="text-sm text-teal-700">
                        ✨ SmartScan detected {smartScanPhotos.length} photos - form auto-filled!
                      </p>
                    </div>
                  )}
                </div>

                {/* Condition Rating */}
                <div className="space-y-4 border-t pt-4">
                  <h3 className="font-medium">Condition Rating (1-10)</h3>
                  <FormField
                    control={form.control}
                    name="conditionRating"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input type="number" min="1" max="10" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={createItemMutation.isPending}
                >
                  List Item
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

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
                      Search by city, neighborhood or ZIP code.
                    </label>
                    <Input
                      value={form.getValues("postalCode")}
                      onChange={(e) => form.setValue("postalCode", e.target.value)}
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
                    {isLoadingLocation ? "Getting Location..." : "Use Current Location"}
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

        {/* Wishlist Matching Modal */}
        {showMatchingModal && matchedWishlists.length > 0 && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gradient-to-r from-teal-500 to-teal-600 rounded-full flex items-center justify-center">
                      <Heart className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">Perfect Match Found!</h3>
                      <p className="text-gray-600">Someone in your community is looking for this item</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowMatchingModal(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="p-6">
                <div className="space-y-4">
                  {matchedWishlists.map((wishlist: any) => (
                    <div
                      key={wishlist.id}
                      className={`p-4 border rounded-lg cursor-pointer transition-all ${
                        selectedWishlistMatch?.id === wishlist.id
                          ? 'border-teal-500 bg-teal-50'
                          : 'border-gray-200 hover:border-teal-300'
                      }`}
                      onClick={() => setSelectedWishlistMatch(wishlist)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-semibold text-lg">{wishlist.itemName}</h4>
                            {selectedWishlistMatch?.id === wishlist.id && (
                              <CheckCircle className="h-5 w-5 text-teal-500" />
                            )}
                          </div>
                          
                          <p className="text-gray-600 mb-3">{wishlist.description}</p>
                          
                          <div className="flex items-center gap-4 text-sm text-gray-500 mb-2">
                            <span className="flex items-center gap-1">
                              <div className="w-6 h-6 bg-teal-100 rounded-full flex items-center justify-center">
                                <span className="text-teal-700 font-bold text-xs">{wishlist.username?.charAt(0)}</span>
                              </div>
                              {wishlist.username}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              {wishlist.distance}
                            </span>
                          </div>
                          
                          {wishlist.neededDate && wishlist.returnDate && (
                            <div className="p-3 bg-teal-50 rounded-lg border border-teal-200 mb-2">
                              <div className="flex items-center gap-2">
                                <CheckCircle className="h-4 w-4 text-teal-500" />
                                <span className="text-teal-800 font-medium text-sm">
                                  Perfect Date Match Available
                                </span>
                              </div>
                              <div className="text-teal-700 text-sm mt-1">
                                <div className="flex justify-between">
                                  <span>Needed: {new Date(wishlist.neededDate).toLocaleDateString()}</span>
                                  <span>Return: {new Date(wishlist.returnDate).toLocaleDateString()}</span>
                                </div>
                                <div className="text-xs text-teal-600 mt-1">
                                  Duration: {Math.ceil((new Date(wishlist.returnDate).getTime() - new Date(wishlist.neededDate).getTime()) / (1000 * 60 * 60 * 24))} days
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="mt-3 p-3 bg-teal-50 rounded-lg border border-teal-200">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 bg-teal-500 rounded-full flex items-center justify-center">
                            <span className="text-white text-xs font-bold">🪙</span>
                          </div>
                          <span className="text-teal-800 font-semibold">
                            Earn 10-20 ShareCoins for helping this neighbor!
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedWishlistMatch(null);
                      setShowMatchingModal(false);
                    }}
                    className="flex-1"
                  >
                    Skip Matching
                  </Button>
                  <Button
                    onClick={() => {
                      setShowMatchingModal(false);
                      // Auto-fill dates when a match is selected
                      if (selectedWishlistMatch?.neededDate && selectedWishlistMatch?.returnDate) {
                        form.setValue("availableFromDate", selectedWishlistMatch.neededDate.split('T')[0]);
                        form.setValue("availableToDate", selectedWishlistMatch.returnDate.split('T')[0]);
                        form.setValue("isLendable", true); // Ensure lending is enabled
                      }
                    }}
                    disabled={!selectedWishlistMatch}
                    className="flex-1 bg-teal-600 hover:bg-teal-700"
                  >
                    {selectedWishlistMatch ? 'Match & Auto-Fill Dates' : 'Select a Match'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}