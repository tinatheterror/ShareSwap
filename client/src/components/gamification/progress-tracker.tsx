import { Trophy, Flame, Target, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProgressTrackerProps {
  currentLevel: number;
  currentXP: number;
  nextLevelXP: number;
  streak: number;
  contributions: number;
}

export function ProgressTracker({ 
  currentLevel, 
  currentXP, 
  nextLevelXP, 
  streak, 
  contributions 
}: ProgressTrackerProps) {
  const progress = (currentXP / nextLevelXP) * 100;
  
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Your Progress</h3>
        <div className="flex items-center gap-1 text-primary">
          <Trophy className="w-5 h-5" />
          <span className="font-bold">Level {currentLevel}</span>
        </div>
      </div>
      
      {/* XP Progress Bar */}
      <div className="mb-6">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>{currentXP} XP</span>
          <span>{nextLevelXP} XP</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div 
            className="bg-gradient-to-r from-primary to-primary/80 h-3 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {nextLevelXP - currentXP} XP to next level
        </p>
      </div>
      
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-xl">
          <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
            <Flame className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <div className="text-lg font-bold text-orange-700">{streak}</div>
            <div className="text-xs text-orange-600">Day Streak</div>
          </div>
        </div>
        
        <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
            <Users className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <div className="text-lg font-bold text-green-700">{contributions}</div>
            <div className="text-xs text-green-600">Contributions</div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface BadgeProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  earned: boolean;
  progress?: number;
}

export function CommunityBadge({ title, description, icon, earned, progress }: BadgeProps) {
  return (
    <div className={cn(
      "p-4 rounded-xl border-2 transition-all",
      earned 
        ? "border-primary bg-primary/5" 
        : "border-gray-200 bg-gray-50"
    )}>
      <div className="flex items-center gap-3 mb-2">
        <div className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center",
          earned ? "bg-primary text-white" : "bg-gray-200 text-gray-500"
        )}>
          {icon}
        </div>
        <div>
          <h4 className={cn(
            "font-semibold",
            earned ? "text-gray-900" : "text-gray-500"
          )}>
            {title}
          </h4>
        </div>
      </div>
      <p className={cn(
        "text-sm mb-2",
        earned ? "text-gray-700" : "text-gray-500"
      )}>
        {description}
      </p>
      
      {!earned && progress !== undefined && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-primary h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}