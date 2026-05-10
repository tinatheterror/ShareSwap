import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Download,
  ExternalLink,
  Image,
  Pencil,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { useLocation } from "wouter";

interface ImportListingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = "url" | "failed" | "scanning" | "done";

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

export function ImportListingModal({ isOpen, onClose }: ImportListingModalProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("url");
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    setStep("url");
    setImportUrl("");
    setIsImporting(false);
    setExtracted(null);
    onClose();
  };

  const handleImport = async () => {
    if (!importUrl.trim()) {
      toast({ title: "URL Required", description: "Please paste a listing URL", variant: "destructive" });
      return;
    }
    setIsImporting(true);
    try {
      const response = await apiRequest("POST", "/api/import-listing", { url: importUrl });
      const data = await response.json();
      sessionStorage.setItem("shareswap_import_data", JSON.stringify({
        name: data.name,
        description: data.description,
        conditionRating: data.conditionRating,
      }));
      handleClose();
      navigate("/lend");
    } catch {
      setStep("failed");
    } finally {
      setIsImporting(false);
    }
  };

  const handleEnterManually = () => {
    handleClose();
    navigate("/lend");
  };

  const handleScreenshotPick = () => {
    fileRef.current?.click();
  };

  const getFreshCsrfToken = async (): Promise<string | null> => {
    await fetch("/api/csrf-token", { credentials: "include" });
    const cookies = document.cookie.split(";");
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split("=");
      if (name === "x-csrf-token") return decodeURIComponent(value);
    }
    return null;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file", variant: "destructive" });
      return;
    }

    setStep("scanning");

    try {
      const csrfToken = await getFreshCsrfToken();

      const formData = new FormData();
      formData.append("screenshot", file);

      const res = await fetch("/api/import-from-screenshot", {
        method: "POST",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to analyze screenshot");
      }

      const data: ExtractedData = await res.json();
      setExtracted(data);
      setStep("done");
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message || "Could not analyze screenshot", variant: "destructive" });
      setStep("failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleListExtracted = () => {
    if (!extracted) return;
    sessionStorage.setItem("shareswap_import_data", JSON.stringify(extracted));
    handleClose();
    navigate("/lend");
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
              <Download className="h-5 w-5 text-teal-600" />
            </div>
            <DialogTitle className="text-xl font-bold">Import a Listing</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            Paste a marketplace link and we'll auto-fill the details.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: URL Input ─────────────────────────────── */}
        {step === "url" && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {["Facebook Marketplace", "Craigslist"].map((p) => (
                <span key={p} className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                  {p}
                </span>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Listing URL</label>
              <div className="flex gap-2">
                <Input
                  placeholder="Paste listing URL here..."
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleImport()}
                  className="flex-1"
                />
                <Button
                  onClick={handleImport}
                  disabled={isImporting || !importUrl.trim()}
                  style={{ backgroundColor: "#0DCEA1" }}
                  className="text-white shrink-0"
                >
                  {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ExternalLink className="h-3 w-3" />
                Copy the URL from your browser's address bar
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">How it works</p>
              <ul className="text-sm text-gray-600 space-y-1">
                {[
                  "Find your item on Facebook Marketplace or Craigslist",
                  "Copy the URL from your browser",
                  "Paste it above — we'll extract the title, description, and price",
                  "Review the details and publish your ShareSwap listing",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-teal-600 font-bold mt-0.5">{i + 1}.</span>
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ── Step: Import Failed ──────────────────────────── */}
        {step === "failed" && (
          <div className="space-y-5">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex gap-4">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-900">We couldn't import this listing automatically</p>
                <p className="text-sm text-amber-700">
                  Facebook blocks most imports. Upload a screenshot instead and we'll fill it in for you.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                onClick={handleScreenshotPick}
                className="w-full h-14 text-white font-semibold text-base gap-3 rounded-xl"
                style={{ backgroundColor: "#0DCEA1" }}
              >
                <Image className="h-5 w-5" />
                Upload screenshot
                <ChevronRight className="h-4 w-4 ml-auto" />
              </Button>

              <Button
                variant="outline"
                onClick={handleEnterManually}
                className="w-full h-14 font-semibold text-base gap-3 rounded-xl border-2"
              >
                <Pencil className="h-5 w-5" />
                Enter manually
                <ChevronRight className="h-4 w-4 ml-auto" />
              </Button>
            </div>

            <button
              onClick={() => setStep("url")}
              className="w-full text-sm text-muted-foreground hover:text-gray-700 flex items-center justify-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Try a different URL
            </button>
          </div>
        )}

        {/* ── Step: Scanning ──────────────────────────────── */}
        {step === "scanning" && (
          <div className="py-10 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-teal-600 animate-spin" />
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-lg">Analyzing your screenshot…</p>
              <p className="text-sm text-muted-foreground mt-1">
                We're reading the listing details. This takes a few seconds.
              </p>
            </div>
          </div>
        )}

        {/* ── Step: Done / Preview ────────────────────────── */}
        {step === "done" && extracted && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-green-800">Details extracted!</p>
                <p className="text-sm text-green-700">Review below and we'll pre-fill the listing form.</p>
              </div>
            </div>

            <div className="bg-white border rounded-xl p-4 space-y-3 text-sm">
              {extracted.name && (
                <Row label="Item" value={extracted.name} />
              )}
              {extracted.brand && (
                <Row label="Brand" value={`${extracted.brand}${extracted.isLuxury ? " ✦ Luxury" : ""}`} />
              )}
              {extracted.itemType && (
                <Row label="Category" value={extracted.itemType} />
              )}
              {extracted.condition && (
                <Row label="Condition" value={`${extracted.condition} (${extracted.conditionRating}/10)`} />
              )}
              {extracted.originalValue && (
                <Row label="Est. value" value={extracted.originalValue} />
              )}
              {extracted.suggestedTier && (
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

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("failed")} className="flex-1">
                ← Back
              </Button>
              <Button
                onClick={handleListExtracted}
                className="flex-2 text-white"
                style={{ backgroundColor: "#0DCEA1" }}
              >
                List this item →
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
