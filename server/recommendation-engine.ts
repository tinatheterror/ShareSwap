import { db } from "@db";
import { users, items, itemRequests, shareCoinsTransactions } from "@db/schema";
import { eq, desc, and, or, inArray, sql } from "drizzle-orm";

interface RecommendationScore {
  itemId: number;
  score: number;
  reasons: string[];
}

interface UserBehaviorProfile {
  preferredCategories: string[];
  requestTypes: string[];
  recentActivity: string[];
  spendingPattern: 'low' | 'medium' | 'high';
}

export class RecommendationEngine {
  private async getUserBehaviorProfile(userId: number): Promise<UserBehaviorProfile> {
    // Get user's request history
    const requests = await db
      .select({
        requestType: itemRequests.requestType,
        itemName: items.name,
        itemDescription: items.description,
      })
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(eq(itemRequests.requesterId, userId))
      .orderBy(desc(itemRequests.createdAt))
      .limit(20);

    // Get transaction history for spending pattern
    const transactions = await db
      .select()
      .from(shareCoinsTransactions)
      .where(eq(shareCoinsTransactions.userId, userId))
      .orderBy(desc(shareCoinsTransactions.createdAt))
      .limit(10);

    // Extract categories from item names/descriptions
    const categoryKeywords = this.extractCategories(requests.map(r => `${r.itemName} ${r.itemDescription}`));
    
    // Determine spending pattern
    const totalSpent = transactions
      .filter(t => t.transactionType === 'SPENT')
      .reduce((sum, t) => sum + Number(t.amount), 0);
    
    const spendingPattern = totalSpent > 50 ? 'high' : totalSpent > 20 ? 'medium' : 'low';

    return {
      preferredCategories: categoryKeywords,
      requestTypes: Array.from(new Set(requests.map(r => r.requestType))),
      recentActivity: requests.slice(0, 5).map(r => r.itemName),
      spendingPattern
    };
  }

  private extractCategories(descriptions: string[]): string[] {
    const categoryMap = {
      'electronics': ['phone', 'laptop', 'computer', 'tablet', 'camera', 'tv', 'speaker', 'headphones'],
      'tools': ['drill', 'hammer', 'saw', 'wrench', 'screwdriver', 'ladder', 'tool'],
      'sports': ['bike', 'bicycle', 'ball', 'tennis', 'football', 'basketball', 'gym', 'exercise'],
      'kitchen': ['blender', 'mixer', 'pot', 'pan', 'knife', 'cooking', 'kitchen'],
      'outdoor': ['tent', 'camping', 'hiking', 'outdoor', 'grill', 'bbq'],
      'vehicles': ['car', 'bike', 'scooter', 'motorcycle', 'vehicle'],
      'books': ['book', 'novel', 'textbook', 'guide', 'manual'],
      'clothing': ['dress', 'suit', 'jacket', 'shoes', 'clothing', 'formal'],
      'furniture': ['chair', 'table', 'desk', 'furniture', 'sofa']
    };

    const text = descriptions.join(' ').toLowerCase();
    const categories: string[] = [];

    for (const [category, keywords] of Object.entries(categoryMap)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        categories.push(category);
      }
    }

    return categories;
  }

  private calculateSimilarity(item1: string, item2: string): number {
    const words1 = item1.toLowerCase().split(' ');
    const words2 = item2.toLowerCase().split(' ');
    const intersection = words1.filter(word => words2.includes(word));
    const union = Array.from(new Set([...words1, ...words2]));
    return intersection.length / union.length;
  }

  async getRecommendations(userId: number, limit: number = 10): Promise<any[]> {
    const userProfile = await this.getUserBehaviorProfile(userId);
    
    // Get all available items (excluding user's own items)
    const availableItems = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.isAvailable, true),
          sql`${items.ownerId} != ${userId}`
        )
      );

    const recommendations: RecommendationScore[] = [];

    for (const item of availableItems) {
      let score = 0;
      const reasons: string[] = [];

      // Category matching (40% weight)
      const itemCategories = this.extractCategories([`${item.name} ${item.description}`]);
      const categoryMatch = itemCategories.some(cat => userProfile.preferredCategories.includes(cat));
      if (categoryMatch) {
        score += 40;
        reasons.push('Matches your interests');
      }

      // Request type preference (25% weight)
      if (userProfile.requestTypes.includes('BORROW') && item.isLendable) {
        score += 25;
        reasons.push('Available for borrowing');
      }
      if (userProfile.requestTypes.includes('SWAP') && item.isSwappable) {
        score += 25;
        reasons.push('Available for swapping');
      }
      if (userProfile.requestTypes.includes('RENT') && item.isRentable) {
        score += 25;
        reasons.push('Available for rent');
      }

      // Similar to recent activity (20% weight)
      const similarityScores = userProfile.recentActivity.map((recentItem: string) => 
        this.calculateSimilarity(item.name, recentItem)
      );
      const maxSimilarity = Math.max(...similarityScores, 0);
      if (maxSimilarity > 0.3) {
        score += 20 * maxSimilarity;
        reasons.push('Similar to your recent activity');
      }

      // Condition and availability bonus (15% weight)
      if (item.isConditionVerified) {
        score += 10;
        reasons.push('Verified condition');
      }
      if (item.conditionRating >= 8) {
        score += 5;
        reasons.push('Excellent condition');
      }

      // Add some randomness to prevent always showing the same items
      score += Math.random() * 5;

      if (score > 10) { // Only include items with reasonable scores
        recommendations.push({
          itemId: item.id,
          score,
          reasons
        });
      }
    }

    // Sort by score and get top recommendations
    recommendations.sort((a, b) => b.score - a.score);
    const topRecommendations = recommendations.slice(0, limit);

    // Get full item details for top recommendations
    const itemIds = topRecommendations.map(r => r.itemId);
    if (itemIds.length === 0) return [];

    const recommendedItems = await db
      .select()
      .from(items)
      .where(inArray(items.id, itemIds));

    // Combine items with their scores and reasons
    return recommendedItems.map(item => {
      const recommendation = topRecommendations.find(r => r.itemId === item.id);
      return {
        ...item,
        recommendationScore: recommendation?.score || 0,
        recommendationReasons: recommendation?.reasons || []
      };
    });
  }
}

export const recommendationEngine = new RecommendationEngine();