import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, ChevronLeft, ChevronRight, Home, Coins, Gamepad2, Heart, CheckCircle, Package, Trophy } from 'lucide-react';

interface TutorialStep {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  highlightSelector?: string; // CSS selector for element to highlight
  position: 'center' | 'top' | 'bottom';
}

const tutorialSteps: TutorialStep[] = [
  {
    id: 1,
    title: 'Welcome to ShareSwap! 🎉',
    description: 'Let\'s take a quick tour to help you discover all the amazing features. You can skip this tutorial at any time.',
    icon: <Home className="h-8 w-8 text-teal-600" />,
    position: 'center'
  },
  {
    id: 2,
    title: 'Give to the ShareChest',
    description: 'Share your own treasures to the community ShareChest. Help your neighbours and earn ShareCoins!',
    icon: <Home className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="give"]',
    position: 'bottom'
  },
  {
    id: 3,
    title: 'Take from the ShareChest',
    description: 'Browse the community ShareChest to find what you need. Use ShareCoins to borrow items!',
    icon: <Home className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="take"]',
    position: 'bottom'
  },
  {
    id: 4,
    title: 'My ShareChest',
    description: 'Manage all your uploaded items in one place. View, edit, and track the availability of everything you\'re sharing with the community.',
    icon: <Home className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="sharechest"]',
    position: 'bottom'
  },
  {
    id: 5,
    title: 'Your ShareCoin Wallet',
    description: 'View your ShareCoin balance here. ShareCoins are the currency of our marketplace - use them to borrow items!',
    icon: <Coins className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="wallet"]',
    position: 'bottom'
  },
  {
    id: 6,
    title: 'Earn More ShareCoins',
    description: 'Click on your wallet to see ways to earn ShareCoins: play games, complete achievements, fulfill wishlists, and invite friends!',
    icon: <Coins className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="wallet"]',
    position: 'bottom'
  },
  {
    id: 7,
    title: 'Play Games to Earn',
    description: 'Complete sponsored games to earn ShareCoins! It\'s fun and rewarding - find it in the "Earn More ShareCoins" dropdown.',
    icon: <Gamepad2 className="h-8 w-8 text-teal-600" />,
    highlightSelector: '[data-tutorial="wallet"]',
    position: 'bottom'
  },
  {
    id: 8,
    title: 'Your Wishlist',
    description: 'Create demand signals for items you need. Add items to your wishlist and get notified when they become available in your area!',
    icon: <Heart className="h-8 w-8 text-teal-600" />,
    position: 'center'
  },
  {
    id: 9,
    title: 'Earn Achievements',
    description: 'Unlock badges by participating in the sharing community. Complete milestones, help neighbours, and earn rewards!',
    icon: <Trophy className="h-8 w-8 text-teal-600" />,
    position: 'center'
  },
  {
    id: 10,
    title: 'You\'re All Set! 🎊',
    description: 'You now know all the key features of ShareSwap. Start sharing, earning, and connecting with your community!',
    icon: <CheckCircle className="h-8 w-8 text-teal-600" />,
    position: 'center'
  }
];

interface OnboardingTutorialProps {
  onComplete: () => void;
}

export function OnboardingTutorial({ onComplete }: OnboardingTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [highlightedElement, setHighlightedElement] = useState<HTMLElement | null>(null);

  const step = tutorialSteps[currentStep];

  // Highlight effect
  useEffect(() => {
    if (step.highlightSelector) {
      const element = document.querySelector(step.highlightSelector) as HTMLElement;
      if (element) {
        setHighlightedElement(element);
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      setHighlightedElement(null);
    }
  }, [currentStep, step.highlightSelector]);

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
    onComplete();
  };

  const handleSkip = () => {
    setHighlightedElement(null);
    onComplete();
  };

  return (
    <>
      {/* Overlay with spotlight effect */}
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9998] pointer-events-none"
          style={{
            background: highlightedElement
              ? 'radial-gradient(circle at var(--spotlight-x) var(--spotlight-y), transparent 120px, rgba(0,0,0,0.7) 200px)'
              : 'rgba(0,0,0,0.7)',
            '--spotlight-x': highlightedElement
              ? `${highlightedElement.getBoundingClientRect().left + highlightedElement.getBoundingClientRect().width / 2}px`
              : '50%',
            '--spotlight-y': highlightedElement
              ? `${highlightedElement.getBoundingClientRect().top + highlightedElement.getBoundingClientRect().height / 2}px`
              : '50%'
          } as React.CSSProperties}
        />
      </AnimatePresence>

      {/* Tutorial Card - centered container */}
      <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className="pointer-events-auto w-[90%] max-w-md"
          >
          <Card className="border-2 border-teal-500 shadow-2xl bg-white/95 backdrop-blur-sm">
            <CardContent className="p-6">
              {/* Close button */}
              <button
                onClick={handleSkip}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Progress indicator */}
              <div className="flex items-center justify-center gap-1 mb-4">
                {tutorialSteps.map((_, index) => (
                  <div
                    key={index}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      index === currentStep
                        ? 'bg-teal-600 w-8'
                        : index < currentStep
                        ? 'bg-teal-400 w-1.5'
                        : 'bg-gray-300 w-1.5'
                    }`}
                  />
                ))}
              </div>

              {/* Icon */}
              <div className="flex justify-center mb-4">
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', duration: 0.6 }}
                  className="w-16 h-16 bg-gradient-to-br from-teal-50 to-teal-100 rounded-full flex items-center justify-center"
                >
                  {step.icon}
                </motion.div>
              </div>

              {/* Content */}
              <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-slate-800 mb-3">{step.title}</h3>
                <p className="text-slate-600 leading-relaxed">{step.description}</p>
              </div>

              {/* Step counter */}
              <div className="text-center mb-4">
                <Badge variant="secondary" className="bg-teal-100 text-teal-800">
                  Step {currentStep + 1} of {tutorialSteps.length}
                </Badge>
              </div>

              {/* Navigation buttons */}
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
                  <Button onClick={handleNext} className="flex-1 " style={{ backgroundColor: "#0DCEA1" }}>
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                ) : (
                  <Button onClick={handleComplete} className="flex-1 " style={{ backgroundColor: "#0DCEA1" }}>
                    Finish
                    <CheckCircle className="h-4 w-4 ml-1" />
                  </Button>
                )}
              </div>

              {/* Skip button */}
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

      {/* Highlight pulse effect */}
      {highlightedElement && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed z-[9997] pointer-events-none"
          style={{
            top: highlightedElement.getBoundingClientRect().top - 8,
            left: highlightedElement.getBoundingClientRect().left - 8,
            width: highlightedElement.getBoundingClientRect().width + 16,
            height: highlightedElement.getBoundingClientRect().height + 16,
            border: '3px solid #0d9488',
            borderRadius: '12px',
            boxShadow: '0 0 0 4px rgba(13, 148, 136, 0.3)',
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
          }}
        />
      )}
    </>
  );
}