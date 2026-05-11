import { useState, useRef, useCallback, DragEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Image,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  Plus,
  Sparkles,
  Pencil,
} from "lucide-react";
import { useLocation } from "wouter";

interface ImportListingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = "upload" | "scanning" | "done" | "error";

interface FileItem {
  file: File;
  preview: string;
}

interface ExtractedData {
  name: string;
  description: string;
  price: number | null;
  condition: string;
  conditionRating: number;
  brand: string;
  itemType: string;
  visibleDamage: string;
  modelVersion: string;
  isLuxury: boolean;
  originalValue: string;
  suggestedTier: number;
}

const PLATFORMS = [
  "Facebook Marketplace",
  "Craigslist",
  "Poshmark",
  "OfferUp",
  "Karrot",
  "Any resale platform",
];

export function ImportListingModal({ isOpen, onClose }: ImportListingModalProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("upload");
  const [fileItems, setFileItems] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    fileItems.forEach((item) => URL.revokeObjectURL(item.preview));
    setStep("upload");
    setFileItems([]);
    setIsDragging(false);
    setDragCounter(0);
    setExtracted(null);
    onClose();
  };

  const addFiles = useCallback((incoming: File[]) => {
    const images = incoming.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setFileItems((prev) => {
      const combined = [...prev, ...images.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))];
      return combined.slice(0, 5);
    });
  }, []);

  const removeFile = (index: number) => {
    setFileItems((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    setDragCounter((c) => c + 1);
    setIsDragging(true);
  };
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setDragCounter((c) => {
      const next = c - 1;
      if (next <= 0) setIsDragging(false);
      return next;
    });
  };
  const handleDragOver = (e: DragEvent) => e.preventDefault();
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setDragCounter(0);
    if (e.dataTransfer.files) addFiles(Array.from(e.dataTransfer.files));
  };

  const getFreshCsrfToken = async (): Promise<string | null> => {
    await fetch("/api/csrf-token", { credentials: "include" });
    for (const cookie of document.cookie.split(";")) {
      const [name, value] = cookie.trim().split("=");
      if (name === "x-csrf-token") return decodeURIComponent(value);
    }
    return null;
  };

  const handleScan = async () => {
    if (fileItems.length === 0) return;
    setStep("scanning");
    try {
      const csrfToken = await getFreshCsrfToken();
      const formData = new FormData();
      fileItems.forEach((item) => formData.append("screenshots", item.file));
      const res = await fetch("/api/import-from-screenshot", {
        method: "POST",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to analyze screenshots");
      }
      const data: ExtractedData = await res.json();
      setExtracted(data);
      setStep("done");
    } catch {
      setStep("error");
    }
  };

  const handleListExtracted = () => {
    if (!extracted) return;
    sessionStorage.setItem("shareswap_import_data", JSON.stringify(extracted));
    handleClose();
    navigate("/lend");
  };

  const handleEnterManually = () => {
    handleClose();
    navigate("/lend");
  };

  const resetToUpload = () => {
    fileItems.forEach((item) => URL.revokeObjectURL(item.preview));
    setFileItems([]);
    setExtracted(null);
    setStep("upload");
  };

  const subtitleText =
    step === "done"
      ? "Review the extracted details before filling in your listing form."
      : step === "scanning"
      ? "Our AI is reading your listing..."
      : step === "error"
      ? "Something went wrong. Try uploading clearer screenshots."
      : "Upload screenshots of listings from other platforms to generate your listing details.";

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          capture={undefined}
          className="hidden"
          onChange={handleFileInputChange}
        />

        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 text-teal-600" />
            </div>
            <DialogTitle className="text-xl font-bold">Import Marketplace Listing</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            {subtitleText}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: Upload ─────────────────────────────────── */}
        {step === "upload" && (
          <div className="space-y-4">
            {/* Platform pills */}
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <span
                  key={p}
                  className="text-xs font-medium px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-100"
                >
                  {p}
                </span>
              ))}
            </div>

            {/* Drop zone */}
            <div
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileItems.length === 0 && fileRef.current?.click()}
              className={`relative rounded-xl border-2 border-dashed transition-colors ${
                isDragging
                  ? "border-teal-400 bg-teal-50"
                  : fileItems.length === 0
                  ? "border-gray-200 bg-gray-50 hover:border-teal-300 hover:bg-teal-50/30 cursor-pointer"
                  : "border-gray-200 bg-gray-50"
              }`}
            >
              {fileItems.length === 0 ? (
                <div className="py-10 flex flex-col items-center gap-3 text-center select-none">
                  <div className="w-14 h-14 rounded-full bg-white border border-gray-200 flex items-center justify-center shadow-sm">
                    <Upload className="h-6 w-6 text-teal-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800">Drop screenshots here</p>
                    <p className="text-sm text-muted-foreground mt-0.5">or tap to browse your files</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Up to 5 screenshots · JPG, PNG, WEBP</p>
                </div>
              ) : (
                <div className="p-3 space-y-3">
                  {/* Preview grid */}
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {fileItems.map((item, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200 group">
                        <img
                          src={item.preview}
                          alt={`Screenshot ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {fileItems.length < 5 && (
                      <button
                        onClick={() => fileRef.current?.click()}
                        className="aspect-square rounded-lg border-2 border-dashed border-gray-300 hover:border-teal-400 hover:bg-teal-50 flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-teal-600 transition-colors"
                      >
                        <Plus className="h-5 w-5" />
                        <span className="text-[10px] font-medium">Add more</span>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    {fileItems.length}/5 screenshot{fileItems.length !== 1 ? "s" : ""} selected
                  </p>
                </div>
              )}
            </div>

            {/* Tip */}
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              Fastest & most reliable way to import from any marketplace.
            </p>

            {/* Actions */}
            <div className="space-y-2">
              <Button
                onClick={handleScan}
                disabled={fileItems.length === 0}
                className="w-full h-12 text-white font-semibold text-base gap-2"
                style={{ backgroundColor: "#0DCEA1" }}
              >
                <Sparkles className="h-4 w-4" />
                Scan listing
              </Button>
              <Button
                variant="ghost"
                onClick={handleEnterManually}
                className="w-full h-10 text-muted-foreground gap-2"
              >
                <Pencil className="h-4 w-4" />
                Enter manually instead
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: Scanning ──────────────────────────────── */}
        {step === "scanning" && (
          <div className="py-12 flex flex-col items-center gap-4 text-center">
            <div className="relative w-16 h-16">
              <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-teal-600 animate-spin" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-lg">Scanning your listing…</p>
              <p className="text-sm text-muted-foreground mt-1">
                Generating details from your screenshot{fileItems.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        )}

        {/* ── Step: Done ──────────────────────────────────── */}
        {step === "done" && extracted && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-green-800">Details extracted!</p>
                <p className="text-sm text-green-700">Review below and we'll pre-fill the listing form.</p>
              </div>
            </div>

            <div className="bg-white border rounded-xl p-4 space-y-3 text-sm max-h-64 overflow-y-auto">
              {extracted.name && <Row label="Item" value={extracted.name} />}
              {extracted.brand && (
                <Row
                  label="Brand"
                  value={`${extracted.brand}${extracted.isLuxury ? " ✦ Luxury" : ""}`}
                />
              )}
              {extracted.itemType && <Row label="Category" value={extracted.itemType} />}
              {extracted.condition && (
                <Row label="Condition" value={`${extracted.condition} (${extracted.conditionRating}/10)`} />
              )}
              {extracted.originalValue && (
                <Row label="Original price" value={extracted.originalValue} />
              )}
              {extracted.suggestedTier > 0 && (
                <Row label="Sharing tier" value={`Tier ${extracted.suggestedTier}`} />
              )}
              {extracted.price != null && (
                <Row label="Listed price" value={`$${extracted.price}`} />
              )}
              {extracted.modelVersion && (
                <Row label="Model / version" value={extracted.modelVersion} />
              )}
              {extracted.visibleDamage && (
                <Row label="Visible damage" value={extracted.visibleDamage} className="text-amber-700" />
              )}
            </div>

            {/* Photo notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2.5">
              <Image className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                We couldn't extract clean item photos from your screenshot. Add photos manually for best results.
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={resetToUpload} className="flex-1 gap-1">
                Try again
              </Button>
              <Button
                onClick={handleListExtracted}
                className="flex-[2] text-white gap-1"
                style={{ backgroundColor: "#0DCEA1" }}
              >
                List this item →
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: Error ─────────────────────────────────── */}
        {step === "error" && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex gap-4">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-red-900">We couldn't read this listing clearly</p>
                <p className="text-sm text-red-700">
                  Try uploading clearer or higher-resolution screenshots that show the full listing details.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Button
                onClick={resetToUpload}
                className="w-full h-12 text-white font-semibold gap-2"
                style={{ backgroundColor: "#0DCEA1" }}
              >
                <Upload className="h-4 w-4" />
                Try different screenshots
              </Button>
              <Button
                variant="ghost"
                onClick={handleEnterManually}
                className="w-full h-10 text-muted-foreground gap-2"
              >
                <Pencil className="h-4 w-4" />
                Enter manually instead
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`font-medium text-right ${className}`}>{value}</span>
    </div>
  );
}
