import { db } from "@db";
import { users, items, itemRequests, shareCoinsTransactions, swapMatches, locationAlerts } from "@db/schema";
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
  private getSeasonalCategories(): { season: string; categories: string[]; keywords: string[] } {
    const now = new Date();
    const month = now.getMonth(); // 0-11
    
    if (month >= 2 && month <= 4) { // March-May (Spring)
      return {
        season: 'Spring',
        categories: ['outdoor', 'sports', 'tools'],
        keywords: ['garden', 'bike', 'hiking', 'cleaning', 'repair', 'lawn', 'planting']
      };
    } else if (month >= 5 && month <= 7) { // June-August (Summer)
      return {
        season: 'Summer',
        categories: ['outdoor', 'sports', 'vehicles'],
        keywords: ['camping', 'beach', 'bbq', 'grill', 'pool', 'bike', 'kayak', 'cooler']
      };
    } else if (month >= 8 && month <= 10) { // September-November (Fall)
      return {
        season: 'Fall',
        categories: ['tools', 'outdoor', 'electronics'],
        keywords: ['leaf', 'rake', 'ladder', 'heater', 'blanket', 'harvest', 'decoration']
      };
    } else { // December-February (Winter)
      return {
        season: 'Winter',
        categories: ['electronics', 'indoor', 'clothing'],
        keywords: ['heater', 'blanket', 'indoor', 'warm', 'holiday', 'decoration', 'skiing']
      };
    }
  }

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

      // Seasonal relevance bonus (10% weight)
      const seasonal = this.getSeasonalCategories();
      const itemText = `${item.name} ${item.description}`.toLowerCase();
      const seasonalMatch = seasonal.keywords.some(keyword => itemText.includes(keyword));
      if (seasonalMatch) {
        score += 10;
        reasons.push(`Perfect for ${seasonal.season}`);
      }

      // Location proximity bonus (if available - 5% weight)
      if (item.latitude && item.longitude) {
        score += 5;
        reasons.push('Near your location');
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

  // Smart matching for swap requests
  async findSwapMatches(requestId: number, userItemId: number): Promise<any[]> {
    // Get the swap request details
    const [request] = await db
      .select()
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(eq(itemRequests.id, requestId))
      .limit(1);

    if (!request) return [];

    // Get user's item that they want to swap
    const [userItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, userItemId))
      .limit(1);

    if (!userItem) return [];

    // Find potential matches based on category, value, and condition
    const potentialMatches = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.isSwappable, true),
          eq(items.isAvailable, true),
          sql`${items.ownerId} = ${request.item_requests.requesterId}` // Items owned by the requester
        )
      );

    const matches = [];
    for (const match of potentialMatches) {
      let matchScore = 0;
      const compatibility: any = {
        categoryMatch: false,
        valueMatch: false,
        conditionMatch: false,
        reasons: []
      };

      // Category similarity
      const requestedCategories = this.extractCategories([`${request.items.name} ${request.items.description}`]);
      const userCategories = this.extractCategories([`${userItem.name} ${userItem.description}`]);
      const matchCategories = this.extractCategories([`${match.name} ${match.description}`]);

      if (requestedCategories.some(cat => matchCategories.includes(cat))) {
        matchScore += 40;
        compatibility.categoryMatch = true;
        compatibility.reasons.push('Category match');
      }

      // Condition similarity (items should have similar condition ratings)
      const conditionDiff = Math.abs(userItem.conditionRating - match.conditionRating);
      if (conditionDiff <= 2) {
        matchScore += 30;
        compatibility.conditionMatch = true;
        compatibility.reasons.push('Similar condition');
      }

      // Value estimation (based on condition and other factors)
      const userValue = userItem.conditionRating * 10;
      const matchValue = match.conditionRating * 10;
      const valueDiff = Math.abs(userValue - matchValue);
      if (valueDiff <= 20) {
        matchScore += 20;
        compatibility.valueMatch = true;
        compatibility.reasons.push('Fair value exchange');
      }

      // Distance factor
      if (userItem.latitude && userItem.longitude && match.latitude && match.longitude) {
        // Calculate distance using a simple method
        const latDiff = Math.abs(Number(userItem.latitude) - Number(match.latitude));
        const lonDiff = Math.abs(Number(userItem.longitude) - Number(match.longitude));
        const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111; // Rough km conversion

        if (distance <= 25) {
          matchScore += 10;
          compatibility.reasons.push('Nearby location');
        }
      }

      if (matchScore >= 50) { // Only include good matches
        matches.push({
          ...match,
          matchScore,
          compatibility: JSON.stringify(compatibility)
        });
      }
    }

    // Sort by match score
    matches.sort((a, b) => b.matchScore - a.matchScore);
    return matches.slice(0, 5); // Return top 5 matches
  }

  // Location-based item alerts
  async checkLocationAlerts(itemId: number): Promise<void> {
    const [item] = await db
      .select()
      .from(items)
      .where(eq(items.id, itemId))
      .limit(1);

    if (!item || !item.latitude || !item.longitude) return;

    // Get all active location alerts
    const alerts = await db
      .select()
      .from(locationAlerts)
      .where(eq(locationAlerts.isActive, true));

    for (const alert of alerts) {
      if (!alert.latitude || !alert.longitude) continue;

      // Calculate distance
      const latDiff = Math.abs(Number(item.latitude) - Number(alert.latitude));
      const lonDiff = Math.abs(Number(item.longitude) - Number(alert.longitude));
      const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111;

      if (distance <= alert.radius!) {
        // Check if item matches keywords
        const itemText = `${item.name} ${item.description}`.toLowerCase();
        const keywordMatch = alert.keywords?.some(keyword => 
          itemText.includes(keyword.toLowerCase())
        );

        if (keywordMatch) {
          // Trigger notification (in a real app, this would send push notification or email)
          console.log(`Location alert triggered for user ${alert.userId}: ${item.name} is available nearby`);
          
          // You could add notification logic here
          // await this.sendNotification(alert.userId, item);
        }
      }
    }
  }

  // Get seasonal recommendations
  async getSeasonalRecommendations(userId: number, limit: number = 8): Promise<any[]> {
    const seasonal = this.getSeasonalCategories();
    
    const seasonalItems = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.isAvailable, true),
          sql`${items.ownerId} != ${userId}`
        )
      );

    const recommendations = [];
    
    for (const item of seasonalItems) {
      const itemText = `${item.name} ${item.description}`.toLowerCase();
      const seasonalMatch = seasonal.keywords.some(keyword => itemText.includes(keyword));
      
      if (seasonalMatch) {
        recommendations.push({
          ...item,
          seasonalRelevance: seasonal.season,
          recommendationReasons: [`Perfect for ${seasonal.season}`, 'Seasonal trending']
        });
      }
    }

    return recommendations.slice(0, limit);
  }
}

export const recommendationEngine = new RecommendationEngine();