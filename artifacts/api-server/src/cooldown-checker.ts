// Cooldown Checker - Prevents actions during farming protection cooldowns
import { db } from "@workspace/db";
import { swapCooldowns } from "@workspace/db";
import { and, or, eq, gte } from "drizzle-orm";

export class CooldownChecker {
  
  // Check if two users are currently in a swap cooldown
  static async checkSwapCooldown(userId1: number, userId2: number): Promise<{
    inCooldown: boolean;
    cooldownUntil?: Date;
    reason?: string;
  }> {
    
    const now = new Date();
    
    const activeCooldown = await db
      .select()
      .from(swapCooldowns)
      .where(
        and(
          or(
            and(
              eq(swapCooldowns.userId1, Math.min(userId1, userId2)),
              eq(swapCooldowns.userId2, Math.max(userId1, userId2))
            ),
            and(
              eq(swapCooldowns.userId1, Math.max(userId1, userId2)),
              eq(swapCooldowns.userId2, Math.min(userId1, userId2))
            )
          ),
          gte(swapCooldowns.cooldownUntil, now)
        )
      )
      .orderBy(swapCooldowns.cooldownUntil)
      .limit(1);
    
    if (activeCooldown.length > 0) {
      return {
        inCooldown: true,
        cooldownUntil: activeCooldown[0].cooldownUntil,
        reason: activeCooldown[0].reason
      };
    }
    
    return { inCooldown: false };
  }
  
  // Get time remaining in cooldown (in minutes)
  static getCooldownTimeRemaining(cooldownUntil: Date): number {
    const now = new Date();
    const diffMs = cooldownUntil.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60))); // Convert to minutes
  }
}