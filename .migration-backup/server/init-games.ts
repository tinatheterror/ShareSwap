import { db } from "@db";
import { sponsoredGames } from "@db/schema";

// Initialize some sample games
export const initializeSampleGames = async () => {
  try {
    const existingGames = await db.select().from(sponsoredGames).limit(1);
    
    if (existingGames.length === 0) {
      await db.insert(sponsoredGames).values([
        {
          name: "Memory Match",
          description: "Test your memory by matching pairs of cards. Complete all pairs to earn ShareCoins!",
          imageUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%234f46e5'/%3E%3Ctext x='50' y='55' font-family='Arial' font-size='30' fill='white' text-anchor='middle'%3E🧠%3C/text%3E%3C/svg%3E",
          rewardAmount: "5.00",
          sponsorName: "ShareSpace",
          gameUrl: "https://codepen.io/willamesoares/pen/rWOeQy",
          isActive: true,
        },
        {
          name: "Number Puzzle",
          description: "Solve number puzzles and brain teasers to earn ShareCoins. Great for sharpening your mind!",
          imageUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%2310b981'/%3E%3Ctext x='50' y='55' font-family='Arial' font-size='30' fill='white' text-anchor='middle'%3E🔢%3C/text%3E%3C/svg%3E",
          rewardAmount: "3.50",
          sponsorName: "MindGames Co",
          gameUrl: "https://codepen.io/willamesoares/pen/rWOeQy",
          isActive: true,
        },
        {
          name: "Word Quest",
          description: "Find hidden words and build your vocabulary while earning ShareCoins!",
          imageUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23f59e0b'/%3E%3Ctext x='50' y='55' font-family='Arial' font-size='30' fill='white' text-anchor='middle'%3E📝%3C/text%3E%3C/svg%3E",
          rewardAmount: "4.00",
          sponsorName: "WordPlay Inc",
          gameUrl: "https://codepen.io/willamesoares/pen/rWOeQy",
          isActive: true,
        },
      ]);
      console.log("Sample games initialized");
    }
  } catch (error) {
    console.error("Error initializing sample games:", error);
  }
};