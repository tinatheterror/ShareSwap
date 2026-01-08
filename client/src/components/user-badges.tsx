import { UserCheck, Award, Star, Crown, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface UserBadgesProps {
  isVerified?: boolean;
  reputationLevel?: string;
  size?: "sm" | "md" | "lg";
  showLabels?: boolean;
}

export function UserBadges({ 
  isVerified = false, 
  reputationLevel = "Newcomer",
  size = "md",
  showLabels = false
}: UserBadgesProps) {
  const iconSize = size === "sm" ? "h-3 w-3" : size === "md" ? "h-4 w-4" : "h-5 w-5";
  const badgeSize = size === "sm" ? "text-xs" : "text-sm";

  const getReputationBadge = () => {
    switch (reputationLevel) {
      case "Community Champion":
        return {
          icon: <Crown className={iconSize} />,
          color: "bg-[#E6FBF5] text-[#099E78] border-[#0DCEA1]/30",
          label: "Champion"
        };
      case "Trusted Sharer":
        return {
          icon: <Star className={iconSize} />,
          color: "bg-blue-100 text-blue-800 border-blue-200",
          label: "Trusted"
        };
      case "Active Member":
        return {
          icon: <Award className={iconSize} />,
          color: "bg-green-100 text-green-800 border-green-200",
          label: "Active"
        };
      case "Rising Star":
        return {
          icon: <Sparkles className={iconSize} />,
          color: "bg-yellow-100 text-yellow-800 border-yellow-200",
          label: "Rising"
        };
      default:
        return null;
    }
  };

  const reputationBadge = getReputationBadge();

  return (
    <div className="flex items-center gap-1">
      {isVerified && (
        <Badge className={`bg-teal-100 text-teal-800 border-teal-200 ${badgeSize}`}>
          <UserCheck className={`${iconSize} ${showLabels ? "mr-1" : ""}`} />
          {showLabels && "Verified"}
        </Badge>
      )}
      {reputationBadge && (
        <Badge className={`${reputationBadge.color} ${badgeSize}`}>
          {reputationBadge.icon}
          {showLabels && <span className="ml-1">{reputationBadge.label}</span>}
        </Badge>
      )}
    </div>
  );
}
