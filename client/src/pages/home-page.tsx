import { Navbar } from "@/components/shared/navbar";
import { OnboardingTutorial } from "@/components/onboarding-tutorial";
import { useLocation, useSearch } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle, X } from "lucide-react";

export default function HomePage() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const [showTutorial, setShowTutorial] = useState(false);
  const [showReferralBanner, setShowReferralBanner] = useState(false);
  const [showVerifiedBanner, setShowVerifiedBanner] = useState(false);

  // Check if user has seen tutorial, referral status, and email verification
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem("hasSeenTutorial");
    if (!hasSeenTutorial) {
      // Show tutorial immediately for first-time users
      setShowTutorial(true);
    }
    
    const params = new URLSearchParams(searchString);
    
    // Check for email verification success
    const emailVerified = params.get("verified") === "true";
    if (emailVerified) {
      setShowVerifiedBanner(true);
      // Clean up URL
      window.history.replaceState({}, "", "/");
    }
    
    // Check for referral applied - from sessionStorage (email signup) or URL (Google OAuth)
    const referralFromUrl = params.get("referral") === "applied";
    const referralFromSession = sessionStorage.getItem("referralApplied") === "true";
    
    if (referralFromUrl || referralFromSession) {
      setShowReferralBanner(true);
      sessionStorage.removeItem("referralApplied");
      // Clean up URL if it has the referral param
      if (referralFromUrl) {
        window.history.replaceState({}, "", "/");
      }
    }
  }, [searchString]);

  const handleTutorialComplete = () => {
    localStorage.setItem("hasSeenTutorial", "true");
    setShowTutorial(false);
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
              <span className="font-medium text-green-800">Your email is verified!</span>
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
                <span className="font-medium text-green-800">Referral code applied</span>
                <span className="text-green-700 text-sm ml-2">Your friend will earn ShareCoins after your first transaction</span>
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
      
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-0 pb-8 md:py-8 flex items-center justify-center overflow-hidden">
        <div className="flex flex-col md:flex-row items-center justify-center gap-12 md:gap-16">
          <div className="flex-shrink-0">
            <h1 className="text-4xl font-bold tracking-tight mb-8 text-center">
              <div>Your Community</div>
              <div>ShareChest</div>
            </h1>
            <p className="text-lg text-muted-foreground font-semibold text-left">
              Give what you can, take what you need.
            </p>
          </div>

          <Card className="flex flex-col items-center justify-center gap-6 w-full max-w-sm p-8 bg-background shadow-lg">
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
    </div>
  );
}
