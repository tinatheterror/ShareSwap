import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Camera, Sparkles, Upload, X, Zap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SmartScanUsage {
  scansUsed: number;
  scansRemaining: number | "unlimited";
  isPremium: boolean;
  resetDate: string;
}

interface SmartScanAnalysis {
  name: string;
  description: string;
  category: string;
  brand: string;
  conditionRating: number;
  estimatedValue: string | null;
  confidence: number;
}

interface SmartScanProps {
  onAnalysisComplete: (analysis: SmartScanAnalysis, photos: string[]) => void;
}

export function SmartScan({ onAnalysisComplete }: SmartScanProps) {
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: usage } = useQuery<SmartScanUsage>({
    queryKey: ["/api/smartscan/usage"],
  });

  const analyzeMutation = useMutation({
    mutationFn: async (images: File[]) => {
      const formData = new FormData();
      images.forEach((image) => {
        formData.append("photos", image);
      });
      const res = await apiRequest("POST", "/api/smartscan/analyze", formData);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "✨ SmartScan Complete!",
        description: `Identified: ${data.analysis.name} with ${Math.round(data.analysis.confidence * 100)}% confidence`,
      });
      onAnalysisComplete(data.analysis, data.photos);
      queryClient.invalidateQueries({ queryKey: ["/api/smartscan/usage"] });
      setSelectedImages([]);
      setPreviewUrls([]);
    },
    onError: (error: Error) => {
      toast({
        title: "SmartScan Failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsAnalyzing(false);
    },
  });

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Limit to 10 images
    const newImages = [...selectedImages, ...files].slice(0, 10);
    setSelectedImages(newImages);

    // Create preview URLs
    const newUrls = newImages.map((file) => URL.createObjectURL(file));
    setPreviewUrls(newUrls);

    // Clear input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    const newImages = selectedImages.filter((_, i) => i !== index);
    const newUrls = previewUrls.filter((_, i) => i !== index);
    setSelectedImages(newImages);
    setPreviewUrls(newUrls);
  };

  const handleAnalyze = () => {
    if (selectedImages.length === 0) {
      toast({
        title: "No images selected",
        description: "Please upload at least one image to analyze",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    analyzeMutation.mutate(selectedImages);
  };

  const canScan =
    usage?.scansRemaining === "unlimited" ||
    (typeof usage?.scansRemaining === "number" && usage.scansRemaining > 0);

  const scansRemainingDisplay =
    usage?.scansRemaining === "unlimited"
      ? "∞"
      : usage?.scansRemaining || 0;

  return (
    <Card className="p-6 bg-gradient-to-br from-teal-50 to-white border-2 border-teal-200">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-gray-900">
                SmartScan
              </h3>
              <p className="text-sm text-gray-600">
                AI-powered item recognition
              </p>
            </div>
          </div>
          <div className="text-right">
            <Badge
              variant={usage?.isPremium ? "default" : "secondary"}
              className={
                usage?.isPremium
                  ? "bg-gradient-to-r from-yellow-500 to-yellow-600"
                  : ""
              }
            >
              {usage?.isPremium ? (
                <><Zap className="w-3 h-3 mr-1" /> Premium</>
              ) : (
                <>{scansRemainingDisplay}/3 Free</>
              )}
            </Badge>
          </div>
        </div>

        {/* Usage Progress (Free users only) */}
        {!usage?.isPremium && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Monthly scans</span>
              <span className="font-medium text-teal-600">
                {usage?.scansUsed || 0}/3 used
              </span>
            </div>
            <Progress
              value={((usage?.scansUsed || 0) / 3) * 100}
              className="h-2"
            />
          </div>
        )}

        {/* Image Upload */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageSelect}
            className="hidden"
          />

          {previewUrls.length === 0 ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-teal-300 rounded-lg p-8 text-center cursor-pointer hover:border-teal-500 hover:bg-teal-50 transition-colors"
            >
              <Camera className="w-12 h-12 mx-auto mb-4 text-teal-500" />
              <p className="font-medium text-gray-900 mb-1">
                Upload 360° photos
              </p>
              <p className="text-sm text-gray-500">
                Take photos from multiple angles for better AI recognition
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {previewUrls.map((url, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={url}
                      alt={`Preview ${index + 1}`}
                      className="w-full h-24 object-cover rounded-lg border-2 border-teal-200"
                    />
                    <button
                      onClick={() => removeImage(index)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {previewUrls.length < 10 && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-24 border-2 border-dashed border-teal-300 rounded-lg flex items-center justify-center hover:border-teal-500 hover:bg-teal-50 transition-colors"
                  >
                    <Upload className="w-6 h-6 text-teal-500" />
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 text-center">
                {previewUrls.length}/10 images • More angles = better
                results
              </p>
            </div>
          )}
        </div>

        {/* Analyze Button */}
        <Button
          onClick={handleAnalyze}
          disabled={!canScan || selectedImages.length === 0 || isAnalyzing}
          className="w-full bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isAnalyzing ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              Analyzing...
            </>
          ) : !canScan ? (
            <>
              <X className="w-4 h-4 mr-2" />
              No scans remaining
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Analyze with AI
            </>
          )}
        </Button>

        {!canScan && !usage?.isPremium && (
          <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-center">
            <p className="text-sm text-red-600 font-medium">
              You've used all 3 free SmartScans this month
            </p>
            <p className="text-xs text-red-500 mt-1">
              Upgrade to Premium for unlimited scans or use Manual Upload
            </p>
          </div>
        )}

        {/* Features list */}
        <div className="pt-4 border-t border-teal-200">
          <p className="text-xs font-medium text-gray-700 mb-2">
            SmartScan features:
          </p>
          <ul className="text-xs text-gray-600 space-y-1">
            <li>✓ Auto-fill name, description, category & brand</li>
            <li>✓ Condition rating estimation</li>
            {usage?.isPremium && (
              <li className="text-yellow-600 font-medium">
                ✓ Premium: Market value estimation
              </li>
            )}
          </ul>
        </div>
      </div>
    </Card>
  );
}
