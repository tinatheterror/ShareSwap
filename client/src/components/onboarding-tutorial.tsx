import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Home,
  Coins,
  Gamepad2,
  Heart,
  CheckCircle,
  Package,
  Trophy,
} from "lucide-react";

interface TutorialStep {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  highlightSelector?: string;
  position: "center" | "top" | "bottom";
}

interface ElementRect {
  top: number;
  left: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

const tutorialSteps: TutorialStep[] = [
  {
    id: 1,
    title: "Welcome to ShareSwap! 🥳",
    description:
      "Let's tour all the amazing features. You can skip this tutorial at any time.",
    icon: <Home className="h-8 w-8 text-teal-600" />,
    position: "center",
  },
  {
    id: 2,
    title: "Give to the ShareChest",
    description:
      "Add in your own items to the ShareChest. Earn ShareCoins for helping neighbours!",
    icon: <Home className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="give"]',
    position: "bottom",
  },
  {
    id: 3,
    title: "Take from the ShareChest",
    description:
      "Browse the ShareChest for what you need. Use ShareCoins to borrow items!",
    icon: <Home className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="take"]',
    position: "bottom",
  },
  {
    id: 4,
    title: "My ShareChest",
    description:
      "View all your listed items. Manage, edit, and track everything you're sharing with the community.",
    icon: <Home className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="sharechest"]',
    position: "bottom",
  },
  {
    id: 5,
    title: "ShareCoin Wallet",
    description:
      "View your ShareCoin balance. ShareCoins are the currency of our marketplace - use them to borrow items!",
    icon: <Coins className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="wallet"]',
    position: "bottom",
  },
  {
    id: 6,
    title: "Earn More ShareCoins",
    description:
      "Tap on your wallet to see ways to earn ShareCoins: play games, fulfill wishlists, and invite friends!",
    icon: <Coins className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="wallet"]',
    position: "bottom",
  },
  {
    id: 7,
    title: "Play Games to Earn",
    description:
      'Complete sponsored games and get rewarded with ShareCoins! Find it in the "Earn More ShareCoins" dropdown.',
    icon: <Gamepad2 className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="wallet"]',
    position: "bottom",
  },
  {
    id: 8,
    title: "My Wishlist",
    description:
      "Need anything? Add items to your wishlist and get notified when they become available in your area!",
    icon: <Heart className="h-8 w-8 text-teal-600" />,
    position: "center",
  },
  {
    id: 9,
    title: "Earn Achievements",
    description:
      "Unlock badges by participating in the sharing community. Complete milestones, help neighbours, and earn rewards!",
    icon: <Trophy className="h-8 w-8 text-teal-600" />,
    position: "center",
  },
  {
    id: 10,
    title: "You're All Set! 🎊",
    description: "Start sharing, earning, and connecting with your village!",
    icon: <CheckCircle className="h-8 w-8 text-teal-600" />,
    position: "center",
  },
];

interface OnboardingTutorialProps {
  onComplete: () => void;
}

export function OnboardingTutorial({ onComplete }: OnboardingTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [highlightedElement, setHighlightedElement] =
    useState<HTMLElement | null>(null);
  const [elementRect, setElementRect] = useState<ElementRect | null>(null);
  const rafRef = useRef<number | null>(null);

  const step = tutorialSteps[currentStep];

  const calculateElementRect = useCallback(
    (element: HTMLElement | null): ElementRect | null => {
      if (!element) return null;

      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      };
    },
    [],
  );

  useEffect(() => {
    if (step.highlightSelector) {
      const findAndHighlightElement = () => {
        const element = document.querySelector(
          step.highlightSelector!,
        ) as HTMLElement;
        if (element) {
          setHighlightedElement(element);

          element.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "center",
          });

          setTimeout(() => {
            const rect = calculateElementRect(element);
            setElementRect(rect);
          }, 100);
        } else {
          setHighlightedElement(null);
          setElementRect(null);
        }
      };

      findAndHighlightElement();

      const retryTimer = setTimeout(findAndHighlightElement, 300);

      return () => clearTimeout(retryTimer);
    } else {
      setHighlightedElement(null);
      setElementRect(null);
    }
  }, [currentStep, step.highlightSelector, calculateElementRect]);

  useEffect(() => {
    if (!highlightedElement) return;

    let lastUpdate = 0;
    const throttleMs = 200;

    const handleUpdate = () => {
      const now = Date.now();
      if (now - lastUpdate < throttleMs) return;
      lastUpdate = now;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const newRect = calculateElementRect(highlightedElement);
        setElementRect(newRect);
      });
    };

    window.addEventListener("resize", handleUpdate);
    window.addEventListener("orientationchange", handleUpdate);

    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("orientationchange", handleUpdate);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [highlightedElement, calculateElementRect]);

  const handleNext = () => {
    if (currentStep < tutorialSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    setHighlightedElement(null);
    setElementRect(null);
    onComplete();
  };

  const handleSkip = () => {
    setHighlightedElement(null);
    setElementRect(null);
    onComplete();
  };

  const spotlightRadius = elementRect
    ? Math.max(elementRect.width, elementRect.height) / 2 + 20
    : 0;

  return (
    <>
      {elementRect && (
        <svg
          className="fixed inset-0 z-[9997] pointer-events-none"
          style={{ width: "100vw", height: "100vh" }}
        >
          <defs>
            <mask id="spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <ellipse
                cx={elementRect.centerX}
                cy={elementRect.centerY}
                rx={spotlightRadius}
                ry={spotlightRadius}
                fill="black"
              />
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.7)"
            mask="url(#spotlight-mask)"
          />
        </svg>
      )}

      {!elementRect && (
        <div
          className="fixed inset-0 z-[9997] pointer-events-none"
          style={{ background: "rgba(0,0,0,0.7)" }}
        />
      )}

      <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none px-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className="pointer-events-auto w-full max-w-md"
          >
            <Card className="border-2 border-teal-500 shadow-2xl bg-white/95 backdrop-blur-sm">
              <CardContent className="p-6">
                <button
                  onClick={handleSkip}
                  className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>

                <div className="flex items-center justify-center gap-1 mb-4">
                  {tutorialSteps.map((_, index) => (
                    <div
                      key={index}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        index === currentStep
                          ? "bg-teal-600 w-8"
                          : index < currentStep
                            ? "bg-teal-400 w-1.5"
                            : "bg-gray-300 w-1.5"
                      }`}
                    />
                  ))}
                </div>

                <div className="flex justify-center mb-4">
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", duration: 0.6 }}
                    className="w-16 h-16 bg-gradient-to-br from-teal-50 to-teal-100 rounded-full flex items-center justify-center"
                  >
                    {step.icon}
                  </motion.div>
                </div>

                <div className="text-center mb-6">
                  <h3 className="text-xl font-bold text-slate-800 mb-3">
                    {step.title}
                  </h3>
                  <p className="text-slate-600 leading-relaxed">
                    {step.description}
                  </p>
                </div>

                <div className="text-center mb-4">
                  <Badge
                    variant="secondary"
                    className="bg-teal-100 text-teal-800"
                  >
                    Step {currentStep + 1} of {tutorialSteps.length}
                  </Badge>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="outline"
                    onClick={handleBack}
                    disabled={currentStep === 0}
                    className="flex-1"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>

                  {currentStep < tutorialSteps.length - 1 ? (
                    <Button
                      onClick={handleNext}
                      className="flex-1 "
                      style={{ backgroundColor: "#0DCEA1" }}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleComplete}
                      className="flex-1 "
                      style={{ backgroundColor: "#0DCEA1" }}
                    >
                      Finish
                      <CheckCircle className="h-4 w-4 ml-1" />
                    </Button>
                  )}
                </div>

                {currentStep < tutorialSteps.length - 1 && (
                  <button
                    onClick={handleSkip}
                    className="w-full mt-3 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Skip tutorial
                  </button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </AnimatePresence>
      </div>

      {elementRect && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed z-[9998] pointer-events-none"
          style={{
            top: elementRect.top - 8,
            left: elementRect.left - 8,
            width: elementRect.width + 16,
            height: elementRect.height + 16,
            border: "3px solid #0d9488",
            borderRadius: "12px",
            boxShadow: "0 0 0 4px rgba(13, 148, 136, 0.3)",
            animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          }}
        />
      )}
    </>
  );
}
