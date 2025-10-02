import { MarketplaceCard } from "@/components/shared/marketplace-card";
import { Navbar } from "@/components/shared/navbar";
import { WishlistFulfillmentPopup } from "@/components/wishlist-fulfillment-popup";
import { OnboardingTutorial } from "@/components/onboarding-tutorial";
import { HandshakeIcon, Banknote, ArrowLeftRight, Coins } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const [, navigate] = useLocation();
  const [showWishlistPopup, setShowWishlistPopup] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // Check if user has seen tutorial
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem('hasSeenTutorial');
    if (!hasSeenTutorial) {
      // Show tutorial after 1 second for first-time users
      const timer = setTimeout(() => {
        setShowTutorial(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleTutorialComplete = () => {
    localStorage.setItem('hasSeenTutorial', 'true');
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
            Lend, Rent, or Swap it out
          </h1>
          <p className="text-lg text-muted-foreground">
            Share more, own less. Connect with your neighbours and discover a world of shared resources
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div data-tutorial="lend-borrow">
            <MarketplaceCard
              title="Lend & Borrow"
              description="Share items with trusted community members"
              icon={<HandshakeIcon className="w-8 h-8 text-primary" />}
              onClick={() => navigate("/share-options")}
              buttonText="Let's Share"
            />
          </div>
          <div data-tutorial="rent">
            <MarketplaceCard
              title="Rent It"
              description="Earn real money by renting out your items securely"
              icon={<Banknote className="w-8 h-8 text-primary" />}
              onClick={() => navigate("/rent")}
              buttonText="Let's Rent"
            />
          </div>
          <div data-tutorial="swap">
            <MarketplaceCard
              title="Swap It"
              description="Exchange items with other verified users"
              icon={<ArrowLeftRight className="w-8 h-8 text-primary" />}
              onClick={() => navigate("/swap")}
              buttonText="Let's Swap"
            />
          </div>
        </div>

        {/* Quick access to wishlist fulfillment */}
        <div className="mt-12 text-center" data-tutorial="earn-button">
          <Button
            onClick={() => navigate('/sharecoins-info')}
            className="bg-teal-600 hover:bg-teal-700 text-white px-8"
          >
            <Coins className="h-4 w-4 mr-2" />
            Earn ShareCoins by Helping Neighbors
          </Button>
        </div>

        <WishlistFulfillmentPopup
          isOpen={showWishlistPopup}
          onClose={() => setShowWishlistPopup(false)}
        />

        {/* Onboarding Tutorial */}
        {showTutorial && <OnboardingTutorial onComplete={handleTutorialComplete} />}
      </main>
    </div>
  );
}