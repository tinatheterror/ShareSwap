import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { HandIcon, Box } from "lucide-react";

export default function LandingPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
      <div className="max-w-4xl mx-auto px-4 text-center">
        <div className="mb-16 flex justify-center">
          <div className="relative w-56 h-56 md:w-72 md:h-72">
            {/* Enhanced Treasure Chest SVG with more details */}
            <svg
              viewBox="0 0 200 200"
              className="w-full h-full drop-shadow-xl transition-transform hover:scale-105 duration-300"
              style={{ color: '#20B2AA' }} // Adjusted seafoam green color
            >
              {/* Chest base with rounded corners */}
              <path
                fill="currentColor"
                d="M30,80 L170,80 L170,160 C170,170 160,180 150,180 L50,180 C40,180 30,170 30,160 Z"
              />
              {/* Curved lid with 3D effect */}
              <path
                fill="currentColor"
                d="M20,70 C20,60 30,50 40,50 L160,50 C170,50 180,60 180,70 L180,80 L20,80 C20,75 20,72 20,70"
              />
              {/* Decorative clasp */}
              <path
                fill="white"
                opacity="0.3"
                d="M90,90 L110,90 L110,120 L90,120 Z M95,95 L105,95 L105,115 L95,115 Z"
              />
              {/* Left hinge */}
              <path
                fill="white"
                opacity="0.2"
                d="M40,60 C40,55 45,50 50,50 L55,50 L55,70 L40,70 Z"
              />
              {/* Right hinge */}
              <path
                fill="white"
                opacity="0.2"
                d="M145,50 C150,50 155,55 155,60 L155,70 L140,70 L140,50 Z"
              />
              {/* Highlight effect */}
              <path
                fill="white"
                opacity="0.1"
                d="M30,80 L170,80 L165,85 L35,85 Z"
              />
            </svg>
            {/* Animated Hand Icon with enhanced animation */}
            <HandIcon 
              className="absolute -top-10 left-1/2 transform -translate-x-1/2 w-14 h-14 text-primary animate-bounce"
              style={{ 
                animationDuration: '2s',
                filter: 'drop-shadow(0 4px 3px rgb(0 0 0 / 0.07))',
                animation: 'bounce 2s infinite'
              }}
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-12 max-w-3xl mx-auto">
          <div className="space-y-6">
            <Button 
              className="w-full py-8 text-xl bg-primary hover:bg-primary/90 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-1"
              onClick={() => navigate("/auth?action=browse")}
            >
              Take
              <Box className="ml-2 h-6 w-6" />
            </Button>
            <p className="text-sm text-muted-foreground px-4">
              Browse the community ShareChest to find what you need
            </p>
          </div>

          <div className="space-y-6">
            <Button 
              className="w-full py-8 text-xl bg-primary hover:bg-primary/90 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-1"
              onClick={() => navigate("/auth?action=share")}
            >
              Give
              <HandIcon className="ml-2 h-6 w-6" />
            </Button>
            <p className="text-sm text-muted-foreground px-4">
              Share your own treasures to the community ShareChest
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}