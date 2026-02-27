import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Download, ExternalLink, CheckCircle, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

interface ImportListingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SUPPORTED_PLATFORMS = [
  {
    name: "Facebook Marketplace",
    example: "https://www.facebook.com/marketplace/item/...",
    color: "bg-blue-100 text-blue-700",
  },
  {
    name: "Craigslist",
    example: "https://craigslist.org/...",
    color: "bg-purple-100 text-purple-700",
  },
];

export function ImportListingModal({ isOpen, onClose }: ImportListingModalProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importedData, setImportedData] = useState<any>(null);

  const handleImport = async () => {
    if (!importUrl.trim()) {
      toast({
        title: "URL Required",
        description: "Please paste a listing URL to import",
        variant: "destructive",
      });
      return;
    }
    setIsImporting(true);
    try {
      const response = await apiRequest("POST", "/api/import-listing", { url: importUrl });
      const data = await response.json();
      setImportedData(data);
      toast({
        title: "Listing imported!",
        description: "Details have been extracted. Click below to list this item.",
      });
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message || "Unable to import listing. Please try a different URL.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleListImported = () => {
    if (!importedData) return;
    const params = new URLSearchParams();
    if (importedData.name) params.set("prefill", importedData.name);
    onClose();
    navigate(`/lend?${params.toString()}`);
  };

  const handleReset = () => {
    setImportedData(null);
    setImportUrl("");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center">
              <Download className="h-5 w-5 text-teal-600" />
            </div>
            <DialogTitle className="text-xl font-bold">Import a Listing</DialogTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Paste a link from Facebook Marketplace or Craigslist and we'll auto-fill the details for you.
          </p>
        </DialogHeader>

        {!importedData ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_PLATFORMS.map((p) => (
                <span key={p.name} className={`text-xs font-medium px-2.5 py-1 rounded-full ${p.color}`}>
                  {p.name}
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
                  {isImporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Import"
                  )}
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
                <li className="flex items-start gap-2">
                  <span className="text-teal-600 font-bold mt-0.5">1.</span>
                  Find your item on Facebook Marketplace or Craigslist
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-teal-600 font-bold mt-0.5">2.</span>
                  Copy the URL from your browser
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-teal-600 font-bold mt-0.5">3.</span>
                  Paste it above — we'll extract the title, description, and price
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-teal-600 font-bold mt-0.5">4.</span>
                  Review the details and publish your ShareSwap listing
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-green-800">Import successful!</p>
                <p className="text-sm text-green-700">Your listing details have been extracted.</p>
              </div>
            </div>

            <div className="bg-white border rounded-lg p-4 space-y-2">
              {importedData.name && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Title</p>
                  <p className="font-medium">{importedData.name}</p>
                </div>
              )}
              {importedData.description && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Description</p>
                  <p className="text-sm text-gray-700 line-clamp-3">{importedData.description}</p>
                </div>
              )}
              {importedData.price && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Price</p>
                  <p className="text-sm font-medium">${importedData.price}</p>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleReset} className="flex-1">
                Import Another
              </Button>
              <Button
                onClick={handleListImported}
                className="flex-1 text-white"
                style={{ backgroundColor: "#0DCEA1" }}
              >
                List This Item →
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
