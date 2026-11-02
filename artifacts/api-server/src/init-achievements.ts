import { db } from "@workspace/db";
import { achievements } from "@workspace/db";

export const initializeAchievements = async () => {
  try {
    const existingAchievements = await db.select().from(achievements).limit(1);
    
    if (existingAchievements.length === 0) {
      await db.insert(achievements).values([
        {
          name: "First Lender",
          description: "Lend your first item to a neighbour",
          badgeIcon: "🤝",
          badgeColor: "#10b981",
          pointsRequired: 0,
          category: "milestone",
        },
        {
          name: "Trusted Neighbour",
          description: "Maintain a 4.5+ star rating with 10+ transactions",
          badgeIcon: "⭐",
          badgeColor: "#f59e0b",
          pointsRequired: 100,
          category: "social",
        },
        {
          name: "Green Warrior",
          description: "Share 50+ items promoting sustainable living",
          badgeIcon: "🌱",
          badgeColor: "#059669",
          pointsRequired: 250,
          category: "lending",
        },
        {
          name: "Community Champion",
          description: "Help 25+ neighbours by lending items",
          badgeIcon: "🏆",
          badgeColor: "#dc2626",
          pointsRequired: 150,
          category: "social",
        },
        {
          name: "Early Adopter",
          description: "One of the first 100 users on the platform",
          badgeIcon: "🚀",
          badgeColor: "#7c3aed",
          pointsRequired: 0,
          category: "milestone",
        },
        {
          name: "Borrowing Pro",
          description: "Successfully borrow and return 20+ items",
          badgeIcon: "📦",
          badgeColor: "#0ea5e9",
          pointsRequired: 80,
          category: "borrowing",
        },
        {
          name: "Review Master",
          description: "Leave 50+ helpful reviews for the community",
          badgeIcon: "📝",
          badgeColor: "#8b5cf6",
          pointsRequired: 50,
          category: "social",
        },
        {
          name: "Swap Specialist",
          description: "Complete 15+ successful item swaps",
          badgeIcon: "🔄",
          badgeColor: "#06b6d4",
          pointsRequired: 75,
          category: "lending",
        },
      ]);
      console.log("Achievements initialized");
    }
  } catch (error) {
    console.error("Error initializing achievements:", error);
  }
};
