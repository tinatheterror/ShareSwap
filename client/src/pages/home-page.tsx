import { Navbar } from "@/components/shared/navbar";
import { OnboardingTutorial } from "@/components/onboarding-tutorial";
import { ListItemModal } from "@/components/list-item-modal";
import { ImportListingModal } from "@/components/import-listing-modal";
import { WishlistFulfillmentPopup } from "@/components/wishlist-fulfillment-popup";
import { useLocation, useSearch } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle, X, Plus, Download, Heart } from "lucide-react";
import { HeartPeopleIcon } from "@/components/ui/heart-people-icon";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

type GiveModal = "choice" | "list" | "import" | "wishlist" | null;

export default function HomePage() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showTutorial, setShowTutorial] = useState(false);
  const [showReferralBanner, setShowReferralBanner] = useState(false);
  const [showVerifiedBanner, setShowVerifiedBanner] = useState(false);
  const [giveModal, setGiveModal] = useState<GiveModal>(null);

  // Tutorial: show after location setup is done, or immediately if already done
  useEffect(() => {
    if (!user) return;
    const tutorialKey = `hasSeenTutorial_${user.id}`;
    if (localStorage.getItem(tutorialKey)) return;

    if ((user as any).hasCompletedLocationSetup) {
      setShowTutorial(true);
    } else {
      const handleLocationDone = () => setShowTutorial(true);
      window.addEventListener("location-setup-complete", handleLocationDone, {
        once: true,
      });
      return () =>
        window.removeEventListener(
          "location-setup-complete",
          handleLocationDone,
        );
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(searchString);

    const emailVerified = params.get("verified") === "true";
    if (emailVerified) {
      setShowVerifiedBanner(true);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      window.history.replaceState({}, "", "/");
    }

    const referralFromUrl = params.get("referral") === "applied";
    const referralFromSession =
      sessionStorage.getItem("referralApplied") === "true";

    if (referralFromUrl || referralFromSession) {
      setShowReferralBanner(true);
      sessionStorage.removeItem("referralApplied");
      if (referralFromUrl) {
        window.history.replaceState({}, "", "/");
      }
    }
  }, [searchString, user]);

  const handleTutorialComplete = () => {
    if (user) {
      localStorage.setItem(`hasSeenTutorial_${user.id}`, "true");
    }
    setShowTutorial(false);
    window.dispatchEvent(new Event("tutorial-complete"));
  };

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex flex-col pb-safe pt-safe">
      <Navbar />

      {/* Email Verified Banner */}
      {showVerifiedBanner && (
        <div className="bg-green-50 border-b border-green-200">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="font-medium text-green-800">
                Your email is verified!
              </span>
            </div>
            <button
              onClick={() => setShowVerifiedBanner(false)}
              className="text-green-600 hover:text-green-800 p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Referral Applied Banner */}
      {showReferralBanner && (
        <div className="bg-green-50 border-b border-green-200">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <span className="font-medium text-green-800">
                  Referral code applied
                </span>
                <span className="text-green-700 text-sm ml-2">
                  Your friend will earn ShareCoins after your first transaction
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowReferralBanner(false)}
              className="text-green-600 hover:text-green-800 p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-0 pb-8 md:py-8 flex items-center justify-center">
        <div className="w-full flex flex-col md:flex-row items-center justify-center gap-12 md:gap-16">
          <div className="flex-shrink-0 mt-6 md:mt-0 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2 md:mb-8 text-center">
              <div>This is your Community</div>
              <div>ShareChest</div>
            </h1>
            <p className="text-lg text-muted-foreground font-semibold text-center">
              Share more, own less.
            </p>
          </div>
          <Card className="flex flex-col items-center justify-center gap-6 w-full max-w-sm p-8 bg-background shadow-lg">
            <div
              data-tutorial="give"
              className="w-full flex flex-col items-center gap-3"
            >
              <Button
                onClick={() => setGiveModal("choice")}
                className="w-full bg-primary hover:bg-primary/90 text-lg py-6 rounded-xl"
                size="lg"
              >
                Give
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Share your own treasures to the ShareChest
              </p>
            </div>

            <div className="flex items-center justify-center w-64 shrink-0 py-4">
              <img
                src="/sharechest.png"
                alt="Community ShareChest"
                className="w-full h-auto object-contain"
              />
            </div>

            <div
              data-tutorial="take"
              className="w-full flex flex-col items-center gap-3"
            >
              <Button
                onClick={() => navigate("/borrow")}
                className="w-full bg-primary hover:bg-primary/90 text-lg py-6 rounded-xl"
                size="lg"
              >
                Take
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Browse the ShareChest to find what you need
              </p>
            </div>
          </Card>
        </div>

        {/* Onboarding Tutorial */}
        {showTutorial && (
          <OnboardingTutorial onComplete={handleTutorialComplete} />
        )}
      </main>

      {/* Give Choice Dialog */}
      <Dialog
        open={giveModal === "choice"}
        onOpenChange={(open) => !open && setGiveModal(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-center">
              How would you like to share?
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <button
              onClick={() => setGiveModal("list")}
              className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 hover:bg-teal-50 transition-all text-left group"
            >
              <div className="w-11 h-11 rounded-full bg-teal-100 flex items-center justify-center shrink-0 group-hover:bg-teal-200 transition-colors">
                <Plus className="h-5 w-5 text-teal-700" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">List an item</p>
                <p className="text-xs text-muted-foreground">
                  Add item details or use ShareSmart Scan
                </p>
              </div>
            </button>

            <button
              onClick={() => setGiveModal("import")}
              className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 hover:bg-teal-50 transition-all text-left group"
            >
              <div className="w-11 h-11 rounded-full bg-teal-100 flex items-center justify-center shrink-0 group-hover:bg-teal-200 transition-colors">
                <Download className="h-5 w-5 text-teal-700" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Import a listing</p>
                <p className="text-xs text-muted-foreground">
                  From Facebook Marketplace or Craigslist
                </p>
              </div>
            </button>

            <button
              onClick={() => setGiveModal("wishlist")}
              className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 hover:bg-teal-50 transition-all text-left group"
            >
              <div className="w-11 h-11 rounded-full bg-teal-100 flex items-center justify-center shrink-0 group-hover:bg-teal-200 transition-colors">
                <HeartPeopleIcon className="h-5 w-5 text-teal-700" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">
                  See what people need
                </p>
                <p className="text-xs text-muted-foreground">
                  Fulfill a wishlist and earn ShareCoins
                </p>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* List Item Modal */}
      <ListItemModal
        isOpen={giveModal === "list"}
        onClose={() => setGiveModal(null)}
      />

      {/* Import Listing Modal */}
      <ImportListingModal
        isOpen={giveModal === "import"}
        onClose={() => setGiveModal(null)}
      />

      {/* See What People Need (Wishlist Fulfillment) */}
      <WishlistFulfillmentPopup
        isOpen={giveModal === "wishlist"}
        onClose={() => setGiveModal(null)}
      />
    </div>
  );
}
