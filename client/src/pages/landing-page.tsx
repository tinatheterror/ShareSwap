import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { HandIcon, Box } from "lucide-react";

export default function LandingPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
      <div className="max-w-4xl mx-auto px-4 text-center">
        <div className="mb-12 flex justify-center">
          <div className="relative w-48 h-48 md:w-64 md:h-64">
            {/* Treasure Chest SVG */}
            <svg
              viewBox="0 0 200 200"
              className="w-full h-full"
              style={{ color: '#2dd4bf' }} // Turquoise color
            >
              <path
                fill="currentColor"
                d="M20,80 L180,80 L180,180 L20,180 Z" // Chest base
              />
              <path
                fill="currentColor"
                d="M40,40 L160,40 L180,80 L20,80 Z" // Chest lid
              />
              <path
                fill="white"
                d="M90,100 L110,100 L110,120 L90,120 Z" // Lock accent
              />
            </svg>
            <HandIcon 
              className="absolute -top-8 left-1/2 transform -translate-x-1/2 w-12 h-12 text-primary animate-bounce"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          <div className="space-y-4">
            <Button 
              className="w-full py-8 text-xl"
              onClick={() => navigate("/auth?action=browse")}
            >
              Take
              <Box className="ml-2 h-5 w-5" />
            </Button>
            <p className="text-sm text-muted-foreground">
              Browse the community ShareChest to find what you need
            </p>
          </div>

          <div className="space-y-4">
            <Button 
              className="w-full py-8 text-xl"
              onClick={() => navigate("/auth?action=share")}
            >
              Give
              <HandIcon className="ml-2 h-5 w-5" />
            </Button>
            <p className="text-sm text-muted-foreground">
              Share your own treasures to the community ShareChest
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
