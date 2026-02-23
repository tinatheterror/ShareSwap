import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MapPin, Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface LocationSetupModalProps {
  open: boolean;
  onComplete: () => void;
}

interface GeoLocation {
  city: string;
  postalCode: string;
  lat: number;
  lon: number;
}

export function LocationSetupModal({
  open,
  onComplete,
}: LocationSetupModalProps) {
  const [locationInput, setLocationInput] = useState("");
  const [radiusOption, setRadiusOption] = useState("25");
  const [isDetecting, setIsDetecting] = useState(true);
  const [detectedLocation, setDetectedLocation] = useState<GeoLocation | null>(
    null,
  );
  const [error, setError] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const saveLocationMutation = useMutation({
    mutationFn: async (data: {
      city: string;
      postalCode: string;
      radius: number;
    }) => {
      const response = await apiRequest("POST", "/api/user/location", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Location saved",
        description: "We'll show you items nearby!",
      });
      onComplete();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save location. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (open) {
      detectLocation();
    }
  }, [open]);

  const detectLocation = async () => {
    setIsDetecting(true);
    setError("");

    try {
      const response = await fetch("/api/geo/detect");
      if (response.ok) {
        const data = await response.json();
        if (data.city || data.postalCode) {
          setDetectedLocation(data);
          setLocationInput(data.city || data.postalCode || "");
        }
      }
    } catch (err) {
      console.log("IP location detection failed, user will enter manually");
    } finally {
      setIsDetecting(false);
    }
  };

  const handleContinue = () => {
    const trimmedInput = locationInput.trim();

    if (!trimmedInput) {
      setError("Please enter your city or postal code.");
      return;
    }

    setError("");

    const isPostalCode =
      /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(trimmedInput) ||
      /^\d{5}(-\d{4})?$/.test(trimmedInput);

    saveLocationMutation.mutate({
      city: isPostalCode ? detectedLocation?.city || "" : trimmedInput,
      postalCode: isPostalCode
        ? trimmedInput
        : detectedLocation?.postalCode || "",
      radius: parseInt(radiusOption),
    });
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
            <MapPin className="h-8 w-8 text-white" />
          </div>
          <DialogTitle className="text-xl font-semibold text-center">
            Find items near you
          </DialogTitle>
          <DialogDescription className="text-center text-gray-600">
            We only use your location to show nearby neighbours. Your address is
            kept secure.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="location" className="text-sm font-medium">
              Your city or postal code
            </Label>
            <div className="relative">
              <Input
                id="location"
                placeholder="Enter your city or postal code"
                value={locationInput}
                onChange={(e) => {
                  setLocationInput(e.target.value);
                  setError("");
                }}
                className={error ? "border-red-500" : ""}
                disabled={isDetecting}
              />
              {isDetecting && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                </div>
              )}
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            {detectedLocation && !isDetecting && (
              <p className="text-sm text-teal-600">
                Location detected automatically
              </p>
            )}
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Show items from</Label>
            <RadioGroup
              value={radiusOption}
              onValueChange={setRadiusOption}
              className="space-y-2"
            >
              <div className="flex items-center space-x-3 rounded-lg border p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                <RadioGroupItem value="5" id="near" />
                <Label
                  htmlFor="near"
                  className="flex-1 cursor-pointer font-normal"
                >
                  Near me (5 km)
                </Label>
              </div>
              <div className="flex items-center space-x-3 rounded-lg border p-3 cursor-pointer hover:bg-gray-50 transition-colors border-teal-500 bg-teal-50">
                <RadioGroupItem value="25" id="city" />
                <Label
                  htmlFor="city"
                  className="flex-1 cursor-pointer font-normal"
                >
                  My city (25 km)
                </Label>
                <span className="text-xs text-teal-600 font-medium">
                  Recommended
                </span>
              </div>
              <div className="flex items-center space-x-3 rounded-lg border p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                <RadioGroupItem value="50" id="region" />
                <Label
                  htmlFor="region"
                  className="flex-1 cursor-pointer font-normal"
                >
                  My region (50 km)
                </Label>
              </div>
            </RadioGroup>
          </div>

          <p className="text-xs text-gray-500 text-center">
            You can change this anytime in settings.
          </p>
        </div>

        <Button
          onClick={handleContinue}
          disabled={saveLocationMutation.isPending || isDetecting}
          className="w-full bg-teal-600 hover:bg-teal-700"
        >
          {saveLocationMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Continue"
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
