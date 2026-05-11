import { useState, useRef, useCallback, DragEvent } from "react";
import ReactCrop, { type Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  Plus,
  Sparkles,
  Pencil,
  ArrowLeft,
  ArrowRight,
  Crop as CropIcon,
  Check,
} from "lucide-react";
import { useLocation } from "wouter";
import { setImportedPhotos } from "@/lib/import-store";

interface ImportListingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = "upload" | "scanning" | "photos" | "cropping" | "done" | "error";

interface FileItem {
  file: File;
  preview: string;
}

interface NormCrop {
  x: number; y: number; w: number; h: number;
}

interface CroppedPhoto {
  id: string;
  file: File;
  preview: string;
  originalFile: File;
  originalPreview: string;
  normCrop: NormCrop | null;
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
  photoScores: number[];
  photoCrops: (NormCrop | null)[];
}

const PLATFORMS = ["Facebook Marketplace", "Craigslist", "Poshmark", "OfferUp", "Karrot", "Any resale platform"];

let _uid = 0;
const uid = () => String(++_uid);

async function cropToFile(
  originalFile: File,
  originalPreview: string,
  norm: NormCrop | null,
): Promise<{ file: File; preview: string }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const sx = norm ? Math.round(norm.x * img.naturalWidth) : 0;
      const sy = norm ? Math.round(norm.y * img.naturalHeight) : 0;
      const sw = norm ? Math.round(norm.w * img.naturalWidth) : img.naturalWidth;
      const sh = norm ? Math.round(norm.h * img.naturalHeight) : img.naturalHeight;
      if (sw < 10 || sh < 10) { resolve({ file: originalFile, preview: originalPreview }); return; }
      const canvas = document.createElement("canvas");
      canvas.width = sw; canvas.height = sh;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.93);
      canvas.toBlob((blob) => {
        resolve({
          file: blob ? new File([blob], originalFile.name.replace(/\.[^.]+$/, "_crop.jpg"), { type: "image/jpeg" }) : originalFile,
          preview: dataUrl,
        });
      }, "image/jpeg", 0.93);
    };
    img.onerror = () => resolve({ file: originalFile, preview: originalPreview });
    img.src = originalPreview;
  });
}

export function ImportListingModal({ isOpen, onClose }: ImportListingModalProps) {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("upload");
  const [fileItems, setFileItems] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [croppedPhotos, setCroppedPhotos] = useState<CroppedPhoto[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Inline cropping state
  const [cropTargetId, setCropTargetId] = useState<string | null>(null);
  const [activeCrop, setActiveCrop] = useState<Crop | undefined>(undefined);
  const [cropSaving, setCropSaving] = useState(false);
  const cropImgRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    fileItems.forEach((f) => URL.revokeObjectURL(f.preview));
    croppedPhotos.forEach((p) => URL.revokeObjectURL(p.originalPreview));
    setStep("upload"); setFileItems([]); setIsDragging(false); setDragCounter(0);
    setExtracted(null); setCroppedPhotos([]); setSelectedIds(new Set());
    setCropTargetId(null); setActiveCrop(undefined);
    onClose();
  };

  const addFiles = useCallback((incoming: File[]) => {
    const images = incoming.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setFileItems((prev) => [...prev, ...images.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))].slice(0, 5));
  }, []);

  const removeFile = (i: number) => setFileItems((prev) => { URL.revokeObjectURL(prev[i].preview); return prev.filter((_, j) => j !== i); });
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = ""; };
  const handleDragEnter = (e: DragEvent) => { e.preventDefault(); setDragCounter((c) => c + 1); setIsDragging(true); };
  const handleDragLeave = (e: DragEvent) => { e.preventDefault(); setDragCounter((c) => { const n = c - 1; if (n <= 0) setIsDragging(false); return n; }); };
  const handleDragOver = (e: DragEvent) => e.preventDefault();
  const handleDrop = (e: DragEvent) => { e.preventDefault(); setIsDragging(false); setDragCounter(0); if (e.dataTransfer.files) addFiles(Array.from(e.dataTransfer.files)); };

  const getFreshCsrfToken = async () => {
    await fetch("/api/csrf-token", { credentials: "include" });
    for (const c of document.cookie.split(";")) { const [n, v] = c.trim().split("="); if (n === "x-csrf-token") return decodeURIComponent(v); }
    return null;
  };

  const handleScan = async () => {
    if (!fileItems.length) return;
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
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      const data: ExtractedData = await res.json();
      setExtracted(data);

      // Apply AI crop where available; otherwise keep full screenshot.
      const allPhotos: CroppedPhoto[] = await Promise.all(
        fileItems.map(async (item, i) => {
          const norm = data.photoCrops?.[i] ?? null;
          const { file: f, preview } = await cropToFile(item.file, item.preview, norm);
          return { id: uid(), file: f, preview, originalFile: item.file, originalPreview: item.preview, normCrop: norm };
        })
      );
      setCroppedPhotos(allPhotos);
      setSelectedIds(new Set(allPhotos.map((p) => p.id)));
      setStep("photos");
    } catch {
      setStep("error");
    }
  };

  const toggleSelect = (id: string) => setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const movePhoto = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= croppedPhotos.length) return;
    setCroppedPhotos((prev) => { const a = [...prev]; [a[index], a[next]] = [a[next], a[index]]; return a; });
  };

  const openCrop = (photo: CroppedPhoto) => {
    setCropTargetId(photo.id);
    setActiveCrop(undefined); // always start blank — user draws their own
    setStep("cropping");
  };

  const cancelCrop = () => {
    setCropTargetId(null);
    setActiveCrop(undefined);
    setStep("photos");
  };

  const applyCrop = async () => {
    if (!cropTargetId) return;
    setCropSaving(true);
    const photo = croppedPhotos.find((p) => p.id === cropTargetId);
    if (!photo) { setCropSaving(false); return; }

    let norm: NormCrop | null = null;
    if (activeCrop && (activeCrop as any).width > 1 && (activeCrop as any).height > 1) {
      norm = {
        x: activeCrop.x / 100,
        y: activeCrop.y / 100,
        w: (activeCrop as any).width / 100,
        h: (activeCrop as any).height / 100,
      };
    }
    const { file, preview } = await cropToFile(photo.originalFile, photo.originalPreview, norm);
    setCroppedPhotos((prev) => prev.map((p) => p.id === cropTargetId ? { ...p, file, preview, normCrop: norm } : p));
    setCropTargetId(null);
    setActiveCrop(undefined);
    setCropSaving(false);
    setStep("photos");
  };

  const handlePhotosNext = () => {
    const files = croppedPhotos.filter((p) => selectedIds.has(p.id)).map((p) => p.file);
    setImportedPhotos(files);
    setStep("done");
  };

  const handleListExtracted = () => {
    if (!extracted) return;
    sessionStorage.setItem("shareswap_import_data", JSON.stringify(extracted));
    handleClose();
    navigate("/lend");
  };

  const handleEnterManually = () => { handleClose(); navigate("/lend"); };

  const resetToUpload = () => {
    fileItems.forEach((f) => URL.revokeObjectURL(f.preview));
    croppedPhotos.forEach((p) => URL.revokeObjectURL(p.originalPreview));
    setFileItems([]); setExtracted(null); setCroppedPhotos([]); setSelectedIds(new Set());
    setCropTargetId(null); setActiveCrop(undefined);
    setStep("upload");
  };

  const cropTargetPhoto = croppedPhotos.find((p) => p.id === cropTargetId);

  const subtitleText =
    step === "cropping" ? "Draw a box around the product only."
    : step === "photos" ? "Keep, remove, reorder, or recrop detected photos."
    : step === "done" ? "Review and edit listing details before publishing."
    : step === "scanning" ? "Our AI is reading your listing…"
    : step === "error" ? "Something went wrong. Try uploading clearer screenshots."
    : "Upload screenshots of your listing from other platforms to generate new listing details.";

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileInputChange} />

        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 text-teal-600" />
            </div>
            <DialogTitle className="text-xl font-bold">
              {step === "cropping" ? "Crop Photo" : "Import Marketplace Listing"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">{subtitleText}</DialogDescription>
        </DialogHeader>

        {/* ── Upload ─────────────────────────────────────── */}
        {step === "upload" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <span key={p} className="text-xs font-medium px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-100">{p}</span>
              ))}
            </div>

            <div
              onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
              onDragOver={handleDragOver} onDrop={handleDrop}
              onClick={() => fileItems.length === 0 && fileRef.current?.click()}
              className={`relative rounded-xl border-2 border-dashed transition-colors ${isDragging ? "border-teal-400 bg-teal-50" : fileItems.length === 0 ? "border-gray-200 bg-gray-50 hover:border-teal-300 hover:bg-teal-50/30 cursor-pointer" : "border-gray-200 bg-gray-50"}`}
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
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {fileItems.map((item, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200 group">
                        <img src={item.preview} alt={`Screenshot ${i + 1}`} className="w-full h-full object-cover" />
                        <button onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {fileItems.length < 5 && (
                      <button onClick={() => fileRef.current?.click()} className="aspect-square rounded-lg border-2 border-dashed border-gray-300 hover:border-teal-400 hover:bg-teal-50 flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-teal-600 transition-colors">
                        <Plus className="h-5 w-5" />
                        <span className="text-[10px] font-medium">Add more</span>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground text-center">{fileItems.length}/5 screenshot{fileItems.length !== 1 ? "s" : ""} selected</p>
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground text-center">Screenshots showing the item gallery work best.</p>

            <div className="space-y-2">
              <Button onClick={handleScan} disabled={fileItems.length === 0} className="w-full h-12 text-white font-semibold text-base gap-2" style={{ backgroundColor: "#0DCEA1" }}>
                <Sparkles className="h-4 w-4" /> Scan listing
              </Button>
              <Button variant="ghost" onClick={handleEnterManually} className="w-full h-10 text-muted-foreground gap-2">
                <Pencil className="h-4 w-4" /> Enter manually instead
              </Button>
            </div>
          </div>
        )}

        {/* ── Scanning ──────────────────────────────────── */}
        {step === "scanning" && (
          <div className="py-12 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-teal-600 animate-spin" />
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-lg">Scanning your listing…</p>
              <p className="text-sm text-muted-foreground mt-1">Extracting item details and cropping photos</p>
            </div>
          </div>
        )}

        {/* ── Photos review ─────────────────────────────── */}
        {step === "photos" && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {croppedPhotos.length} screenshot{croppedPhotos.length !== 1 ? "s" : ""} — {selectedIds.size} selected.
              Tap to keep or remove. Use the crop icon to remove UI chrome before using as a listing photo.
            </p>

            <div className="grid grid-cols-3 gap-3">
              {croppedPhotos.map((photo, i) => {
                const isSelected = selectedIds.has(photo.id);
                return (
                  <div key={photo.id} className="space-y-1.5">
                    <button
                      onClick={() => toggleSelect(photo.id)}
                      className={`relative w-full aspect-square rounded-xl overflow-hidden border-2 transition-all ${isSelected ? "border-teal-500 ring-2 ring-teal-200" : "border-gray-200 opacity-50 hover:opacity-70"}`}
                    >
                      <img src={photo.preview} alt={`Photo ${i + 1}`} className="w-full h-full object-contain bg-gray-100" />
                      <div className={`absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center shadow ${isSelected ? "bg-teal-500" : "bg-gray-400/80"}`}>
                        {isSelected ? <Check className="h-3 w-3 text-white" /> : <X className="h-3 w-3 text-white" />}
                      </div>
                    </button>

                    <div className="flex items-center gap-1">
                      <button onClick={() => movePhoto(i, -1)} disabled={i === 0} className="flex-1 h-6 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30 flex items-center justify-center transition-colors">
                        <ArrowLeft className="h-3 w-3 text-gray-600" />
                      </button>
                      <button onClick={() => openCrop(photo)} className="flex-1 h-6 rounded bg-gray-100 hover:bg-teal-50 flex items-center justify-center transition-colors" title="Recrop">
                        <CropIcon className="h-3 w-3 text-gray-600" />
                      </button>
                      <button onClick={() => movePhoto(i, 1)} disabled={i === croppedPhotos.length - 1} className="flex-1 h-6 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30 flex items-center justify-center transition-colors">
                        <ArrowRight className="h-3 w-3 text-gray-600" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={resetToUpload} className="flex-1">← Back</Button>
              <Button onClick={handlePhotosNext} className="flex-[2] text-white gap-1" style={{ backgroundColor: "#0DCEA1" }}>
                {selectedIds.size > 0 ? `Use ${selectedIds.size} photo${selectedIds.size !== 1 ? "s" : ""}` : "Skip photos"} →
              </Button>
            </div>
          </div>
        )}

        {/* ── Inline crop UI ─────────────────────────────── */}
        {step === "cropping" && cropTargetPhoto && (
          <div className="space-y-3">
            <div className="rounded-xl overflow-hidden bg-gray-950 flex items-center justify-center" style={{ minHeight: 260 }}>
              <ReactCrop
                crop={activeCrop}
                onChange={(_, pct) => setActiveCrop(pct)}
                keepSelection={false}
                style={{ maxWidth: "100%", maxHeight: "56vh" }}
              >
                <img
                  ref={cropImgRef}
                  src={cropTargetPhoto.originalPreview}
                  alt="Crop source"
                  style={{ maxWidth: "100%", maxHeight: "56vh", objectFit: "contain", display: "block" }}
                />
              </ReactCrop>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Click and drag to select the product area · click outside selection to redraw
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={cancelCrop} className="flex-1">← Back</Button>
              <Button
                onClick={applyCrop}
                disabled={cropSaving || !activeCrop || (activeCrop as any).width <= 1}
                className="flex-[2] text-white gap-1"
                style={{ backgroundColor: "#0DCEA1" }}
              >
                {cropSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Apply crop
              </Button>
            </div>
          </div>
        )}

        {/* ── Done ──────────────────────────────────────── */}
        {step === "done" && extracted && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-green-800">Details extracted!</p>
                <p className="text-sm text-green-700">We'll pre-fill your listing form — you can review and edit everything before publishing.</p>
              </div>
            </div>

            <div className="bg-white border rounded-xl p-4 space-y-3 text-sm max-h-60 overflow-y-auto">
              {extracted.name && <Row label="Item" value={extracted.name} />}
              {extracted.brand && <Row label="Brand" value={`${extracted.brand}${extracted.isLuxury ? " ✦ Luxury" : ""}`} />}
              {extracted.itemType && <Row label="Category" value={extracted.itemType} />}
              {extracted.condition && <Row label="Condition" value={`${extracted.condition} (${extracted.conditionRating}/10)`} />}
              {extracted.originalValue && <Row label="Original price" value={extracted.originalValue} />}
              {extracted.suggestedTier > 0 && <Row label="Sharing tier" value={`Tier ${extracted.suggestedTier}`} />}
              {extracted.modelVersion && <Row label="Model / version" value={extracted.modelVersion} />}
              {extracted.visibleDamage && <Row label="Visible damage" value={extracted.visibleDamage} className="text-amber-700" />}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("photos")} className="flex-1">← Back</Button>
              <Button onClick={handleListExtracted} className="flex-[2] text-white gap-1" style={{ backgroundColor: "#0DCEA1" }}>
                List this item →
              </Button>
            </div>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────── */}
        {step === "error" && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex gap-4">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-red-900">We couldn't read this listing clearly</p>
                <p className="text-sm text-red-700">Try uploading clearer or higher-resolution screenshots that show the full listing details.</p>
              </div>
            </div>
            <div className="space-y-2">
              <Button onClick={resetToUpload} className="w-full h-12 text-white font-semibold gap-2" style={{ backgroundColor: "#0DCEA1" }}>
                <Upload className="h-4 w-4" /> Try different screenshots
              </Button>
              <Button variant="ghost" onClick={handleEnterManually} className="w-full h-10 text-muted-foreground gap-2">
                <Pencil className="h-4 w-4" /> Enter manually instead
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
