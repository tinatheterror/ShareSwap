import { Shield, Star, Award, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type VerificationLevel = "new" | "verified" | "trusted" | "expert";

interface VerificationBadgeProps {
  level: VerificationLevel;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

const verificationConfig = {
  new: {
    icon: Shield,
    label: "New Member",
    color: "bg-gray-100 text-gray-600",
    iconColor: "text-gray-500"
  },
  verified: {
    icon: CheckCircle,
    label: "Verified",
    color: "bg-blue-100 text-blue-700",
    iconColor: "text-blue-600"
  },
  trusted: {
    icon: Star,
    label: "Trusted",
    color: "bg-green-100 text-green-700",
    iconColor: "text-green-600"
  },
  expert: {
    icon: Award,
    label: "Expert",
    color: "bg-purple-100 text-purple-700",
    iconColor: "text-purple-600"
  }
};

const sizeConfig = {
  sm: {
    container: "px-2 py-1 text-xs",
    icon: "w-3 h-3",
    gap: "gap-1"
  },
  md: {
    container: "px-3 py-1.5 text-sm",
    icon: "w-4 h-4",
    gap: "gap-1.5"
  },
  lg: {
    container: "px-4 py-2 text-base",
    icon: "w-5 h-5",
    gap: "gap-2"
  }
};

export function VerificationBadge({ 
  level, 
  size = "md", 
  showLabel = true 
}: VerificationBadgeProps) {
  const config = verificationConfig[level];
  const sizeStyle = sizeConfig[size];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full font-medium transition-all",
        config.color,
        sizeStyle.container,
        sizeStyle.gap
      )}
    >
      <Icon className={cn(sizeStyle.icon, config.iconColor)} />
      {showLabel && <span>{config.label}</span>}
    </div>
  );
}

export function UserReputation({ score, maxScore = 100 }: { score: number; maxScore?: number }) {
  const percentage = (score / maxScore) * 100;
  
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <div 
          className="bg-primary h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-sm font-medium text-gray-600">
        {score}/{maxScore}
      </span>
    </div>
  );
}