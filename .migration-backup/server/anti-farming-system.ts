// Anti-Farming System to prevent ShareCoin exploitation
import { db } from "@db";
import { users, itemRequests, items, shareCoinsTransactions } from "@db/schema";
import { eq, and, gte, sql, desc, count } from "drizzle-orm";

export interface FarmingDetectionResult {
  isSuspicious: boolean;
  reason?: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendations: string[];
}

export class AntiFarmingSystem {
  
  // Check if a swap transaction appears to be farming
  static async detectSwapFarming(
    requesterId: number, 
    itemOwnerId: number, 
    itemId: number
  ): Promise<FarmingDetectionResult> {
    
    const suspiciousPatterns: string[] = [];
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    
    // 1. Check for rapid back-and-forth swaps between same users
    const recentSwaps = await this.getRecentSwapsBetweenUsers(requesterId, itemOwnerId);
    if (recentSwaps.length >= 3) {
      suspiciousPatterns.push(`${recentSwaps.length} swaps between same users in last 24 hours`);
      riskLevel = 'HIGH';
    } else if (recentSwaps.length >= 2) {
      suspiciousPatterns.push(`Multiple recent swaps between same users`);
      riskLevel = 'MEDIUM';
    }
    
    // 2. Check for immediate reverse swaps (A swaps to B, B immediately swaps back)
    const reverseSwap = await this.checkForReverseSwap(requesterId, itemOwnerId, itemId);
    if (reverseSwap) {
      suspiciousPatterns.push('Immediate reverse swap detected');
      riskLevel = 'CRITICAL';
    }
    
    // 3. Check for artificial item creation patterns
    const artificialItems = await this.checkArtificialItemPatterns(itemOwnerId);
    if (artificialItems.isArtificial) {
      suspiciousPatterns.push(artificialItems.reason);
      riskLevel = riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
    }
    
    // 4. Check for account creation timing correlation
    const accountCorrelation = await this.checkAccountCreationCorrelation(requesterId, itemOwnerId);
    if (accountCorrelation.isSuspicious) {
      suspiciousPatterns.push(accountCorrelation.reason);
      riskLevel = riskLevel === 'CRITICAL' ? 'CRITICAL' : 'MEDIUM';
    }
    
    // 5. Check for excessive ShareCoin earning rate
    const earningRate = await this.checkEarningRate(requesterId);
    if (earningRate.isSuspicious) {
      suspiciousPatterns.push(earningRate.reason);
      riskLevel = riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
    }
    
    const recommendations = this.generateRecommendations(riskLevel, suspiciousPatterns);
    
    return {
      isSuspicious: suspiciousPatterns.length > 0,
      reason: suspiciousPatterns.join('; '),
      riskLevel,
      recommendations
    };
  }
  
  // Get recent swaps between two specific users
  private static async getRecentSwapsBetweenUsers(userId1: number, userId2: number) {
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const swaps = await db
      .select()
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(
        and(
          eq(itemRequests.requestType, "SWAP"),
          eq(itemRequests.status, "ACCEPTED"),
          gte(itemRequests.createdAt, last24Hours),
          and(
            // Either user1 requesting from user2 OR user2 requesting from user1
            and(
              eq(itemRequests.requesterId, userId1),
              eq(items.ownerId, userId2)
            ),
            and(
              eq(itemRequests.requesterId, userId2),
              eq(items.ownerId, userId1)
            )
          )
        )
      );
    
    return swaps;
  }
  
  // Check if this is an immediate reverse of a recent swap
  private static async checkForReverseSwap(requesterId: number, itemOwnerId: number, itemId: number) {
    const last2Hours = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    // Check if itemOwner recently swapped with requester
    const recentSwap = await db
      .select()
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(
        and(
          eq(itemRequests.requestType, "SWAP"),
          eq(itemRequests.status, "ACCEPTED"),
          eq(itemRequests.requesterId, itemOwnerId), // Owner was the requester
          eq(items.ownerId, requesterId), // Requester was the owner
          gte(itemRequests.createdAt, last2Hours)
        )
      )
      .limit(1);
    
    return recentSwap.length > 0;
  }
  
  // Check for artificial item creation patterns
  private static async checkArtificialItemPatterns(userId: number) {
    const userItems = await db
      .select()
      .from(items)
      .where(eq(items.ownerId, userId))
      .orderBy(desc(items.createdAt));
    
    // Check for rapid item creation
    if (userItems.length >= 5) {
      const recentItems = userItems.slice(0, 5);
      const timeSpan = new Date(recentItems[0].createdAt!).getTime() - 
                     new Date(recentItems[4].createdAt!).getTime();
      
      if (timeSpan < 60 * 60 * 1000) { // 5 items in 1 hour
        return {
          isArtificial: true,
          reason: 'Rapid item creation pattern detected'
        };
      }
    }
    
    // Check for suspiciously similar item descriptions
    const descriptions = userItems.map(item => item.description.toLowerCase());
    const uniqueDescriptions = new Set(descriptions);
    
    if (descriptions.length >= 3 && uniqueDescriptions.size < descriptions.length * 0.5) {
      return {
        isArtificial: true,
        reason: 'Highly similar item descriptions suggest artificial listings'
      };
    }
    
    return { isArtificial: false, reason: '' };
  }
  
  // Check if accounts were created around the same time (suggesting coordination)
  private static async checkAccountCreationCorrelation(userId1: number, userId2: number) {
    const [user1, user2] = await Promise.all([
      db.select().from(users).where(eq(users.id, userId1)).limit(1),
      db.select().from(users).where(eq(users.id, userId2)).limit(1)
    ]);
    
    if (user1.length === 0 || user2.length === 0) {
      return { isSuspicious: false, reason: '' };
    }
    
    const timeDiff = Math.abs(
      new Date(user1[0].createdAt!).getTime() - new Date(user2[0].createdAt!).getTime()
    );
    
    // Accounts created within 1 hour of each other
    if (timeDiff < 60 * 60 * 1000) {
      return {
        isSuspicious: true,
        reason: 'Accounts created within 1 hour of each other'
      };
    }
    
    return { isSuspicious: false, reason: '' };
  }
  
  // Check for unusually high ShareCoin earning rate
  private static async checkEarningRate(userId: number) {
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const recentEarnings = await db
      .select()
      .from(shareCoinsTransactions)
      .where(
        and(
          eq(shareCoinsTransactions.userId, userId),
          eq(shareCoinsTransactions.transactionType, "EARNED"),
          gte(shareCoinsTransactions.createdAt, last24Hours)
        )
      );
    
    const totalEarned = recentEarnings.reduce((sum, transaction) => 
      sum + parseFloat(transaction.amount), 0
    );
    
    // More than 10 ShareCoins earned in 24 hours is suspicious
    if (totalEarned > 10) {
      return {
        isSuspicious: true,
        reason: `Earned ${totalEarned} ShareCoins in 24 hours (normal limit: ~3-5)`
      };
    }
    
    return { isSuspicious: false, reason: '' };
  }
  
  // Generate recommendations based on risk level
  private static generateRecommendations(riskLevel: string, patterns: string[]): string[] {
    const recommendations: string[] = [];
    
    switch (riskLevel) {
      case 'CRITICAL':
        recommendations.push('Block transaction immediately');
        recommendations.push('Flag both accounts for manual review');
        recommendations.push('Implement 48-hour cooling period');
        break;
      case 'HIGH':
        recommendations.push('Apply 24-hour swap cooldown between these users');
        recommendations.push('Reduce ShareCoin reward to 0 for this transaction');
        recommendations.push('Monitor future transactions closely');
        break;
      case 'MEDIUM':
        recommendations.push('Apply 6-hour swap cooldown between these users');
        recommendations.push('Flag for automated monitoring');
        break;
      case 'LOW':
        recommendations.push('Continue monitoring');
        break;
    }
    
    return recommendations;
  }
  
  // Apply anti-farming measures
  static async applyAntifarmingMeasures(
    detection: FarmingDetectionResult,
    requesterId: number,
    itemOwnerId: number
  ): Promise<{ blockTransaction: boolean; awardShareCoins: boolean; cooldownHours: number }> {
    
    let blockTransaction = false;
    let awardShareCoins = true;
    let cooldownHours = 0;
    
    switch (detection.riskLevel) {
      case 'CRITICAL':
        blockTransaction = true;
        awardShareCoins = false;
        cooldownHours = 48;
        console.log(`🚨 CRITICAL farming detection - blocking swap between users ${requesterId} and ${itemOwnerId}`);
        break;
        
      case 'HIGH':
        awardShareCoins = false;
        cooldownHours = 24;
        console.log(`⚠️ HIGH risk farming detection - no ShareCoins awarded, 24h cooldown`);
        break;
        
      case 'MEDIUM':
        cooldownHours = 6;
        console.log(`⚠️ MEDIUM risk farming detection - 6h cooldown applied`);
        break;
        
      case 'LOW':
        console.log(`✅ LOW risk - transaction proceeds normally`);
        break;
    }
    
    return { blockTransaction, awardShareCoins, cooldownHours };
  }
}