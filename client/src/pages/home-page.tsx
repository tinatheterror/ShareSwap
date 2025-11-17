import { Navbar } from "@/components/shared/navbar";
import { WishlistFulfillmentPopup } from "@/components/wishlist-fulfillment-popup";
import { OnboardingTutorial } from "@/components/onboarding-tutorial";
import { Coins } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import shareChestImage from "../../../attached_assets/Tina_L_make_the_background_white_947fcd9a-2873-4576-814f-1d29e3f34c73_1763170291577.jpg";

export default function HomePage() {
  const [, navigate] = useLocation();
  const [showWishlistPopup, setShowWishlistPopup] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // Check if user has seen tutorial
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem("hasSeenTutorial");
    if (!hasSeenTutorial) {
      // Show tutorial after 1 second for first-time users
      const timer = setTimeout(() => {
        setShowTutorial(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleTutorialComplete = () => {
    localStorage.setItem("hasSeenTutorial", "true");
    setShowTutorial(false);
  };

  // Show popup after 3 seconds for demonstration
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowWishlistPopup(true);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            Your Community ShareChest
          </h1>
          <p className="text-lg text-muted-foreground">
            Share more, own less. Connect with your neighbours and discover a
            world of shared resources
          </p>
        </div>

        <div className="flex flex-col items-center justify-center gap-6 max-w-sm mx-auto">
          <div
            data-tutorial="give"
            className="w-full flex flex-col items-center gap-3"
          >
            <Button
              onClick={() => navigate("/lend")}
              className="w-full bg-primary hover:bg-primary/90 text-lg py-6 rounded-xl"
              size="lg"
            >
              Give
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Share your own treasures to the community ShareChest
            </p>
          </div>

          <div className="flex items-center justify-center w-64 shrink-0 bg-white py-4">
            <img
              src={shareChestImage}
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
              Browse the community ShareChest to find what you need
            </p>
          </div>
        </div>

        {/* Earn ShareCoins Button */}
        <div className="mt-8 max-w-5xl mx-auto flex justify-center">
          <Button
            size="lg"
            onClick={() => setShowWishlistPopup(true)}
            className="bg-primary hover:bg-primary/90 text-lg px-8 py-6 shadow-lg hover:shadow-xl transition-all"
          >
            <Coins className="h-6 w-6 mr-2" />
            Earn ShareCoins by Helping Neighbours
          </Button>
        </div>

        <WishlistFulfillmentPopup
          isOpen={showWishlistPopup}
          onClose={() => setShowWishlistPopup(false)}
        />

        {/* Onboarding Tutorial */}
        {showTutorial && (
          <OnboardingTutorial onComplete={handleTutorialComplete} />
        )}
      </main>
    </div>
  );
}
