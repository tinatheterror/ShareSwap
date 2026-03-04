import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, ChevronLeft, ChevronRight, CheckCircle } from "lucide-react";

import { ReactNode } from "react";

interface TutorialStep {
  id: number;
  title: string;
  description: ReactNode;
  highlightSelector?: string;
  requiresMenu?: boolean;
  positionAbove?: boolean;
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
    title: "Welcome to ShareSwap!",
    description: (
      <>
        ShareSwap is your neighbourhood sharing marketplace where you can{" "}
        <strong>borrow, lend, rent, swap, and gift items</strong> with people
        nearby. This quick tour will walk you through each feature. You can skip
        at any time.
      </>
    ),
  },
  {
    id: 2,
    title: "Give to the ShareChest",
    description:
      "This is where you list items you'd like to share with your community. You can lend, rent, swap, or gift anything you're not using. When someone borrows your item, you earn ShareCoins as a reward.",
    highlightSelector: '[data-tutorial="give"]',
    positionAbove: true,
  },
  {
    id: 3,
    title: "Take from the ShareChest",
    description:
      "Browse to find items available near you. You can borrow items using your ShareCoins, rent items with cash, request a swap for something you own, or claim free gifts. Use filters and search to find exactly what you need.",
    highlightSelector: '[data-tutorial="take"]',
    positionAbove: true,
  },
  {
    id: 4,
    title: "ShareCoin Wallet",
    description:
      "Your ShareCoin balance is shown here. ShareCoins are the currency of ShareSwap — you earn them by lending items and helping neighbours, and spend them to borrow things you need. Tap your wallet to see your full transaction history.",
    highlightSelector: '[data-tutorial="wallet"]',
    positionAbove: false,
  },
  {
    id: 5,
    title: "Earn More ShareCoins",
    description:
      "Need more ShareCoins? Tap on your wallet to discover all the ways you can earn: complete transactions, fulfill a neighbour's wishlist, invite friends to join, or play sponsored games for instant rewards.",
    highlightSelector: '[data-tutorial="wallet"]',
    positionAbove: false,
  },
  {
    id: 6,
    title: "Play Games to Earn",
    description:
      'Play sponsored games ShareSwap has partnered with to earn ShareCoins instantly. Look inside the "Earn More ShareCoins" dropdown in your wallet for the games section — it\'s a fun way to build up your balance.',
    highlightSelector: '[data-tutorial="wallet"]',
    positionAbove: false,
  },
  {
    id: 7,
    title: "Earn Achievements",
    description:
      "As you participate in the sharing community, you'll unlock badges. Each achievement builds your trust score which shows neighbours that you are active and reliable. Reaching higher trust scores will unlock community benefits like discounted deposits.",
  },
  {
    id: 8,
    title: "My ShareChest",
    description:
      "This is your personal inventory — view, edit, and manage all the items you've listed. You can update availability, adjust pricing, check who's requested your items, and track items that are currently out on loan.",
    highlightSelector: '[data-tutorial="sharechest"]',
    requiresMenu: true,
    positionAbove: true,
  },
  {
    id: 9,
    title: "My Wishlist",
    description:
      "If you can't find what you're looking for, add it to your wishlist. Your neighbours will be able to see what you need, and you'll get notified when a matching item is listed.",
    highlightSelector: '[data-tutorial="wishlist"]',
    requiresMenu: true,
    positionAbove: true,
  },
  {
    id: 10,
    title: "You're All Set!",
    description:
      "You now know the basics of ShareSwap. Start by listing an item you'd like to share, or browse the ShareChest to see what's available near you. The more you share, the more you earn — and the stronger your community becomes.",
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
  const [isMobile, setIsMobile] = useState(false);
  const rafRef = useRef<number | null>(null);
  const menuOpenedForStep = useRef<number | null>(null);

  const step = tutorialSteps[currentStep];

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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
      const needsMenu = step.requiresMenu && isMobile;

      if (needsMenu) {
        window.dispatchEvent(new CustomEvent("tutorial-open-mobile-menu"));
        menuOpenedForStep.current = currentStep;
      } else if (
        menuOpenedForStep.current !== null &&
        menuOpenedForStep.current !== currentStep
      ) {
        window.dispatchEvent(new CustomEvent("tutorial-close-mobile-menu"));
        menuOpenedForStep.current = null;
      }

      const delay = needsMenu ? 400 : 50;

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

      const initialTimer = setTimeout(findAndHighlightElement, delay);
      const retryTimer = setTimeout(findAndHighlightElement, delay + 300);

      return () => {
        clearTimeout(initialTimer);
        clearTimeout(retryTimer);
      };
    } else {
      if (menuOpenedForStep.current !== null) {
        window.dispatchEvent(new CustomEvent("tutorial-close-mobile-menu"));
        menuOpenedForStep.current = null;
      }
      setHighlightedElement(null);
      setElementRect(null);
    }
  }, [
    currentStep,
    step.highlightSelector,
    step.requiresMenu,
    isMobile,
    calculateElementRect,
  ]);

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
    window.dispatchEvent(new CustomEvent("tutorial-close-mobile-menu"));
    menuOpenedForStep.current = null;
    setHighlightedElement(null);
    setElementRect(null);
    onComplete();
  };

  const handleSkip = () => {
    window.dispatchEvent(new CustomEvent("tutorial-close-mobile-menu"));
    menuOpenedForStep.current = null;
    setHighlightedElement(null);
    setElementRect(null);
    onComplete();
  };

  const spotlightRadius = elementRect
    ? Math.max(elementRect.width, elementRect.height) / 2 + 20
    : 0;

  const getCardPosition = (): React.CSSProperties => {
    if (!elementRect) {
      return {};
    }

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const cardMaxWidth = Math.min(400, viewportWidth - 32);
    const estimatedCardHeight = 340;
    const gap = 16;

    const spotlightTop = elementRect.top - 28;
    const spotlightBottom = elementRect.top + elementRect.height + 28;

    let top: number;

    if (step.positionAbove === true) {
      // Explicitly place above the element
      top = spotlightTop - estimatedCardHeight - gap;
    } else if (step.positionAbove === false) {
      // Explicitly place below the element
      top = spotlightBottom + gap;
    } else {
      // Auto: prefer below, fall back to above
      const spaceBelow = viewportHeight - spotlightBottom;
      const spaceAbove = spotlightTop;
      if (spaceBelow >= estimatedCardHeight + gap) {
        top = spotlightBottom + gap;
      } else if (spaceAbove >= estimatedCardHeight + gap) {
        top = spotlightTop - estimatedCardHeight - gap;
      } else if (spaceBelow > spaceAbove) {
        top = spotlightBottom + gap;
      } else {
        top = Math.max(gap, spotlightTop - estimatedCardHeight - gap);
      }
    }

    top = Math.max(
      gap,
      Math.min(top, viewportHeight - estimatedCardHeight - gap),
    );

    let left = elementRect.centerX - cardMaxWidth / 2;
    left = Math.max(16, Math.min(left, viewportWidth - cardMaxWidth - 16));

    return {
      position: "fixed" as const,
      top: `${top}px`,
      left: `${left}px`,
      width: `${cardMaxWidth}px`,
    };
  };

  const hasSpotlight = !!elementRect;
  const cardStyle = hasSpotlight ? getCardPosition() : {};

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

      <div
        className={`fixed z-[9999] pointer-events-none px-4 ${
          hasSpotlight ? "" : "inset-0 flex items-center justify-center"
        }`}
        style={hasSpotlight ? { ...cardStyle } : {}}
      >
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
              <CardContent className="p-5">
                <button
                  onClick={handleSkip}
                  className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
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

                <div className="text-left mb-4 pr-4">
                  <h3 className="text-lg font-bold text-slate-800 mb-2">
                    {step.title}
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {step.description}
                  </p>
                </div>

                <div className="text-center mb-3">
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
                      className="flex-1"
                      style={{ backgroundColor: "#0DCEA1" }}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleComplete}
                      className="flex-1"
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
