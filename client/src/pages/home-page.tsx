import { Navbar } from "@/components/shared/navbar";
import { OnboardingTutorial } from "@/components/onboarding-tutorial";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function HomePage() {
  const [, navigate] = useLocation();
  const [showTutorial, setShowTutorial] = useState(false);

  // Check if user has seen tutorial
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem("hasSeenTutorial");
    if (!hasSeenTutorial) {
      // Show tutorial immediately for first-time users
      setShowTutorial(true);
    }
  }, []);

  const handleTutorialComplete = () => {
    localStorage.setItem("hasSeenTutorial", "true");
    setShowTutorial(false);
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
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
