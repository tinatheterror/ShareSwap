import sharp from 'sharp';
import type { Express } from "express";
import { createServer, type Server } from "http";
import * as uberDirect from "../uber-direct";
import { randomBytes } from "crypto";
import { setupAuth, hashPassword, comparePasswords } from "../auth";
import { db, pool } from "@workspace/db";
import {
  verifications,
  messages,
  items,
  users,
  shareCoinsTransactions,
  notifications,
} from "@workspace/db";
import { eq, and, or, desc, asc, sql, gte, lt, ne, isNull, isNotNull, inArray, notInArray, ilike } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { WebSocket, WebSocketServer } from "ws";
import { log } from "../vite";
import multer from "multer";
import { uploadToStorage } from "../storage";
import path from "path";
import * as express from "express";
import { itemConditionVerifications } from "@workspace/db";
import { matchCatalog } from "../lib/lib/baby-catalog";
import { sponsoredGames, gameSessions } from "@workspace/db";
import { communityChallenges, challengeParticipants } from "@workspace/db";
import { itemRequests, deliveryArrangements, extensionRequests } from "@workspace/db";
import { reputationActivities, userReviews } from "@workspace/db";
import { locationAlerts, swapMatches, swapCooldowns, farmingDetections, rentalReturns, platformCommissions, wishlists, wishlistOffers, referrals, rentalPayouts, achievements, userAchievements, itemAvailabilitySubscribers, userNotificationPrefs, userPushTokens } from "@workspace/db";
import session from "express-session";
import { sessionSettings, store } from "../auth";
import { computeActiveStatus, computeActiveStatusFromDb, computeResponseTime } from "../user-stats";
import type { InsertItem } from "@workspace/db";
import connectPgSimple from "connect-pg-simple";
import { recommendationEngine } from "../recommendation-engine";
import { addSimplifiedRoutes } from "../simplified-routes";
import { platformConfig, calculateCommission } from "../platform-config";
import { AntiFarmingSystem } from "../anti-farming-system";
import { sendPushToUser, sendPushToUsers } from "../push-notifications";
import { sendVerificationEmail, sendEmailChangeVerificationEmail, sendEmailChangeAlertEmail } from "../sendgrid";

// Notify all availability subscribers that an item is back
async function notifyAvailabilitySubscribers(itemId: number, itemName: string) {
  try {
    const subs = await db.select({ userId: itemAvailabilitySubscribers.userId })
      .from(itemAvailabilitySubscribers)
      .where(eq(itemAvailabilitySubscribers.itemId, itemId));
    if (subs.length === 0) return;
    await db.insert(notifications).values(
      subs.map(s => ({
        userId: s.userId,
        type: "item_available",
        title: "Item Now Available",
        message: `"${itemName.length > 22 ? itemName.slice(0, 22) + "…" : itemName}" is now available to borrow or rent.`,
        itemId,
      }))
    );
    await db.delete(itemAvailabilitySubscribers).where(eq(itemAvailabilitySubscribers.itemId, itemId));
  } catch (e) {
    console.error("[notifyAvailabilitySubscribers] error:", e);
  }
}
import { CooldownChecker } from "../cooldown-checker";
import { csrfProtection, setCsrfToken } from "../csrf";
import OpenAI from "openai";
import Stripe from "stripe";
import { 
  awardBorrowReturnPoints, 
  awardSwapCompletionPoints, 
  awardRentalCompletionPoints, 
  awardGiftingPoints, 
  awardFeedbackPoints, 
  TRUST_POINTS,
  daysLateAgainstDueDate,
  applySeriousOverduePenalty,
  applyCancellationPenalty,
  applyDepositClaimedPenalty,
  applyLowReviewPenalty
} from "../trust-score-service";
import { calculateAIValuation, getTierBand, type ItemValuationInput } from "../ai-valuation";
import { calculateReplacementValueAndTier } from "../replacement-value";
import {
  daysOverdueAgainstDueDate,
  isBorrowingRestricted,
  isSeriousOverdue,
} from "../overdue-policy";

const ACTIVE_OVERDUE_BORROW_STATUSES = ["IN_PROGRESS", "RETURN_REQUESTED"];

export async function getBlockingOverdueBorrow(borrowerId: number, now = new Date()) {
  const activeBorrows = await db
    .select({
      requestId: itemRequests.id,
      endDate: itemRequests.endDate,
      itemName: items.name,
    })
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(
      and(
        eq(itemRequests.requesterId, borrowerId),
        eq(itemRequests.requestType, "BORROW"),
        inArray(itemRequests.status, ACTIVE_OVERDUE_BORROW_STATUSES),
        isNotNull(itemRequests.endDate),
      ),
    );

  return activeBorrows
    .map((borrow) => ({
      ...borrow,
      daysOverdue: daysOverdueAgainstDueDate(now, borrow.endDate),
    }))
    .find((borrow) => isBorrowingRestricted(borrow.daysOverdue));
}

function overdueBorrowRestrictionResponse(
  blockedBorrow: Awaited<ReturnType<typeof getBlockingOverdueBorrow>>,
) {
  return {
    code: "OVERDUE_BORROW_RESTRICTED",
    error: `You can’t start another borrow until you return "${blockedBorrow!.itemName}", which is ${blockedBorrow!.daysOverdue} days overdue.`,
    requestId: blockedBorrow!.requestId,
    daysOverdue: blockedBorrow!.daysOverdue,
  };
}

// Helper function to award ShareCoins with first-time bonus handling
async function awardShareCoinsWithFirstTimeBonus(
  userId: number,
  actionType: 'RENT' | 'LEND' | 'SWAP' | 'GIFT' | 'BORROW',
  itemName: string,
  baseReward: number = 1
): Promise<{ totalAwarded: number; isFirstTime: boolean }> {
  // Map action type to user field
  const fieldMap: Record<string, keyof typeof users> = {
    'RENT': 'hasCompletedFirstRent',
    'LEND': 'hasCompletedFirstLend', 
    'SWAP': 'hasCompletedFirstSwap',
    'GIFT': 'hasCompletedFirstGift',
    'BORROW': 'hasCompletedFirstBorrow',
  };
  
  const field = fieldMap[actionType];
  
  // Check if user has completed this action before
  const [user] = await db
    .select({ hasCompleted: users[field] as any })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  
  const isFirstTime = !user?.hasCompleted;
  let totalAwarded = 0;
  
  // Award first-time bonus only — no recurring completion reward
  if (isFirstTime) {
    await db.insert(shareCoinsTransactions).values({
      userId,
      amount: "1",
      description: `First Time ${actionType.charAt(0) + actionType.slice(1).toLowerCase()} Bonus`,
      transactionType: "EARNED",
    });
    totalAwarded += 1;
    
    // Mark user as having completed first action
    await db
      .update(users)
      .set({ [field]: true })
      .where(eq(users.id, userId));

    // Update ShareCoins balance
    await db
      .update(users)
      .set({ shareCoins: sql`share_coins + 1` })
      .where(eq(users.id, userId));
  }

  // Only notify if something was actually awarded (first-time only)
  if (isFirstTime) {
    const actionLabels: Record<string, string> = {
      'RENT': 'first rental',
      'LEND': 'first lend',
      'SWAP': 'first swap',
      'GIFT': 'first gift given',
      'BORROW': 'first borrow',
    };
    await db.insert(notifications).values({
      userId,
      type: "sharecoin_earned",
      title: `+1 ShareCoin Earned`,
      message: `You earned 1 ShareCoin for your ${actionLabels[actionType] || 'first action'} on ShareSwap!`,
      isRead: false,
    });
  }

  return { totalAwarded, isFirstTime };
}

// Server-side swap coin offset application
// Mirrors the client-side getTierShareCoins / calculateMultiSwap logic
function serverGetTierSC(tier: number | null | undefined): number {
  const map: Record<number, number> = { 1: 5, 2: 10, 3: 20, 4: 40 };
  return map[tier ?? 2] ?? 10;
}

async function applySwapCoinOffset(
  ownerId: number,
  requesterId: number,
  requestId: number,
  itemId: number,                        // the listing item (owner's primary item)
  swapOfferedItemIds: number[] | null,   // requester's original offered items
  counterSwapOwnerItemIds: number[] | null,
  counterSwapRequesterItemIds: number[] | null,
  itemName: string,
): Promise<void> {
  // Determine effective item IDs for each side (counter takes priority)
  const ownerItemIds = counterSwapOwnerItemIds?.length ? counterSwapOwnerItemIds : [itemId];
  const requesterItemIds = counterSwapRequesterItemIds?.length ? counterSwapRequesterItemIds : (swapOfferedItemIds ?? []);

  if (ownerItemIds.length === 0 || requesterItemIds.length === 0) return;

  // Fetch tiers from DB
  const allIds = [...new Set([...ownerItemIds, ...requesterItemIds])];
  const itemRows = await db.select({ id: items.id, tier: items.tier }).from(items).where(inArray(items.id, allIds));
  const tierMap = new Map<number, number | null>(itemRows.map(r => [r.id, r.tier]));

  const ownerSC = ownerItemIds.reduce((s, id) => s + serverGetTierSC(tierMap.get(id)), 0);
  const requesterSC = requesterItemIds.reduce((s, id) => s + serverGetTierSC(tierMap.get(id)), 0);
  const offset = Math.abs(ownerSC - requesterSC);

  if (offset === 0) return; // fair swap, nothing to transfer

  // The side with fewer SC pays the offset to the other
  const payerId   = ownerSC < requesterSC ? ownerId    : requesterId;
  const receiverId = ownerSC < requesterSC ? requesterId : ownerId;

  // Deduct from payer
  await db.update(users).set({ shareCoins: sql`GREATEST(0, CAST(share_coins AS INTEGER) - ${offset})` }).where(eq(users.id, payerId));
  await db.insert(shareCoinsTransactions).values({ userId: payerId, amount: (-offset).toString(), description: `Swap offset paid: ${itemName}`, transactionType: "SWAP_OFFSET_PAID" });

  // Credit receiver
  await db.update(users).set({ shareCoins: sql`CAST(share_coins AS INTEGER) + ${offset}` }).where(eq(users.id, receiverId));
  await db.insert(shareCoinsTransactions).values({ userId: receiverId, amount: offset.toString(), description: `Swap offset received: ${itemName}`, transactionType: "SWAP_OFFSET_RECEIVED" });

  // Notify both parties
  await db.insert(notifications).values([
    { userId: payerId,    type: "sharecoin_earned", title: `-${offset} ShareCoins`, message: `-${offset} SC swap offset for "${itemName.length > 20 ? itemName.slice(0, 20) + "…" : itemName}".`,    requestId, isRead: false },
    { userId: receiverId, type: "sharecoin_earned", title: `+${offset} ShareCoins`, message: `+${offset} SC swap offset for "${itemName.length > 20 ? itemName.slice(0, 20) + "…" : itemName}".`, requestId, isRead: false },
  ]);

  console.log(`✅ Swap offset: ${offset} SC from user ${payerId} to user ${receiverId} for swap on "${itemName}"`);
}

// Helper function to check and award referral bonus when a referred user completes their first transaction
// Requirements: Transaction must be completed (not cancelled/disputed), different accounts AND different devices
async function checkAndAwardReferralBonus(
  userId: number, 
  transactionId?: number,
  transactionType?: string
): Promise<{ awarded: boolean; referrerId?: number; reason?: string }> {
  try {
    // If a transaction ID is provided, verify it's a completed transaction (not cancelled/disputed)
    if (transactionId) {
      const [transaction] = await db
        .select({ status: itemRequests.status })
        .from(itemRequests)
        .where(eq(itemRequests.id, transactionId))
        .limit(1);
      
      if (!transaction) {
        return { awarded: false, reason: "Transaction not found" };
      }
      
      const invalidStatuses = ['CANCELLED', 'REJECTED', 'DISPUTED'];
      
      if (invalidStatuses.includes(transaction.status || '')) {
        console.log(`🚫 Referral not awarded: Transaction ${transactionId} has invalid status ${transaction.status}`);
        return { awarded: false, reason: `Transaction ${transaction.status} - not eligible for referral bonus` };
      }
      
      // Type-specific status validation:
      // - SWAP and GIFT complete at acceptance (no return phase)
      // - BORROW, LEND, RENT require COMPLETED status (after return)
      const immediateCompletionTypes = ['SWAP', 'GIFT'];
      const requiresReturnTypes = ['BORROW', 'LEND', 'RENT'];
      
      const isCompleted = (s: string | null) => s === 'COMPLETED' || s === 'COMPLETED_EARLY';
      
      if (transactionType && immediateCompletionTypes.includes(transactionType)) {
        if (!['ACCEPTED', 'COMPLETED', 'COMPLETED_EARLY'].includes(transaction.status || '')) {
          console.log(`🚫 Referral not awarded: ${transactionType} transaction ${transactionId} not yet accepted/completed (status: ${transaction.status})`);
          return { awarded: false, reason: "Transaction not yet completed" };
        }
      } else if (transactionType && requiresReturnTypes.includes(transactionType)) {
        if (!isCompleted(transaction.status)) {
          console.log(`🚫 Referral not awarded: ${transactionType} transaction ${transactionId} not yet completed (status: ${transaction.status})`);
          return { awarded: false, reason: "Transaction not yet completed - item must be returned" };
        }
      } else {
        if (!isCompleted(transaction.status)) {
          console.log(`🚫 Referral not awarded: Transaction ${transactionId} not yet completed (status: ${transaction.status})`);
          return { awarded: false, reason: "Transaction not yet completed" };
        }
      }
    }

    // Find a referral record for this user that hasn't been rewarded yet
    const [referral] = await db
      .select()
      .from(referrals)
      .where(
        and(
          eq(referrals.referredUserId, userId),
          eq(referrals.completedFirstTransaction, false),
          eq(referrals.isRewardClaimed, false)
        )
      )
      .limit(1);

    if (!referral || !referral.referrerId) {
      return { awarded: false, reason: "No pending referral found" };
    }

    // Security check: Ensure referred user and referrer are different accounts
    if (referral.referrerId === userId) {
      console.log(`🚫 Referral fraud detected: User ${userId} tried to self-refer`);
      return { awarded: false, reason: "Self-referral not allowed" };
    }

    // Security check: Different devices required
    // Use the CURRENT device fingerprint from users table (updated on each login) for accurate comparison
    const [referrer] = await db
      .select({ deviceFingerprint: users.deviceFingerprint })
      .from(users)
      .where(eq(users.id, referral.referrerId))
      .limit(1);
    
    const referrerFingerprint = referrer?.deviceFingerprint || referral.referrerDeviceFingerprint;
    const referredFingerprint = referral.referredDeviceFingerprint;
    
    if (referrerFingerprint && referredFingerprint && referrerFingerprint === referredFingerprint) {
      console.log(`🚫 Referral fraud detected: Same device fingerprint for referrer (${referral.referrerId}) and referred user (${userId})`);
      return { awarded: false, reason: "Same device detected - referral bonus requires different devices" };
    }

    // Award 10 ShareCoins to the referrer
    const rewardAmount = 10;

    await db.insert(shareCoinsTransactions).values({
      userId: referral.referrerId,
      amount: rewardAmount.toString(),
      description: `Referral bonus: Friend completed their first ${transactionType || 'transaction'}`,
      transactionType: "EARNED",
    });

    await db
      .update(users)
      .set({
        shareCoins: sql`share_coins + ${rewardAmount}`,
      })
      .where(eq(users.id, referral.referrerId));

    // Mark the referral as completed and rewarded with transaction details
    await db
      .update(referrals)
      .set({
        completedFirstTransaction: true,
        isRewardClaimed: true,
        firstTransactionId: transactionId || null,
        firstTransactionType: transactionType || null,
        rewardedAt: new Date(),
      })
      .where(eq(referrals.id, referral.id));

    console.log(`🎉 Referral bonus: Awarded ${rewardAmount} ShareCoins to user ${referral.referrerId} for referring user ${userId} (${transactionType})`);

    // Award 5 welcome ShareCoins to the referred user
    const welcomeReward = 5;
    await db.insert(shareCoinsTransactions).values({
      userId,
      amount: welcomeReward.toString(),
      description: `Welcome bonus: Joined via referral and completed your first ${transactionType || 'transaction'}`,
      transactionType: "EARNED",
    });
    await db
      .update(users)
      .set({ shareCoins: sql`share_coins + ${welcomeReward}` })
      .where(eq(users.id, userId));

    console.log(`🎁 Welcome bonus: Awarded ${welcomeReward} ShareCoins to referred user ${userId}`);

    // Notify the referrer that their friend completed their first transaction
    await db.insert(notifications).values({
      userId: referral.referrerId,
      type: "referral_joined",
      title: "Your Referral Paid Off!",
      message: `Your referral completed their first ${transactionType?.toLowerCase() || 'transaction'}. You earned ${rewardAmount} ShareCoins!`,
      isRead: false,
    });

    // Notify the referred user of their welcome bonus
    await db.insert(notifications).values({
      userId,
      type: "system",
      title: "Welcome Bonus!",
      message: `You earned ${welcomeReward} ShareCoins for completing your first transaction as a referred member. Happy sharing!`,
      isRead: false,
    });

    return { awarded: true, referrerId: referral.referrerId };
  } catch (error) {
    console.error("Error checking/awarding referral bonus:", error);
    return { awarded: false, reason: "Internal error" };
  }
}

// ── Achievement / Badge System ─────────────────────────────────────────────────
const ACHIEVEMENT_DEFS = [
  // Existing badges
  { name: 'first_transaction',   title: 'First Share',           description: 'You completed your first transaction on ShareSwap!',            icon: '🌱', color: '#22c55e', category: 'milestone' },
  { name: 'five_transactions',   title: 'Community Sharer',      description: 'Completed 5 transactions — you\'re an active member!',          icon: '⭐', color: '#f59e0b', category: 'milestone' },
  { name: 'ten_transactions',    title: 'Power Sharer',          description: 'Completed 10 transactions — you\'re a ShareSwap regular!',      icon: '🏆', color: '#ef4444', category: 'milestone' },
  { name: 'first_lend',          title: 'First Lend',            description: 'Lent an item to a neighbour for the first time.',               icon: '🤝', color: '#3b82f6', category: 'lending'  },
  { name: 'five_lends',          title: 'Generous Lender',       description: 'Lent items 5 times — your neighbours appreciate you!',          icon: '💫', color: '#3b82f6', category: 'lending'  },
  { name: 'first_gift',          title: 'Gift Giver',            description: 'Gave your first gift on ShareSwap.',                            icon: '🎁', color: '#ec4899', category: 'social'   },
  { name: 'three_gifts',         title: 'Generous Gifter',       description: 'Gave 3 gifts — a true spirit of generosity.',                    icon: '🎀', color: '#db2777', category: 'social'   },
  { name: 'first_swap',          title: 'Swap Starter',          description: 'Completed your first item swap.',                               icon: '🔄', color: '#8b5cf6', category: 'social'   },
  { name: 'verified_member',     title: 'Verified Member',       description: 'Completed identity verification on ShareSwap.',                 icon: '✅', color: '#06b6d4', category: 'milestone' },
  // New milestone badges
  { name: 'five_swaps',          title: 'Swap Champion',         description: 'Completed 5 swaps — you\'re a trading pro!',                   icon: '🔁', color: '#7c3aed', category: 'social'   },
  { name: 'ten_gifts',           title: 'Generous Soul',         description: 'Gave away 10 items — your generosity inspires the community!',  icon: '💝', color: '#db2777', category: 'social'   },
  { name: 'five_borrows',        title: 'Active Borrower',       description: 'Borrowed 5 items — making the most of your community!',         icon: '🛍️', color: '#0891b2', category: 'milestone' },
  { name: 'five_listed',         title: 'ShareChest Curator',    description: 'Listed 5 items — your ShareChest is open for business!',        icon: '🗝️', color: '#059669', category: 'lending'  },
  { name: 'five_reviews_left',   title: 'Community Voice',       description: 'Left 5 reviews — helping neighbours make great decisions!',     icon: '💬', color: '#d97706', category: 'social'   },
  { name: 'referral_5',          title: 'Neighbour Connector',   description: 'Referred 5 friends to ShareSwap — spreading the word!',        icon: '🤝', color: '#2563eb', category: 'milestone' },
  { name: 'fast_responder',      title: 'Fast Responder',        description: 'Completed 5+ exchanges quickly — neighbours count on your speed!', icon: '⚡', color: '#f59e0b', category: 'milestone' },
  { name: 'five_star_neighbour', title: 'Five-Star Neighbour',   description: 'Maintained a 4.8+ star rating across 5+ reviews.',               icon: '⭐', color: '#eab308', category: 'social'   },
  { name: 'early_member',        title: 'Early Member',          description: 'One of the founding members of the ShareSwap community.',          icon: '🚀', color: '#7c3aed', category: 'milestone' },
  { name: 'three_in_week',          title: 'Weekly Warrior',      description: 'Completed 3 transactions in a single week — on a roll!',             icon: '⚡', color: '#ea580c', category: 'milestone' },
  { name: 'five_reviews_received',  title: 'Highly Rated',        description: 'Received 5 reviews — your neighbours love working with you!',         icon: '⭐', color: '#ca8a04', category: 'milestone' },
  // Badges converted from milestones
  { name: 'first_borrow',           title: 'First Borrow',        description: 'Borrowed your first item from a neighbour.',                           icon: '💙', color: '#0ea5e9', category: 'milestone' },
  { name: 'reliable_borrower',      title: 'Reliable Borrower',   description: 'Completed 5 exchanges — you return items on time.',                    icon: '🤝', color: '#3b82f6', category: 'milestone' },
  { name: 'trusted_exchanger',      title: 'Trusted Exchanger',   description: 'Completed 10 exchanges — neighbours know they can count on you.',      icon: '🤝', color: '#0e7490', category: 'milestone' },
  { name: 'super_lender',           title: 'Super Lender',        description: 'Lent out 10 items — your ShareChest is a community staple.',           icon: '📦', color: '#7c3aed', category: 'lending'  },
  { name: 'rising_star',            title: 'Rising Star',         description: 'Completed 20 exchanges — an exchange veteran neighbours rely on.',      icon: '📈', color: '#ea580c', category: 'milestone' },
  { name: 'exchange_veteran',       title: 'Exchange Veteran',    description: 'Completed 25 exchanges — you\'ve built something extraordinary.',       icon: '🏆', color: '#d97706', category: 'milestone' },
  { name: 'urgent_helper',          title: 'Urgent Helper',       description: 'Stepped up when a neighbour needed something urgently.',                icon: '⚡', color: '#f59e0b', category: 'social'   },
  { name: 'well_loved',             title: 'Well Loved',          description: 'Received 10 reviews — a well-known face in the community.',             icon: '👑', color: '#7c3aed', category: 'social'   },
  { name: 'neighbourhood_hero',     title: 'Neighbourhood Hero',  description: 'Reached a trust score of 300 — a pillar of the sharing community.',    icon: '🥇', color: '#ca8a04', category: 'milestone' },
  { name: 'shareswap_legend',       title: 'ShareSwap Legend',    description: 'Reached 500 trust score and lent 20+ items — the rarest badge.',       icon: '💎', color: '#b45309', category: 'milestone' },
  { name: 'courier_rider',          title: 'Courier Rider',       description: 'Used courier delivery for a transaction — going the extra distance.',   icon: '🚚', color: '#0891b2', category: 'milestone' },
  { name: 'community_builder',      title: 'Community Builder',   description: 'Referred your first friend to ShareSwap — the community grows!',          icon: '🤝', color: '#2563eb', category: 'social'   },
  { name: 'shareswap_ambassador',   title: 'ShareSwap Ambassador', description: 'Referred 20 friends — a true ambassador of the sharing community.',         icon: '🌟', color: '#4338ca', category: 'milestone' },
  { name: 'coin_collector',         title: 'Coin Collector',       description: 'Accumulated 50 ShareCoins — a true sharing economy regular.',              icon: '🪙', color: '#d97706', category: 'milestone' },
  { name: 'power_lister',           title: 'Power Lister',        description: 'Listed 10 items — your ShareChest is stocked for the neighbourhood!',    icon: '📚', color: '#059669', category: 'lending'  },
  { name: 'wish_maker',             title: 'Wish Maker',           description: 'Added 3 items to your wishlist — you know what your community can offer.', icon: '🔖', color: '#e11d48', category: 'social'   },
  { name: 'good_neighbour',         title: 'Good Neighbour',        description: 'Lent the same item to 3 different people — sharing efficiency at its best.', icon: '🏠', color: '#16a34a', category: 'lending'  },
  { name: 'photo_pro',              title: 'Photo Pro',             description: 'Listed an item with 5 or more photos — making it irresistible to borrow.',   icon: '📷', color: '#7c3aed', category: 'lending'  },
  { name: 'welcome_wagon',          title: 'Welcome Wagon',         description: 'Completed a transaction with a user who joined in the last 30 days.',         icon: '👋', color: '#0891b2', category: 'social'   },
];

async function checkAndAwardAchievements(userId: number) {
  try {
    const completedWhere = or(eq(itemRequests.status, "COMPLETED"), eq(itemRequests.status, "COMPLETED_EARLY"));
    const ownerItemsSub = sql`${itemRequests.itemId} IN (SELECT id FROM items WHERE owner_id = ${userId})`;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      [user],
      [totalRow], [lentRow], [giftRow], [swapRow],
      [borrowRow], [itemsRow], [reviewsLeftRow], [referralRow], [weeklyRow], [reviewsReceivedRow],
      [urgentRow], [courierRow],
    ] = await Promise.all([
      db.select({ isVerified: users.isVerified, reputationScore: users.reputationScore, shareCoins: users.shareCoins }).from(users).where(eq(users.id, userId)).limit(1),
      // Total completed transactions (any side)
      db.select({ cnt: sql<number>`count(*)` }).from(itemRequests).where(and(or(eq(itemRequests.requesterId, userId), ownerItemsSub), completedWhere)),
      // Items lent (as owner)
      db.select({ cnt: sql<number>`count(*)` }).from(itemRequests).innerJoin(items, eq(items.id, itemRequests.itemId)).where(and(eq(items.ownerId, userId), completedWhere)),
      // Gifts given (as owner)
      db.select({ cnt: sql<number>`count(*)` }).from(itemRequests).innerJoin(items, eq(items.id, itemRequests.itemId)).where(and(eq(items.ownerId, userId), eq(itemRequests.requestType, "GIFT"), completedWhere)),
      // Swaps (any side)
      db.select({ cnt: sql<number>`count(*)` }).from(itemRequests).where(and(or(eq(itemRequests.requesterId, userId), ownerItemsSub), eq(itemRequests.requestType, "SWAP"), completedWhere)),
      // Borrows (as requester)
      db.select({ cnt: sql<number>`count(*)` }).from(itemRequests).where(and(eq(itemRequests.requesterId, userId), eq(itemRequests.requestType, "BORROW"), completedWhere)),
      // Items listed by user
      db.select({ cnt: sql<number>`count(*)` }).from(items).where(eq(items.ownerId, userId)),
      // Reviews left by user
      db.select({ cnt: sql<number>`count(*)` }).from(userReviews).where(eq(userReviews.reviewerId, userId)),
      // Successful referrals (completed and rewarded)
      db.select({ cnt: sql<number>`count(*)` }).from(referrals).where(and(eq(referrals.referrerId, userId), eq(referrals.isRewardClaimed, true))),
      // Completed transactions in the past 7 days
      db.select({ cnt: sql<number>`count(*)` }).from(itemRequests).where(and(
        or(eq(itemRequests.requesterId, userId), ownerItemsSub),
        completedWhere,
        sql`item_requests.created_at >= ${sevenDaysAgo}`,
      )),
      // Reviews received
      db.select({ cnt: sql<number>`count(*)` }).from(userReviews).where(eq(userReviews.reviewedUserId, userId)),
      // Urgent wishlist requests helped
      db.select({ cnt: sql<number>`count(*)` }).from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .innerJoin(wishlists, sql`${wishlists.itemName} ILIKE '%' || ${items.name} || '%'`)
        .where(and(eq(items.ownerId, userId), completedWhere, eq(wishlists.urgency, "urgent"))),
      // Courier deliveries (any side)
      db.select({ cnt: sql<number>`count(*)` }).from(itemRequests).where(and(or(eq(itemRequests.requesterId, userId), ownerItemsSub), completedWhere, eq(itemRequests.deliveryMethod, "courier"))),
    ]);

    const total          = Number(totalRow?.cnt ?? 0);
    const lent           = Number(lentRow?.cnt ?? 0);
    const gifts          = Number(giftRow?.cnt ?? 0);
    const swaps          = Number(swapRow?.cnt ?? 0);
    const borrows        = Number(borrowRow?.cnt ?? 0);
    const listed         = Number(itemsRow?.cnt ?? 0);
    const reviewsLeft    = Number(reviewsLeftRow?.cnt ?? 0);
    const refs           = Number(referralRow?.cnt ?? 0);
    const weekly         = Number(weeklyRow?.cnt ?? 0);
    const reviewsRx      = Number(reviewsReceivedRow?.cnt ?? 0);
    const urgent         = Number(urgentRow?.cnt ?? 0);
    const courier        = Number(courierRow?.cnt ?? 0);
    const repScore       = Number(user?.reputationScore ?? 0);

    const metKeys: string[] = [];
    if (total >= 1)       metKeys.push('first_transaction');
    if (total >= 5)       metKeys.push('five_transactions');
    if (total >= 10)      metKeys.push('ten_transactions');
    if (lent >= 1)        metKeys.push('first_lend');
    if (lent >= 5)        metKeys.push('five_lends');
    if (gifts >= 1)       metKeys.push('first_gift');
    if (gifts >= 3)       metKeys.push('three_gifts');
    if (swaps >= 1)       metKeys.push('first_swap');
    if (user?.isVerified) metKeys.push('verified_member');
    // Milestone-origin badges
    if (swaps >= 5)       metKeys.push('five_swaps');
    if (gifts >= 10)      metKeys.push('ten_gifts');
    if (borrows >= 5)     metKeys.push('five_borrows');
    if (listed >= 5)      metKeys.push('five_listed');
    if (listed >= 10)     metKeys.push('power_lister');
    if (reviewsLeft >= 5) metKeys.push('five_reviews_left');
    if (refs >= 1)        metKeys.push('community_builder');
    if (refs >= 5)        metKeys.push('referral_5');
    if (refs >= 20)       metKeys.push('shareswap_ambassador');
    if (weekly >= 3)      metKeys.push('three_in_week');
    // Newly added badges
    if (borrows >= 1)     metKeys.push('first_borrow');
    if (total >= 5)       metKeys.push('reliable_borrower');
    if (total >= 10)      metKeys.push('trusted_exchanger');
    if (lent >= 10)       metKeys.push('super_lender');
    if (total >= 20)      metKeys.push('rising_star');
    if (total >= 25)      metKeys.push('exchange_veteran');
    if (urgent >= 1)      metKeys.push('urgent_helper');
    if (courier >= 1)     metKeys.push('courier_rider');
    {
      const [earnedRow] = await db.select({ total: sql<number>`coalesce(sum(amount), 0)` }).from(shareCoinsTransactions).where(and(eq(shareCoinsTransactions.userId, userId), sql`amount > 0`));
      if (Number(earnedRow?.total ?? 0) >= 50) metKeys.push('coin_collector');
    }
    {
      const [wlRow] = await db.select({ cnt: sql<number>`count(*)` }).from(wishlists).where(eq(wishlists.userId, userId));
      if (Number(wlRow?.cnt ?? 0) >= 3) metKeys.push('wish_maker');
    }
    {
      const [ppRow] = await db.select({ cnt: sql<number>`count(*)` }).from(items).where(and(eq(items.ownerId, userId), sql`array_length(items.photos, 1) >= 5`));
      if (Number(ppRow?.cnt ?? 0) >= 1) metKeys.push('photo_pro');
    }
    {
      const gnRes = await db.execute(sql`SELECT COUNT(*) AS cnt FROM (SELECT item_requests.item_id FROM item_requests INNER JOIN items ON items.id = item_requests.item_id WHERE items.owner_id = ${userId} AND item_requests.status IN ('COMPLETED','COMPLETED_EARLY') GROUP BY item_requests.item_id HAVING COUNT(DISTINCT item_requests.requester_id) >= 3) AS subq`);
      if (Number((gnRes.rows?.[0] as any)?.cnt ?? 0) >= 1) metKeys.push('good_neighbour');
    }
    {
      const wwRes = await db.execute(sql`SELECT COUNT(*) AS cnt FROM item_requests ir INNER JOIN items i ON i.id = ir.item_id WHERE ir.status IN ('COMPLETED','COMPLETED_EARLY') AND ((i.owner_id = ${userId} AND EXISTS (SELECT 1 FROM users u WHERE u.id = ir.requester_id AND ir.created_at >= u.created_at AND ir.created_at - u.created_at < INTERVAL '30 days')) OR (ir.requester_id = ${userId} AND EXISTS (SELECT 1 FROM users u WHERE u.id = i.owner_id AND ir.created_at >= u.created_at AND ir.created_at - u.created_at < INTERVAL '30 days')))`);
      if (Number((wwRes.rows?.[0] as any)?.cnt ?? 0) >= 1) metKeys.push('welcome_wagon');
    }
    if (reviewsRx >= 10)  metKeys.push('well_loved');
    if (repScore >= 300)  metKeys.push('neighbourhood_hero');
    if (repScore >= 500 && lent >= 20) metKeys.push('shareswap_legend');
    // Fast Responder: 5+ completed exchanges (as owner) resolved within 48 hours
    {
      const [frCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(and(
          eq(items.ownerId, userId),
          or(eq(itemRequests.status, "COMPLETED"), eq(itemRequests.status, "COMPLETED_EARLY")),
          sql`item_requests.accepted_at < item_requests.created_at + interval '48 hours'`
        ));
      if (Number(frCount?.count || 0) >= 5) metKeys.push('fast_responder');
    }
    // Five-Star Neighbour: 5+ reviews with avg >= 4.8
    {
      const [rRow] = await db
        .select({ cnt: sql<number>`count(*)`, avg: sql<number>`avg(${userReviews.rating})` })
        .from(userReviews).where(eq(userReviews.reviewedUserId, userId));
      if (Number(rRow?.cnt || 0) >= 5 && Number(rRow?.avg || 0) >= 4.8) metKeys.push('five_star_neighbour');
    }
    // Early Member: joined before Sept 1, 2026
    {
      const [u] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
      if (u?.createdAt && new Date(u.createdAt) < new Date('2026-09-01')) metKeys.push('early_member');
    }
    if (reviewsRx >= 5)   metKeys.push('five_reviews_received');

    for (const key of metKeys) {
      const def = ACHIEVEMENT_DEFS.find(d => d.name === key);
      if (!def) continue;

      let [achievement] = await db.select({ id: achievements.id }).from(achievements).where(eq(achievements.name, key)).limit(1);
      if (!achievement) {
        [achievement] = await db.insert(achievements).values({
          name: key,
          description: def.description,
          badgeIcon: def.icon,
          badgeColor: def.color,
          category: def.category,
        }).returning({ id: achievements.id });
      }

      const [existing] = await db.select({ id: userAchievements.id }).from(userAchievements).where(
        and(eq(userAchievements.userId, userId), eq(userAchievements.achievementId, achievement.id))
      ).limit(1);
      if (existing) continue;

      // Newly unlocked — award +1 ShareCoin
      await db.insert(userAchievements).values({ userId, achievementId: achievement.id, isCompleted: true, progress: 100 });
      await db.insert(shareCoinsTransactions).values({
        userId,
        amount: "1",
        description: `Badge unlocked: ${def.title}`,
        transactionType: "EARNED",
      });
      await db.update(users).set({ shareCoins: sql`share_coins + 1` }).where(eq(users.id, userId));
      await db.insert(notifications).values({
        userId,
        type: "badge_earned",
        title: `🏅 Badge Unlocked: ${def.title}`,
        message: `${def.description} +1 ShareCoin awarded!`,
        link: "/achievements",
        isRead: false,
      });
    }
  } catch (err) {
    console.error('Error checking/awarding achievements:', err);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// Initialize Stripe - will be loaded from connector
import { getUncachableStripeClient, getStripePublishableKey } from "../stripe.server";

// Helper to get stripe client (lazy loaded from connector)
let stripeClient: Stripe | null = null;
async function getStripe(): Promise<Stripe> {
  if (!stripeClient) {
    stripeClient = await getUncachableStripeClient();
  }
  return stripeClient;
}

// Legacy alias for existing code - proxy to async stripe client
const stripe = {
  customers: {
    create: async (...args: Parameters<Stripe['customers']['create']>) => {
      const s = await getStripe();
      return s.customers.create(...args);
    },
  },
  setupIntents: {
    create: async (...args: Parameters<Stripe['setupIntents']['create']>) => {
      const s = await getStripe();
      return s.setupIntents.create(...args);
    },
  },
  paymentIntents: {
    create: async (...args: Parameters<Stripe['paymentIntents']['create']>) => {
      const s = await getStripe();
      return s.paymentIntents.create(...args);
    },
    retrieve: async (...args: Parameters<Stripe['paymentIntents']['retrieve']>) => {
      const s = await getStripe();
      return s.paymentIntents.retrieve(...args);
    },
    update: async (...args: Parameters<Stripe['paymentIntents']['update']>) => {
      const s = await getStripe();
      return s.paymentIntents.update(...args);
    },
    cancel: async (...args: Parameters<Stripe['paymentIntents']['cancel']>) => {
      const s = await getStripe();
      return s.paymentIntents.cancel(...args);
    },
    capture: async (...args: Parameters<Stripe['paymentIntents']['capture']>) => {
      const s = await getStripe();
      return s.paymentIntents.capture(...args);
    },
  },
  paymentMethods: {
    retrieve: async (...args: Parameters<Stripe['paymentMethods']['retrieve']>) => {
      const s = await getStripe();
      return s.paymentMethods.retrieve(...args);
    },
    attach: async (...args: Parameters<Stripe['paymentMethods']['attach']>) => {
      const s = await getStripe();
      return s.paymentMethods.attach(...args);
    },
    detach: async (...args: Parameters<Stripe['paymentMethods']['detach']>) => {
      const s = await getStripe();
      return s.paymentMethods.detach(...args);
    },
  },
  checkout: {
    sessions: {
      create: async (...args: Parameters<Stripe['checkout']['sessions']['create']>) => {
        const s = await getStripe();
        return s.checkout.sessions.create(...args);
      },
      retrieve: async (...args: Parameters<Stripe['checkout']['sessions']['retrieve']>) => {
        const s = await getStripe();
        return s.checkout.sessions.retrieve(...args);
      },
    },
  },
  accounts: {
    create: async (...args: Parameters<Stripe['accounts']['create']>) => {
      const s = await getStripe();
      return s.accounts.create(...args);
    },
    retrieve: async (...args: Parameters<Stripe['accounts']['retrieve']>) => {
      const s = await getStripe();
      return s.accounts.retrieve(...args);
    },
  },
  accountLinks: {
    create: async (...args: Parameters<Stripe['accountLinks']['create']>) => {
      const s = await getStripe();
      return s.accountLinks.create(...args);
    },
  },
  transfers: {
    create: async (...args: Parameters<Stripe['transfers']['create']>) => {
      const s = await getStripe();
      return s.transfers.create(...args);
    },
  },
};

// Type extension for Passport.js session data
declare module 'express-session' {
  interface SessionData {
    passport?: {
      user: number;
    };
  }
}

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateBoundingBox(lat: number, lon: number, radiusKm: number) {
  const R = 6371; // Earth's radius in kilometers
  const latRad = (lat * Math.PI) / 180;
  
  // Calculate latitude bounds
  const latDelta = (radiusKm / R) * (180 / Math.PI);
  let minLat = Math.max(-90, lat - latDelta);  // Clamp to valid latitude range
  let maxLat = Math.min(90, lat + latDelta);
  
  // Calculate longitude bounds (adjusted for latitude)
  // Handle extreme latitudes where cos(lat) approaches 0
  const cosLat = Math.cos(latRad);
  const lonDelta = cosLat > 0.001 
    ? (radiusKm / (R * cosLat)) * (180 / Math.PI) 
    : 180; // At poles, search all longitudes
  
  let minLon = lon - lonDelta;
  let maxLon = lon + lonDelta;
  
  // Handle antimeridian crossing (longitude wrap around ±180)
  let crossesAntimeridian = false;
  if (minLon < -180) {
    minLon += 360;
    crossesAntimeridian = true;
  }
  if (maxLon > 180) {
    maxLon -= 360;
    crossesAntimeridian = true;
  }
  
  return { minLat, maxLat, minLon, maxLon, crossesAntimeridian };
}

// Security: Configure multer with memory storage for object storage uploads
const memoryStorage = multer.memoryStorage();

// Security: File upload validation and limits
const upload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 10, // Max 10 files per request
  },
  fileFilter: function (req, file, cb) {
    // Only allow image files
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype.toLowerCase();
    
    if (allowedMimeTypes.includes(mimeType) && allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'));
    }
  },
});

// Verification level helper types and functions
type VerificationLevel = 'unverified' | 'email_only' | 'fully_verified';

interface VerificationCheckResult {
  level: VerificationLevel;
  emailVerified: boolean;
  idVerified: boolean;
  paymentVerified: boolean;
}

// Check user's verification level
async function checkVerificationLevel(userId: number): Promise<VerificationCheckResult> {
  const [user] = await db
    .select({
      emailVerified: users.emailVerified,
      googleId: users.googleId,
      authProvider: users.authProvider,
      stripePaymentMethodId: users.stripePaymentMethodId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Google OAuth users are automatically email verified
  const emailVerified = user?.emailVerified || !!user?.googleId || user?.authProvider === 'google';

  // Check identity verification (verifications table has an approved record)
  const [idVerification] = await db
    .select({ status: verifications.status })
    .from(verifications)
    .where(
      and(
        eq(verifications.userId, userId),
        eq(verifications.status, 'approved')
      )
    )
    .limit(1);
  const idVerified = !!idVerification;

  // Check payment method verification (user has Stripe payment method on file)
  const paymentVerified = !!user?.stripePaymentMethodId;

  let level: VerificationLevel = 'unverified';
  if (emailVerified && idVerified && paymentVerified) {
    level = 'fully_verified';
  } else if (emailVerified) {
    level = 'email_only';
  }

  return { level, emailVerified, idVerified, paymentVerified };
}

// Middleware to require email verification for most actions
async function requireEmailVerified(req: any, res: any, next: any) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Please sign in to continue" });
  }

  const verification = await checkVerificationLevel(req.user.id);
  if (!verification.emailVerified) {
    return res.status(403).json({ 
      error: "Please verify your email address to access this feature",
      code: "EMAIL_NOT_VERIFIED"
    });
  }

  req.verificationLevel = verification;
  next();
}

// Middleware to require full verification (email + ID + payment) for borrow/rent
async function requireFullVerification(req: any, res: any, next: any) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Please sign in to continue" });
  }

  const verification = await checkVerificationLevel(req.user.id);
  
  if (!verification.emailVerified) {
    return res.status(403).json({ 
      error: "Please verify your email address to access this feature",
      code: "EMAIL_NOT_VERIFIED"
    });
  }

  if (verification.level !== 'fully_verified') {
    return res.status(403).json({ 
      error: "Please complete identity and payment verification to borrow or rent items",
      code: "FULL_VERIFICATION_REQUIRED",
      missing: {
        idVerified: verification.idVerified,
        paymentVerified: verification.paymentVerified
      }
    });
  }

  req.verificationLevel = verification;
  next();
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Map of userId → WebSocket connection — shared by REST routes and the WS handler
  const connectedClients = new Map<number, WebSocket>();

  // Serve uploaded files
  app.use("/uploads", express.static("uploads"));

  // Security: CSRF token endpoint - call this before making mutating requests
  // This endpoint generates and sets the CSRF token cookie
  app.get("/api/csrf-token", (req, res) => {
    // Never cache — every call must return a fresh signed token so retries work
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");

    // Generate and set CSRF token in cookie
    const token = setCsrfToken(req, res);
    console.log('[CSRF Token Endpoint] Token generated and set');

    res.json({
      message: "CSRF token set in cookie and ready for use",
      // Also returned in the body: native clients (e.g. React Native/Expo)
      // cannot read Set-Cookie headers or document.cookie, so they need the
      // token value directly to send back in the x-csrf-token header.
      csrfToken: token,
    });
  });

  // Get Stripe publishable key for frontend
  app.get("/api/stripe/publishable-key", async (req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error) {
      console.error("Error fetching Stripe publishable key:", error);
      res.status(500).json({ error: "Failed to get Stripe configuration" });
    }
  });

  // Security: Apply CSRF protection to all routes except login/register/csrf-token/referrals
  // CSRF protection automatically applies to POST, PUT, DELETE, PATCH (not GET, HEAD, OPTIONS)
  app.use((req, res, next) => {
    // Skip CSRF for login, register, csrf-token, and referrals endpoints
    const skipPaths = ['/api/login', '/api/register', '/api/csrf-token', '/api/referrals/generate'];
    if (skipPaths.includes(req.path)) {
      return next();
    }
    // Apply CSRF protection to all other routes
    csrfProtection(req, res, next);
  });

  // Track last active timestamp for authenticated users (rate-limited to once per minute)
  const lastActiveUpdateCache = new Map<number, number>();
  app.use((req, res, next) => {
    if (req.isAuthenticated() && req.user) {
      const userId = req.user.id;
      const now = Date.now();
      const lastUpdate = lastActiveUpdateCache.get(userId) || 0;
      if (now - lastUpdate > 60_000) {
        lastActiveUpdateCache.set(userId, now);
        db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, userId)).catch(() => {});
      }
    }
    next();
  });

  app.post("/api/verify", upload.single("idDocument"), async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Validate required fields
      if (!req.body.fullName || req.body.fullName.trim() === "") {
        return res.status(400).json({ error: "Full name is required" });
      }

      if (!req.body.idNumber || req.body.idNumber.trim() === "") {
        return res.status(400).json({ error: "ID number is required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "ID document is required" });
      }

      // CRITICAL SECURITY WARNING: PCI COMPLIANCE VIOLATION!
      // This code accepts raw credit card data (card number, CVV, expiry) directly.
      // This is NOT PCI-DSS compliant and creates severe legal and security risks.
      // 
      // REQUIRED BEFORE PRODUCTION:
      // 1. Integrate with a PCI-compliant payment gateway (Stripe, Square, Braintree)
      // 2. Use tokenization - never handle raw card data
      // 3. Replace this entire section with payment gateway integration
      // 4. Store only the payment method token, never raw card data
      // 5. Remove all credit card data from request logs
      //
      // Current risk level: CRITICAL - DO NOT DEPLOY WITHOUT FIXING
      
      if (!req.body.cardNumber || req.body.cardNumber.trim().length !== 16) {
        return res.status(400).json({ error: "Valid 16-digit card number is required" });
      }

      if (!req.body.expiry || !/^(0[1-9]|1[0-2])\/([0-9]{2})$/.test(req.body.expiry)) {
        return res.status(400).json({ error: "Valid expiry date (MM/YY) is required" });
      }

      if (!req.body.cvv || req.body.cvv.trim().length !== 3) {
        return res.status(400).json({ error: "Valid 3-digit CVV is required" });
      }
      
      // NOTE: At least this data is NOT being stored in the database (verified below)
      // But handling it at all is still a violation

      const verification = await db
        .insert(verifications)
        .values({
          userId: req.user.id,
          fullName: req.body.fullName,
          idNumber: req.body.idNumber,
          status: "pending",
        })
        .returning();

      res.status(201).json(verification[0]);
    } catch (error) {
      console.error("Error creating verification:", error);
      res.status(500).json({ error: "Failed to submit verification. Please try again." });
    }
  });

  app.get("/api/verification-status", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const [verification] = await db
      .select()
      .from(verifications)
      .where(eq(verifications.userId, req.user.id))
      .orderBy(desc(verifications.createdAt))
      .limit(1);

    if (!verification) {
      return res.json({
        status: 'unverified',
        legalFullName: null,
        submittedAt: null,
        verifiedAt: null,
        failureReason: null,
      });
    }

    // Map database status to frontend status
    // personaStatus "created" means the inquiry was started but the user never submitted it —
    // treat it as unverified so they can retry rather than being stuck on "Under Review".
    let status: 'unverified' | 'pending' | 'verified' | 'failed' = 'unverified';
    if (verification.status === 'pending' && verification.personaStatus !== 'created') status = 'pending';
    else if (verification.status === 'approved') status = 'verified';
    else if (verification.status === 'rejected') status = 'failed';

    // Get verifiedAt from user record if verified
    const [user] = await db
      .select({ verifiedAt: users.verifiedAt })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    res.json({
      status,
      legalFullName: verification.fullName,
      submittedAt: verification.createdAt,
      verifiedAt: user?.verifiedAt || null,
      failureReason: status === 'failed' ? 'Document could not be verified. Please upload a clearer image.' : null,
    });
  });

  // New identity-only verification endpoint (no card data)
  app.post("/api/verify-identity", upload.single("idDocument"), async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      if (!req.body.legalFullName || req.body.legalFullName.trim() === "") {
        return res.status(400).json({ error: "Legal full name is required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "ID document is required" });
      }

      // Check for existing pending verification
      const [existing] = await db
        .select()
        .from(verifications)
        .where(and(
          eq(verifications.userId, req.user.id),
          eq(verifications.status, "pending")
        ))
        .limit(1);

      if (existing) {
        return res.status(400).json({ error: "You already have a pending verification request" });
      }

      const verification = await db
        .insert(verifications)
        .values({
          userId: req.user.id,
          fullName: req.body.legalFullName,
          idNumber: "ID_DOC_UPLOADED", // Placeholder since we're not collecting ID number anymore
          status: "pending",
        })
        .returning();

      res.status(201).json({
        success: true,
        status: 'pending',
      });
    } catch (error) {
      console.error("Error creating verification:", error);
      res.status(500).json({ error: "Failed to submit verification. Please try again." });
    }
  });

  // Admin: Approve user verification (for demo/testing - auto-approve own verification)
  app.post("/api/verify/approve", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const userId = req.user.id;
      
      // Check if user has a pending verification
      const [verification] = await db
        .select()
        .from(verifications)
        .where(eq(verifications.userId, userId))
        .orderBy(desc(verifications.createdAt))
        .limit(1);

      if (!verification || verification.status === "approved") {
        return res.status(400).json({ error: "No pending verification found" });
      }

      // Update verification status
      await db
        .update(verifications)
        .set({ status: "approved" })
        .where(eq(verifications.id, verification.id));

      // VERIFICATION REWARDS:
      // 1. Check if user also has payment method on file - both required for full verification
      // 2. Boost trust/reputation score significantly (+50 points)
      const VERIFICATION_TRUST_BOOST = 50;
      
      // Check if user has payment method on file
      const [currentUser] = await db
        .select({ stripePaymentMethodId: users.stripePaymentMethodId })
        .from(users)
        .where(eq(users.id, userId));
      
      const hasPaymentMethod = !!currentUser?.stripePaymentMethodId;
      
      await db
        .update(users)
        .set({
          isVerified: hasPaymentMethod, // Only verified if both ID and payment method exist
          verifiedAt: hasPaymentMethod ? new Date() : null,
          reputationScore: sql`LEAST(500, COALESCE(reputation_score, 0) + ${VERIFICATION_TRUST_BOOST})`,
        })
        .where(eq(users.id, userId));

      // Log the reputation activity
      await db.insert(reputationActivities).values({
        userId: userId,
        activityType: "VERIFICATION_APPROVED",
        points: VERIFICATION_TRUST_BOOST,
        description: "Account verified with ID and payment method",
      });

      // Award 5 ShareCoins for profile verification
      const VERIFICATION_SHARECOIN_REWARD = 5;
      await db.insert(shareCoinsTransactions).values({
        userId: userId,
        amount: VERIFICATION_SHARECOIN_REWARD.toString(),
        description: "Profile Verification Bonus",
        transactionType: "EARNED",
      });

      await db
        .update(users)
        .set({
          shareCoins: sql`share_coins + ${VERIFICATION_SHARECOIN_REWARD}`,
        })
        .where(eq(users.id, userId));

      console.log(`✅ Awarded ${VERIFICATION_SHARECOIN_REWARD} ShareCoins to user ${userId} for profile verification`);

      await db.insert(notifications).values([
        {
          userId,
          type: "sharecoin_earned",
          title: `+${VERIFICATION_SHARECOIN_REWARD} ShareCoins Earned`,
          message: `+${VERIFICATION_SHARECOIN_REWARD} ShareCoins for completing identity verification.`,
          isRead: false,
        },
        {
          userId,
          type: "trust_score_changed",
          title: `Trust Score +${VERIFICATION_TRUST_BOOST}`,
          message: "ID verification approved",
          isRead: false,
        },
      ]);
      await checkAndAwardAchievements(userId);

      res.json({ 
        success: true, 
        message: "Verified! Trust score boost and 5 ShareCoins awarded.",
        trustBoost: VERIFICATION_TRUST_BOOST,
        shareCoinsAwarded: VERIFICATION_SHARECOIN_REWARD
      });
    } catch (error) {
      console.error("Error approving verification:", error);
      res.status(500).json({ error: "Failed to approve verification" });
    }
  });

  app.post("/api/persona/create-inquiry", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const userId = req.user.id;
      const personaApiKey = process.env.PERSONA_API_KEY;
      const templateId = process.env.PERSONA_TEMPLATE_ID;

      if (!personaApiKey || !templateId) {
        return res.status(500).json({ error: "Persona is not configured" });
      }

      const [existingPending] = await db
        .select()
        .from(verifications)
        .where(and(
          eq(verifications.userId, userId),
          eq(verifications.status, "pending")
        ))
        .limit(1);

      if (existingPending && existingPending.personaInquiryId) {
        // Verify the existing inquiry is still in a resumable state
        const checkRes = await fetch(`https://api.withpersona.com/api/v1/inquiries/${existingPending.personaInquiryId}`, {
          headers: {
            "Authorization": `Bearer ${personaApiKey}`,
            "Persona-Version": "2023-01-05",
            "Key-Inflection": "camel",
          },
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          const inquiryStatus = checkData.data?.attributes?.status;
          // Only reuse if the inquiry is still in a resumable state
          if (inquiryStatus === "created" || inquiryStatus === "pending") {
            return res.json({ inquiryId: existingPending.personaInquiryId, status: "existing" });
          }
          console.log(`[Persona] Existing inquiry ${existingPending.personaInquiryId} is in state '${inquiryStatus}' — creating a new one`);
        } else {
          console.log(`[Persona] Could not verify existing inquiry ${existingPending.personaInquiryId} (${checkRes.status}) — creating a new one`);
        }
        // Fall through: create a fresh inquiry and update the DB record
      }

      const [currentUser] = await db
        .select({ username: users.username, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const response = await fetch("https://api.withpersona.com/api/v1/inquiries", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${personaApiKey}`,
          "Content-Type": "application/json",
          "Persona-Version": "2023-01-05",
          "Key-Inflection": "camel",
        },
        body: JSON.stringify({
          data: {
            type: "inquiry",
            attributes: {
              "inquiry-template-id": templateId,
              "reference-id": `user_${userId}`,
              fields: {
                nameFirst: currentUser?.fullName?.split(" ")[0] || "",
                nameLast: currentUser?.fullName?.split(" ").slice(1).join(" ") || "",
              },
            },
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Persona API error:", errorText);
        return res.status(500).json({ error: "Failed to create verification inquiry" });
      }

      const result = await response.json();
      const inquiryId = result.data?.id;

      if (!inquiryId) {
        return res.status(500).json({ error: "Invalid response from verification service" });
      }

      if (existingPending) {
        await db
          .update(verifications)
          .set({ personaInquiryId: inquiryId, personaStatus: "created" })
          .where(eq(verifications.id, existingPending.id));
      } else {
        await db
          .insert(verifications)
          .values({
            userId,
            personaInquiryId: inquiryId,
            personaStatus: "created",
            status: "pending",
          });
      }

      res.json({ inquiryId });
    } catch (error) {
      console.error("Error creating Persona inquiry:", error);
      res.status(500).json({ error: "Failed to start verification" });
    }
  });

  app.post("/api/persona/inquiry-complete", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { inquiryId, status } = req.body;
      const userId = req.user.id;

      if (!inquiryId) {
        return res.status(400).json({ error: "Inquiry ID is required" });
      }

      const personaApiKey = process.env.PERSONA_API_KEY;
      if (!personaApiKey) {
        return res.status(500).json({ error: "Persona is not configured" });
      }

      const checkResponse = await fetch(`https://api.withpersona.com/api/v1/inquiries/${inquiryId}`, {
        headers: {
          "Authorization": `Bearer ${personaApiKey}`,
          "Persona-Version": "2023-01-05",
          "Key-Inflection": "camel",
        },
      });

      if (!checkResponse.ok) {
        return res.status(500).json({ error: "Failed to verify inquiry status" });
      }

      const inquiryData = await checkResponse.json();
      const personaStatus = inquiryData.data?.attributes?.status;
      const nameFirst = inquiryData.data?.attributes?.nameFirst || "";
      const nameLast = inquiryData.data?.attributes?.nameLast || "";
      const fullName = `${nameFirst} ${nameLast}`.trim();

      const [verification] = await db
        .select()
        .from(verifications)
        .where(and(
          eq(verifications.userId, userId),
          eq(verifications.personaInquiryId, inquiryId)
        ))
        .limit(1);

      if (!verification) {
        return res.status(404).json({ error: "Verification record not found" });
      }

      if (verification.status === "approved") {
        return res.json({
          success: true,
          status: "approved",
          message: "Identity already verified.",
        });
      }

      if (personaStatus === "approved") {
        await db
          .update(verifications)
          .set({
            status: "approved",
            personaStatus,
            fullName: fullName || verification.fullName,
            idNumber: "PERSONA_VERIFIED",
          })
          .where(eq(verifications.id, verification.id));

        const VERIFICATION_TRUST_BOOST = 50;
        const [currentUser] = await db
          .select({ stripePaymentMethodId: users.stripePaymentMethodId })
          .from(users)
          .where(eq(users.id, userId));

        const hasPaymentMethod = !!currentUser?.stripePaymentMethodId;

        await db
          .update(users)
          .set({
            isVerified: hasPaymentMethod,
            verifiedAt: hasPaymentMethod ? new Date() : null,
            fullName: fullName || undefined,
            reputationScore: sql`LEAST(500, COALESCE(reputation_score, 0) + ${VERIFICATION_TRUST_BOOST})`,
          })
          .where(eq(users.id, userId));

        await db.insert(reputationActivities).values({
          userId,
          activityType: "VERIFICATION_APPROVED",
          points: VERIFICATION_TRUST_BOOST,
          description: "Identity verified via Persona (ID + selfie match)",
        });

        const VERIFICATION_SHARECOIN_REWARD = 5;
        await db.insert(shareCoinsTransactions).values({
          userId,
          amount: VERIFICATION_SHARECOIN_REWARD.toString(),
          description: "Profile Verification Bonus",
          transactionType: "EARNED",
        });

        await db
          .update(users)
          .set({
            shareCoins: sql`share_coins + ${VERIFICATION_SHARECOIN_REWARD}`,
          })
          .where(eq(users.id, userId));

        console.log(`✅ Persona verification approved for user ${userId}`);

        await db.insert(notifications).values([
          {
            userId,
            type: "sharecoin_earned",
            title: `+${VERIFICATION_SHARECOIN_REWARD} ShareCoins Earned`,
            message: `+${VERIFICATION_SHARECOIN_REWARD} ShareCoins for completing identity verification.`,
            isRead: false,
          },
          {
            userId,
            type: "trust_score_changed",
            title: `Trust Score +${VERIFICATION_TRUST_BOOST}`,
            message: "ID verification approved",
            isRead: false,
          },
        ]);
        await checkAndAwardAchievements(userId);

        res.json({
          success: true,
          status: "approved",
          message: "Verified! Trust score boost and 5 ShareCoins awarded.",
        });
      } else if (personaStatus === "completed") {
        await db
          .update(verifications)
          .set({ personaStatus: "completed" })
          .where(eq(verifications.id, verification.id));

        res.json({
          success: true,
          status: "pending",
          message: "Verification is being reviewed. You'll be notified when complete.",
        });
      } else if (personaStatus === "declined" || personaStatus === "failed") {
        await db
          .update(verifications)
          .set({
            status: "rejected",
            personaStatus,
          })
          .where(eq(verifications.id, verification.id));

        await db.insert(notifications).values({
          userId,
          type: "verification_failed",
          title: "Verification Failed",
          message: "Verification unsuccessful. Check your documents and try again.",
          isRead: false,
        });

        res.json({
          success: true,
          status: "failed",
          message: "Verification could not be completed. Please try again.",
        });
      } else {
        await db
          .update(verifications)
          .set({ personaStatus })
          .where(eq(verifications.id, verification.id));

        res.json({
          success: true,
          status: "pending",
          message: "Verification is being processed.",
        });
      }
    } catch (error) {
      console.error("Error processing Persona inquiry:", error);
      res.status(500).json({ error: "Failed to process verification" });
    }
  });

  // IP-based location detection
  app.get("/api/geo/detect", async (req, res) => {
    try {
      // Get client IP from various headers
      const clientIp = req.headers["x-forwarded-for"]?.toString().split(",")[0] || 
                       req.headers["x-real-ip"]?.toString() || 
                       req.socket.remoteAddress || "";
      
      // Use ip-api.com for free IP geolocation (no API key required)
      const response = await fetch(`http://ip-api.com/json/${clientIp}?fields=status,city,zip,lat,lon,regionName`);
      const data = await response.json();
      
      if (data.status === "success") {
        res.json({
          city: data.city || data.regionName || "",
          postalCode: data.zip || "",
          lat: data.lat,
          lon: data.lon,
        });
      } else {
        // Fallback: return empty but valid response
        res.json({
          city: "",
          postalCode: "",
          lat: null,
          lon: null,
        });
      }
    } catch (error) {
      console.error("Error detecting location:", error);
      res.json({
        city: "",
        postalCode: "",
        lat: null,
        lon: null,
      });
    }
  });

  // Geocode a postal code or city name to coordinates
  app.get("/api/geo/geocode", async (req, res) => {
    try {
      const { query } = req.query;
      
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query parameter required" });
      }

      // Use Nominatim for free geocoding (OpenStreetMap)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
        {
          headers: {
            "User-Agent": "ShareSwap/1.0",
          },
        }
      );
      const data = await response.json();

      if (data && data.length > 0) {
        res.json({
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          displayName: data[0].display_name,
        });
      } else {
        res.json({ lat: null, lon: null, displayName: null });
      }
    } catch (error) {
      console.error("Error geocoding:", error);
      res.json({ lat: null, lon: null, displayName: null });
    }
  });

  // Save user location preferences
  app.post("/api/user/location", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { city, postalCode, radius } = req.body;
      const userId = req.user.id;

      await db
        .update(users)
        .set({
          defaultCity: city || null,
          defaultPostalCode: postalCode || null,
          locationRadius: radius || 25,
          hasCompletedLocationSetup: true,
        })
        .where(eq(users.id, userId));

      console.log(`[Location] User ${userId} saved location: ${city || postalCode}, radius: ${radius}km`);

      res.json({ success: true });
    } catch (error) {
      console.error("Error saving location:", error);
      res.status(500).json({ error: "Failed to save location" });
    }
  });

  // ── Notification Preferences ─────────────────────────────────────────────
  // GET  /api/user/notification-prefs  — fetch current preferences
  // PATCH /api/user/notification-prefs — update one or more category flags
  app.get("/api/user/notification-prefs", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const [row] = await db
        .select()
        .from(userNotificationPrefs)
        .where(eq(userNotificationPrefs.userId, req.user.id))
        .limit(1);
      if (!row) {
        // Return defaults — no row means all opted in
        return res.json({
          messages: true,
          requests: true,
          payments: true,
          achievements: true,
          sharecoins: true,
          return_deadlines: true,
        });
      }
      res.json({
        messages: row.messages,
        requests: row.requests,
        payments: row.payments,
        achievements: row.achievements,
        sharecoins: row.sharecoins,
        return_deadlines: row.returnDeadlines,
      });
    } catch (err) {
      console.error("[notification-prefs] GET error:", err);
      res.status(500).json({ error: "Failed to fetch notification preferences" });
    }
  });

  app.patch("/api/user/notification-prefs", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const allowed = ["messages", "requests", "payments", "achievements", "sharecoins", "return_deadlines"] as const;
    type PrefKey = typeof allowed[number];
    const updates: Partial<Record<string, boolean>> = {};
    for (const key of allowed) {
      if (typeof req.body[key] === "boolean") {
        // Map snake_case API key to camelCase DB column
        const dbKey = key === "return_deadlines" ? "returnDeadlines" : key;
        updates[dbKey] = req.body[key];
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid preference fields provided" });
    }
    try {
      // Native upsert — eliminates any concurrent first-write race
      await db
        .insert(userNotificationPrefs)
        .values({
          userId: req.user.id,
          messages: true,
          requests: true,
          payments: true,
          achievements: true,
          sharecoins: true,
          returnDeadlines: true,
          ...updates,
        })
        .onConflictDoUpdate({
          target: userNotificationPrefs.userId,
          set: { ...updates, updatedAt: new Date() },
        });
      res.json({ success: true, updated: updates });
    } catch (err) {
      console.error("[notification-prefs] PATCH error:", err);
      res.status(500).json({ error: "Failed to update notification preferences" });
    }
  });

  // ── Expo Push Token ─────────────────────────────────────────────────────────
  // The mobile app calls this after login to register its Expo push token so
  // the server can send native push notifications.
  //
  // Tokens are stored in user_push_tokens (one row per device) so a user on
  // multiple devices receives all notifications.  When a device token is
  // re-assigned (user reinstalls, factory-resets, or switches accounts), the
  // row is updated so the token belongs to the current authenticated user.
  app.patch("/api/user/push-token", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const { token } = req.body;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "token is required" });
    }
    try {
      // Upsert on the unique token column.  If the token already exists for
      // a different user (device transferred / account switched), we reassign
      // it to the current user.  If it already belongs to this user, we just
      // touch updated_at so we know the device is still alive.
      await db
        .insert(userPushTokens)
        .values({ userId: req.user.id, token, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userPushTokens.token,
          set: { userId: req.user.id, updatedAt: new Date() },
        });
      res.json({ success: true });
    } catch (err) {
      console.error("[push-token] error:", err);
      res.status(500).json({ error: "Failed to save push token" });
    }
  });

  // Profile photo upload endpoint with face validation
  // Accepts both multipart/form-data (web) and JSON base64 (mobile native/web)
  app.post("/api/users/profile-photo", upload.single("profilePhoto"), async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Resolve file buffer + name from either multipart upload or base64 JSON body
      let fileBuffer: Buffer;
      let originalname: string;
      let mimetype: string;

      if (req.file) {
        // Standard multipart upload (web)
        fileBuffer = req.file.buffer;
        originalname = req.file.originalname;
        mimetype = req.file.mimetype;
      } else if (req.body?.imageBase64) {
        // Base64 JSON upload (mobile) — avoids multipart/FormData boundary issues in RN
        const { imageBase64, mimeType, filename } = req.body;
        if (!imageBase64 || typeof imageBase64 !== "string") {
          return res.status(400).json({ error: "Profile photo is required" });
        }
        fileBuffer = Buffer.from(imageBase64, "base64");
        originalname = filename ?? "photo.jpg";
        mimetype = mimeType ?? "image/jpeg";
      } else {
        return res.status(400).json({ error: "Profile photo is required" });
      }

      // Upload photo to object storage
      const photoUrl = await uploadToStorage(fileBuffer, originalname);
      console.log(`[Profile Photo] Uploaded: ${originalname} -> ${photoUrl}`);
      
      const userId = req.user.id;

      // Get user to check if they've already earned the bonus
      const [user] = await db
        .select({ hasUploadedProfilePhoto: users.hasUploadedProfilePhoto })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const hasAlreadyEarnedBonus = user?.hasUploadedProfilePhoto === true;

      // Validate photo with AI if user hasn't earned bonus yet
      let validationStatus = "pending";
      let validationReason = "";
      let shareCoinsAwarded = 0;

      if (!hasAlreadyEarnedBonus) {
        try {
          // Use resolved buffer (from multipart or base64 JSON)
          const base64Image = fileBuffer.toString("base64");
          const mimeType = mimetype || "image/jpeg";

          // Call GPT-4 Vision for face validation
          const OpenAI = (await import("openai")).default;
          const openai = new OpenAI({
            apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
            baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
          });

          const response = await openai.chat.completions.create({
            model: "gpt-5",
            messages: [
              {
                role: "system",
                content: `You are a profile photo moderator for ShareSwap, a peer-to-peer sharing community. Your job is to determine if a profile photo shows a clear, visible human face suitable for building trust in the community.

APPROVE photos that:
- Show a clear, visible human face (selfies, headshots, portrait photos)
- Have reasonable lighting and focus
- Show a single person as the clear subject
- Natural accessories like glasses, hats, or light makeup are fine

REJECT photos that:
- Logos, icons, graphics, or illustrations (no person at all)
- Only pets, objects, or scenery with no human face visible
- Face completely cropped out or fully hidden (e.g. back of head only)
- Memes, screenshots, or collages

Respond with ONLY valid JSON in this exact format:
{"decision": "approved" or "rejected", "reason": "brief explanation"}`
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Please analyze this profile photo and determine if it shows a clear, visible human face."
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${mimeType};base64,${base64Image}`,
                      detail: "auto"
                    }
                  }
                ]
              }
            ],
            max_tokens: 150,
            temperature: 0.1
          });

          const content = response.choices[0]?.message?.content || "";
          console.log(`📷 Profile photo validation for user ${userId}:`, content);

          // Parse the AI response
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const result = JSON.parse(jsonMatch[0]);
              validationStatus = result.decision === "approved" ? "approved" : "rejected";
              validationReason = result.reason || "";
            } else {
              // If can't parse, be conservative and reject
              validationStatus = "rejected";
              validationReason = "Could not verify face in photo";
            }
          } catch (parseError) {
            console.error("Error parsing AI response:", parseError);
            validationStatus = "rejected";
            validationReason = "Could not verify face in photo";
          }
        } catch (aiError) {
          console.error("AI validation error (awarding coin anyway):", aiError);
          // If AI validation fails for any reason, fail open — award the coin
          // The photo is saved and the reward is given; validation is a UX encouragement, not a strict gate
          validationStatus = "approved";
          validationReason = "Validation skipped";
        }
      }

      // Update user profile photo (always save, even if validation fails)
      const updateData: any = {
        profilePhoto: photoUrl,
        profilePhotoValidationStatus: validationStatus,
        profilePhotoValidationReason: validationReason,
      };

      // Award bonus on first upload regardless of AI validation result
      // AI validation is informational only, not a gate
      if (!hasAlreadyEarnedBonus) {
        updateData.hasUploadedProfilePhoto = true;
        shareCoinsAwarded = 1;

        await db.insert(shareCoinsTransactions).values({
          userId,
          amount: "1",
          description: "Profile Photo Upload Bonus",
          transactionType: "EARNED",
        });

        await db
          .update(users)
          .set({
            ...updateData,
            shareCoins: sql`share_coins + 1`,
          })
          .where(eq(users.id, userId));

        console.log(`✅ Awarded 1 ShareCoin to user ${userId} for uploading profile photo`);

        await db.insert(notifications).values({
          userId,
          type: "sharecoin_earned",
          title: "+1 ShareCoin Earned",
          message: "You earned 1 ShareCoin for adding a profile photo.",
          isRead: false,
        });
      } else {
        await db
          .update(users)
          .set(updateData)
          .where(eq(users.id, userId));
      }

      // Determine response message
      let message: string;
      if (hasAlreadyEarnedBonus) {
        message = "Profile photo updated!";
      } else {
        message = "Profile photo uploaded! You earned 1 ShareCoin.";
      }

      res.json({
        success: true,
        profilePhoto: photoUrl,
        validationStatus,
        validationReason: validationStatus === "rejected" ? validationReason : undefined,
        shareCoinsAwarded,
        hasAlreadyEarnedBonus,
        message,
      });

    } catch (error) {
      console.error("Error uploading profile photo:", error);
      res.status(500).json({ error: "Failed to upload profile photo" });
    }
  });

  // SmartScan endpoints
  app.get("/api/smartscan/usage", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if we need to reset monthly usage
      const now = new Date();
      const resetDate = user.smartScansResetDate ? new Date(user.smartScansResetDate) : new Date();
      
      // Reset on the 1st of each month
      if (resetDate.getMonth() !== now.getMonth() || resetDate.getFullYear() !== now.getFullYear()) {
        await db
          .update(users)
          .set({
            smartScansUsed: 0,
            smartScansResetDate: now,
          })
          .where(eq(users.id, req.user.id));

        return res.json({
          scansUsed: 0,
          scansRemaining: user.isPremium ? "unlimited" : 3,
          isPremium: user.isPremium,
          resetDate: now.toISOString(),
        });
      }

      const scansUsed = user.smartScansUsed || 0;
      const scansRemaining = user.isPremium ? "unlimited" : Math.max(0, 3 - scansUsed);

      res.json({
        scansUsed,
        scansRemaining,
        isPremium: user.isPremium,
        resetDate: resetDate.toISOString(),
      });
    } catch (error) {
      console.error("Error fetching SmartScan usage:", error);
      res.status(500).json({ error: "Failed to fetch usage data" });
    }
  });

  app.post("/api/smartscan/analyze", upload.array("photos", 10), async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Get user data
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check usage limits (unless premium)
      if (!user.isPremium) {
        const now = new Date();
        const resetDate = user.smartScansResetDate ? new Date(user.smartScansResetDate) : new Date();
        
        let scansUsed = user.smartScansUsed || 0;

        // Reset if needed
        if (resetDate.getMonth() !== now.getMonth() || resetDate.getFullYear() !== now.getFullYear()) {
          scansUsed = 0;
          await db
            .update(users)
            .set({
              smartScansUsed: 0,
              smartScansResetDate: now,
            })
            .where(eq(users.id, req.user.id));
        }

        if (scansUsed >= 3) {
          return res.status(403).json({ 
            error: "SmartScan limit reached",
            message: "SmartScan limit reached. Upgrade to Premium for unlimited scans.",
          });
        }
      }

      // Validate images
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        return res.status(400).json({ error: "At least one image is required" });
      }

      const files = req.files as Express.Multer.File[];
      const photoUrls = files.map(f => `/uploads/${path.basename(f.path)}`);

      // Initialize OpenAI client with Replit AI Integrations
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      // Prepare images for OpenAI Vision API
      const fs = await import('fs/promises');
      const imageContents = await Promise.all(
        files.map(async (file) => {
          const buffer = await fs.readFile(file.path);
          const base64 = buffer.toString('base64');
          return {
            type: "image_url" as const,
            image_url: {
              url: `data:${file.mimetype};base64,${base64}`,
            },
          };
        })
      );

      // Call GPT-4 Vision API
      const completion = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are an expert at identifying and analyzing items from photos for a peer-to-peer sharing marketplace. Pay special attention to LUXURY BRANDS (Chanel, Louis Vuitton, Hermès, Gucci, Prada, Rolex, Cartier, Dior, Balenciaga, etc.) - these items often have market values in the thousands or tens of thousands of dollars.

STRICT NAME RULE — READ THIS FIRST:
The "name" field must be 2–4 words maximum. It is a plain noun phrase identifying what the object IS. Strip ALL adjectives, adverbs, descriptors, and qualifiers.
BAD: "Modern baby stroller with adjustable canopy" → GOOD: "baby stroller"
BAD: "Elegant floral table centerpiece arrangement" → GOOD: "floral centerpiece"
BAD: "Elegant place cards with cursive names" → GOOD: "place cards"
BAD: "High-performance cordless drill set" → GOOD: "cordless drill"
BAD: "Beautiful vintage wooden coffee table" → GOOD: "coffee table"
Rule: noun only, no adjectives, max 4 words, lowercase.

Analyze these images and extract the following information in JSON format:

{
  "name": "2–4 word noun phrase ONLY. No adjectives. See STRICT NAME RULE above.",
  "description": "Detailed description including notable features, condition details, and any visible wear or damage (100-300 chars)",
  "category": "One of: Electronics, Tools, Sports, Home & Garden, Books & Media, Clothing, Toys & Games, Kitchen, Outdoor, Other",
  "brand": "Brand name if visible, otherwise 'Unknown'",
  "isLuxuryBrand": "Boolean - true if this is a recognized luxury/designer brand",
  "conditionRating": "Integer 1-5 where 1=Poor, 2=Fair, 3=Good, 4=Very Good, 5=Excellent",
  ${user.isPremium ? '"estimatedValue": "Estimated CURRENT MARKET value in USD. For luxury items, research typical resale values (e.g., authentic Chanel bags: $3,000-$15,000+, Hermès Birkin: $10,000-$100,000+). Just the number, e.g., \'8500.00\'",' : ''}
  "suggestedValueRange": "One of: Under $50, $50–$150, $150–$300, $300–$1,000, $1,000–$5,000, $5,000+",
  "confidence": "Float 0-1 indicating how confident you are in this analysis"
}

IMPORTANT: For luxury designer items, do NOT undervalue. A genuine Chanel purse is worth $3,000-$15,000+. Look for authenticity markers like logo quality, stitching, hardware, serial numbers. Be specific and honest about condition.`,
              },
              ...imageContents,
            ],
          },
        ],
        max_tokens: 500,
        temperature: 0.3,
      });

      // Parse AI response
      const aiResponse = completion.choices[0]?.message?.content;
      if (!aiResponse) {
        throw new Error("No response from AI");
      }

      // Extract JSON from response (handle markdown code blocks)
      let analysisData;
      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error("No JSON found in response");
        }
        analysisData = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error("Failed to parse AI response:", aiResponse);
        throw new Error("Invalid AI response format");
      }

      // Update usage tracking
      if (!user.isPremium) {
        await db
          .update(users)
          .set({
            smartScansUsed: sql`${users.smartScansUsed} + 1`,
          })
          .where(eq(users.id, req.user.id));
      }

      // Strip adjectives / prepositional phrases from AI-generated name
      const rawName: string = (analysisData.name || "").trim();
      const cleanedName = rawName
        .replace(/\s+(with|for|of|and|featuring|including)\s+.*/i, "") // drop "with X", "for Y" etc.
        .split(/\s+/)
        .slice(0, 4)
        .join(" ")
        .toLowerCase() || "item";

      res.json({
        success: true,
        analysis: {
          name: cleanedName || "Unidentified Item",
          description: analysisData.description || "AI analysis completed.",
          category: analysisData.category || "Other",
          brand: analysisData.brand || "Unknown",
          isLuxuryBrand: analysisData.isLuxuryBrand === true,
          conditionRating: Math.min(5, Math.max(1, parseInt(analysisData.conditionRating) || 3)),
          estimatedValue: user.isPremium && analysisData.estimatedValue ? analysisData.estimatedValue : null,
          suggestedValueRange: analysisData.suggestedValueRange || null,
          confidence: parseFloat(analysisData.confidence) || 0.5,
        },
        photos: photoUrls,
        scansRemaining: user.isPremium ? "unlimited" : (2 - (user.smartScansUsed || 0)),
      });
    } catch (error) {
      console.error("Error analyzing images:", error);
      
      // Fallback to basic response if AI fails (don't charge the user)
      const files = req.files as Express.Multer.File[];
      const photoUrls = files ? files.map(f => `/uploads/${path.basename(f.path)}`) : [];
      
      res.json({
        success: true,
        analysis: {
          name: "Item",
          description: "AI analysis temporarily unavailable. Please fill in details manually.",
          category: "Other",
          brand: "Unknown",
          conditionRating: 3,
          estimatedValue: null,
          confidence: 0.1,
        },
        photos: photoUrls,
      });
    }
  });

  // AI-powered listing autofill from uploaded photos
  app.post("/api/listings/ai-generate", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { imageDataUrls } = req.body;
    if (!imageDataUrls || !Array.isArray(imageDataUrls) || imageDataUrls.length === 0) {
      return res.status(400).json({ error: "At least one image is required" });
    }

    try {
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const imageContents = (imageDataUrls as string[]).slice(0, 3).map((url) => ({
        type: "image_url" as const,
        image_url: { url },
      }));

      const completion = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: `You are helping list an item on a peer-to-peer sharing marketplace. Analyze the uploaded photos and return ONLY a JSON object.

STRICT TITLE RULE — FOLLOW EXACTLY:
"title" must be 2–4 words. It is the plain noun phrase for what the object IS. No adjectives, no descriptors, no marketing words.
If you recognize the specific product model name (e.g. UPPAbaby Cruz, Bugaboo Cameleon, iPhone 15, MacBook Pro), include the model name in the title INSTEAD of a generic adjective.
BAD: "Modern baby stroller with adjustable canopy" → GOOD: "Cruz stroller"
BAD: "Elegant floral table centerpiece arrangement" → GOOD: "floral centerpiece"
BAD: "High-performance cordless drill set" → GOOD: "cordless drill"
BAD: "Beautiful vintage wooden coffee table" → GOOD: "coffee table"
Rule: 2–4 words max, no generic adjectives (modern/elegant/high-performance etc.), lowercase.

{
  "title": "2–4 word noun phrase. Include model name if recognized (e.g. 'Cruz stroller', 'Vista stroller', 'iPhone 15 Pro'). See STRICT TITLE RULE above.",
  "description": "Honest practical description highlighting key features and any visible wear, 50-200 characters",
  "condition": "One of exactly: New / Like New, Good, Fair, Well Loved — assess visible wear, fading, pilling, or damage. If item looks clean and lightly used choose Good. If clearly worn or faded choose Fair. Never return empty.",
  "category": "One of exactly: Baby & Kids, Clothing & Accessories, Electronics, Hobbies & Collectibles, Home & Kitchen, Tools & Equipment",
  "brand": "Manufacturer brand name if visible or recognizable from the item's design (e.g. UPPAbaby, Bugaboo, Britax, Graco, Apple, Samsung, Sony, IKEA, Dyson). Empty string if unknown.",
  "model": "Specific product model name if recognizable (e.g. Cruz, Vista, Ridge, Minu for UPPAbaby; Cameleon, Fox for Bugaboo; iPhone 15 Pro, MacBook Air for Apple). Empty string if unknown.",
  "originalPrice": "Your best-estimate original retail price as a plain number string e.g. '799.99'. Use typical retail prices for the item type and brand — UPPAbaby Cruz ~$800, generic baby stroller ~$100-300. Never return empty string, always give your best guess."
}

Be accurate and practical. Always populate every field — never leave condition or originalPrice blank. Return ONLY the JSON, no other text.`,
            },
            ...imageContents,
          ],
        }],
        max_tokens: 600,
        temperature: 0.2,
      });

      const aiResponse = completion.choices[0]?.message?.content;
      if (!aiResponse) throw new Error("No response from AI");

      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");

      const data = JSON.parse(jsonMatch[0]);

      const rawTitle: string = (data.title || "").trim();
      console.log('[ai-generate] raw AI title:', rawTitle);
      const cleanedTitle = rawTitle
        .replace(/\s+(with|for|of|and|featuring|including)\s+.*/i, "")
        .split(/\s+/)
        .slice(0, 4)
        .join(" ")
        .toLowerCase() || "";
      console.log('[ai-generate] cleaned title:', cleanedTitle);

      const catalogMatch = matchCatalog(data.brand || "", data.model || "");
      console.log('[ai-generate] catalog match:', catalogMatch);

      res.json({
        title: cleanedTitle || data.title || "",
        description: data.description || "",
        condition: data.condition || "",
        category: data.category || "",
        brand: data.brand || "",
        model: data.model || "",
        originalPrice: data.originalPrice || "",
        catalogMatch: catalogMatch && !catalogMatch.brandOnly && catalogMatch.confidence >= 0.65
          ? catalogMatch
          : null,
      });
    } catch (error) {
      console.error("AI generate listing error:", error);
      res.status(500).json({ error: "Failed to generate listing details" });
    }
  });

  // Import listing from marketplace screenshot using GPT-4 Vision
  app.post('/api/import-from-screenshot', upload.array('screenshots', 5), async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'At least one screenshot is required' });
      }

      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const imageContent = files.map(file => ({
        type: 'image_url' as const,
        image_url: {
          url: `data:${file.mimetype || 'image/jpeg'};base64,${file.buffer.toString('base64')}`,
          detail: 'high' as const,
        },
      }));

      const completion = await openai.chat.completions.create({
        model: 'gpt-5',
        messages: [
          {
            role: 'user',
            content: [
              ...imageContent,
              {
                type: 'text',
                text: `Analyze ${files.length > 1 ? 'these marketplace listing screenshots' : 'this marketplace listing screenshot'} and extract every visible detail. Return ONLY valid JSON with EXACTLY these fields:

STRICT NAME RULE — READ THIS FIRST:
The "name" field must be 2–4 words maximum. Plain noun phrase only — what the object IS. No adjectives, no descriptors, no qualifiers.
BAD: "Modern baby stroller with adjustable canopy" → GOOD: "baby stroller"
BAD: "Elegant floral table centerpiece arrangement" → GOOD: "floral centerpiece"
BAD: "High-performance cordless drill set" → GOOD: "cordless drill"
BAD: "Beautiful vintage wooden coffee table" → GOOD: "coffee table"
Rule: noun only, no adjectives, max 4 words, lowercase.

{
  "name": "2–4 word noun phrase ONLY. No adjectives. See STRICT NAME RULE above.",
  "description": "full description from the listing, cleaned up",
  "price": <number or null>,
  "condition": "New / Like New" or "Good" or "Fair" or "Well Loved",
  "conditionRating": <integer 1-10>,
  "brand": "brand name or empty string",
  "itemType": "one of: Electronics, Furniture, Clothing, Sporting Goods, Tools, Books & Media, Toys & Games, Kitchen & Dining, Baby & Kids, Musical Instruments, Art & Collectibles, Automotive, Outdoor & Garden, Health & Beauty, Other",
  "visibleDamage": "describe any visible damage or wear, or empty string if none",
  "modelVersion": "model number, version, year, size or empty string",
  "isLuxury": <true or false>,
  "originalValue": "Under $50" or "$50–$199" or "$200–$499" or "$500–$2,000",
  "suggestedTier": <1, 2, 3, or 4>,
  "photoScores": [<0.0-1.0 per image>]
}

Condition mapping: new/like new/mint → "New / Like New" (rating 9-10); good/great/excellent → "Good" (7-8); fair/used/okay → "Fair" (5-6); worn/damaged/poor → "Well Loved" (1-4).
IMPORTANT — originalValue is the item's ORIGINAL RETAIL PRICE when bought new (not the current asking/listing price). Estimate based on item type, brand, and model. Examples: basic clothing/shoes → "$50–$199"; branded electronics/appliances → "$200–$499" or "$500–$2,000"; luxury goods → "$500–$2,000". Do NOT use the marketplace listing price to determine originalValue.
Tier: under $50 → tier 1; $50-$199 → tier 2; $200-$499 → tier 3; $500+ → tier 4. Tier is based on originalValue only.
Luxury: true if brand is designer/premium (e.g. Gucci, LV, Apple, Sony, Dyson, Rolex, etc).
photoScores: for each image in order, rate 0.0-1.0 how clearly it shows the main product item (not marketplace UI, not profile photos, not nav/icons). Score 0.8+ for a clear product photo taking up most of the image, 0.5-0.7 for product visible but small or partially obscured, below 0.5 for UI-only/text-only/no product visible.
Return only the JSON object, no other text.`
              }
            ]
          }
        ],
        max_tokens: 1200,
      });

      const raw = completion.choices[0]?.message?.content || '';
      console.log('[Screenshot Import] Raw AI response:', raw.substring(0, 500));

      // Robust JSON extraction: try direct parse, strip code fences, then regex
      let extracted: any = null;
      const candidates = [
        raw.trim(),
        raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(),
      ];
      for (const candidate of candidates) {
        try {
          extracted = JSON.parse(candidate);
          break;
        } catch {}
      }
      if (!extracted) {
        // Last resort: find first {...} block
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start !== -1 && end > start) {
          try {
            extracted = JSON.parse(raw.substring(start, end + 1));
          } catch {}
        }
      }
      if (!extracted) {
        console.error('[Screenshot Import] Could not parse response:', raw);
        return res.status(500).json({ error: 'Could not parse AI response' });
      }

      const validConditions = ['New / Like New', 'Good', 'Fair', 'Well Loved'];
      const validTiers = [1, 2, 3, 4];
      const validValues = ['Under $50', '$50–$199', '$200–$499', '$500–$2,000'];

      const rawScores = Array.isArray(extracted.photoScores) ? extracted.photoScores : [];
      const photoScores = files.map((_, i) =>
        Math.min(1, Math.max(0, parseFloat(String(rawScores[i] ?? 0.5)) || 0.5))
      );

      const rawExtractedName: string = (extracted.name || "").trim();
      console.log('[import-from-screenshot] raw AI name:', rawExtractedName);
      const cleanedExtractedName = rawExtractedName
        .replace(/\s+(with|for|of|and|featuring|including)\s+.*/i, "")
        .split(/\s+/)
        .slice(0, 4)
        .join(" ")
        .toLowerCase() || "imported item";
      console.log('[import-from-screenshot] cleaned name:', cleanedExtractedName);

      return res.json({
        name: cleanedExtractedName || 'imported item',
        description: extracted.description || '',
        price: extracted.price ? parseFloat(String(extracted.price)) : null,
        condition: validConditions.includes(extracted.condition) ? extracted.condition : 'Good',
        conditionRating: Math.min(10, Math.max(1, parseInt(String(extracted.conditionRating)) || 7)),
        brand: extracted.brand || '',
        itemType: extracted.itemType || '',
        visibleDamage: extracted.visibleDamage || '',
        modelVersion: extracted.modelVersion || '',
        isLuxury: !!extracted.isLuxury,
        originalValue: validValues.includes(extracted.originalValue) ? extracted.originalValue : '$50–$199',
        suggestedTier: validTiers.includes(parseInt(String(extracted.suggestedTier))) ? parseInt(String(extracted.suggestedTier)) : 2,
        photoScores,
      });
    } catch (error) {
      const err = error as any;
      console.error('Screenshot import error:', err);
      return res.status(500).json({ error: err.message || 'Failed to analyze screenshot' });
    }
  });

  // AI-powered item category detection
  app.post("/api/detect-category", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { itemName } = req.body;
      
      if (!itemName || typeof itemName !== 'string' || itemName.length < 3) {
        return res.status(400).json({ error: "Valid item name is required" });
      }

      const ITEM_CATEGORIES = [
        "Baby & Kids",
        "Clothing & Accessories", 
        "Electronics",
        "Hobbies & Collectibles",
        "Home & Kitchen",
        "Tools & Equipment",
      ];

      // Use OpenAI to categorize the item (with Replit AI Integrations)
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a categorization assistant. Given an item name, determine which category it belongs to.
            
Available categories:
- Baby & Kids (strollers, cribs, toys, baby clothes, car seats, playpens, etc.)
- Clothing & Accessories (adult clothing, shoes, bags, jewelry, hats, scarves, hair accessories, hair clips, sunglasses, watches, belts, etc.)
- Electronics (phones, laptops, cameras, TVs, speakers, headphones, gaming, etc.)
- Hobbies & Collectibles (board games, musical instruments, sports cards, vinyl records, art supplies, craft kits, puzzles, figurines, etc.)
- Home & Kitchen (furniture, appliances, cookware, decor, bedding, storage, etc.)
- Tools & Equipment (power tools, hand tools, gardening, ladders, outdoor equipment, etc.)

Respond with ONLY the category name, nothing else.`
          },
          {
            role: "user",
            content: `Categorize this item: "${itemName}"`
          }
        ],
        temperature: 0.1,
        max_tokens: 20,
      });

      const detectedCategory = response.choices[0]?.message?.content?.trim() || "";
      
      // Validate the detected category is in our list
      const validCategory = ITEM_CATEGORIES.find(cat => 
        cat.toLowerCase() === detectedCategory.toLowerCase()
      );

      res.json({ 
        category: validCategory || null,
        confidence: validCategory ? 0.9 : 0.3
      });
    } catch (error: any) {
      console.error("Error detecting category:", error);
      res.json({ category: null, confidence: 0 });
    }
  });

  // Real-time AI valuation preview endpoint
  app.post("/api/valuation/preview", csrfProtection, async (req, res) => {
    try {
      const { name, description, itemType, category, brand, condition, conditionRating, originalValue, estimatedValue, photos } = req.body;

      if (!name || !condition || !originalValue) {
        return res.status(400).json({ error: "Missing required fields: name, condition, originalValue" });
      }

      // Calculate tier and replacement value using new priority logic:
      // 1. If AI estimated value exists → use it, calculate tier from it
      // 2. If no AI → use midpoint of original value range, calculate tier from it
      const { replacementValue: calculatedRV, tier, source: rvSource } = calculateReplacementValueAndTier(
        estimatedValue,
        originalValue,
        condition
      );

      // Validate and limit photos
      let validPhotos: string[] = [];
      if (photos && Array.isArray(photos)) {
        validPhotos = photos.slice(0, 3).filter((p: string) => 
          typeof p === 'string' && (p.startsWith('data:image/') || p.startsWith('/uploads/') || p.startsWith('http'))
        );
      }

      // Prepare valuation input
      const valuationInput: ItemValuationInput = {
        tier,
        condition,
        conditionRating: parseInt(conditionRating) || 5,
        brand: brand || null,
        category: category || null,
        itemType: itemType || null,
        name,
        description: description || "",
        originalValue: originalValue || null,
        estimatedValue: estimatedValue || null,
        photos: validPhotos.length > 0 ? validPhotos : undefined,
      };

      const result = await calculateAIValuation(valuationInput);
      
      // Replacement value = max(AI market estimate, original value range midpoint).
      // This ensures the owner is protected at least at the original purchase price level
      // even if AI estimates a lower current resale value.
      const finalReplacementValue = Math.max(
        result.internalItemValue > 0 ? result.internalItemValue : calculatedRV,
        calculatedRV
      );
      
      res.json({
        tier,
        replacementValue: finalReplacementValue,
        replacementValueSource: result.internalItemValue > 0 ? 'ai_analysis' : rvSource,
        shareCoinsValue: result.shareCoinsValue,
        tierBand: result.tierBand,
        reasoning: result.reasoning,
        factors: result.factors,
        internalItemValue: result.internalItemValue,
      });
    } catch (error: any) {
      console.error("Valuation preview error:", error);
      res.status(500).json({ error: "Failed to calculate valuation" });
    }
  });

  // Item endpoints
  app.post("/api/items", upload.array("photos"), requireEmailVerified, async (req: any, res) => {
    try {
      // Log the received data for debugging
      console.log("Received request body:", req.body);

      // Validate required fields
      if (!req.body.name || req.body.name.trim() === "") {
        return res.status(400).json({ error: "Item name is required" });
      }

      if (!req.body.description || req.body.description.trim() === "") {
        return res.status(400).json({ error: "Item description is required" });
      }

      // Handle photos from SmartScan or manual upload
      let photoUrls: string[] = [];
      const wasSmartScanned = req.body.wasSmartScanned === "true";
      
      if (wasSmartScanned && req.body.smartScanPhotos) {
        // Use SmartScan photos (already uploaded to object storage)
        photoUrls = JSON.parse(req.body.smartScanPhotos);
      } else if (req.body.existingPhotos) {
        // Re-use existing photo URLs (e.g. swap-prefill from received item)
        photoUrls = JSON.parse(req.body.existingPhotos);
      } else {
        // Upload photos to object storage for persistence
        const files = req.files as Express.Multer.File[];
        if (files && files.length > 0) {
          for (const file of files) {
            try {
              const storageUrl = await uploadToStorage(file.buffer, file.originalname);
              photoUrls.push(storageUrl);
              console.log(`[Item Upload] Photo uploaded: ${file.originalname} -> ${storageUrl}`);
            } catch (error) {
              console.error(`[Item Upload] Failed to upload ${file.originalname}:`, error);
            }
          }
        }
      }

      // Parse location data
      const latitude = req.body.latitude ? parseFloat(req.body.latitude) : null;
      const longitude = req.body.longitude
        ? parseFloat(req.body.longitude)
        : null;

      // Parse boolean flags
      const isLendable = req.body.isLendable === "true";
      const isSwappable = req.body.isSwappable === "true";
      const isRentable = req.body.isRentable === "true";
      const isGift = req.body.isGift === "true";

    // Calculate tier and replacement value using new priority logic:
    // 1. If AI estimated value exists → use it as replacement value, calculate tier from it
    // 2. If no AI → use midpoint of original value range as replacement value, calculate tier from it
    const { replacementValue: calculatedRV, tier: calculatedTier, source: rvSource } = calculateReplacementValueAndTier(
      req.body.estimatedValue,
      req.body.originalValue,
      req.body.condition
    );
    
    const tier = calculatedTier;
    
    // Calculate ShareCoins reward using AI valuation when tier is available
    let shareCoinsReward = 5; // Default base reward
    let aiValuationResult = null;

    if (tier && tier >= 1 && tier <= 4) {
      // Use AI to calculate exact ShareCoin value within the tier band
      const valuationInput: ItemValuationInput = {
        tier,
        condition: req.body.condition || "Good",
        conditionRating: parseInt(req.body.conditionRating) || 5,
        brand: req.body.brand || null,
        category: req.body.category || null,
        itemType: req.body.itemType || null,
        name: req.body.name,
        description: req.body.description || "",
        originalValue: req.body.originalValue || null,
        estimatedValue: req.body.estimatedValue || null,
      };

      try {
        aiValuationResult = await calculateAIValuation(valuationInput);
        shareCoinsReward = aiValuationResult.shareCoinsValue;
        console.log(`AI Valuation for "${req.body.name}": ${shareCoinsReward} ShareCoins (Tier ${tier}, Band: ${aiValuationResult.tierBand.min}-${aiValuationResult.tierBand.max})`);
        console.log(`Reasoning: ${aiValuationResult.reasoning}`);
      } catch (error) {
        console.error("AI valuation failed, using fallback:", error);
        // Fallback to tier-based minimum
        const band = getTierBand(tier);
        shareCoinsReward = band.min;
      }
    } else {
      // No tier provided - use legacy calculation based on sharing modes
      const baseReward = 5;
      shareCoinsReward = baseReward;

      if (isLendable) {
        const securityDeposit = parseFloat(req.body.securityDeposit || "0");
        const lendingDuration = parseInt(req.body.lendingDuration || "0");
        
        if (!isNaN(securityDeposit) && !isNaN(lendingDuration)) {
          const lendingReward = Math.max(
            10,
            Math.floor(securityDeposit * lendingDuration * 0.01),
          );
          shareCoinsReward += lendingReward;
        } else {
          shareCoinsReward += 10;
        }
      }

      if (isSwappable) {
        shareCoinsReward += 20;
      }

      if (isRentable) {
        const securityDeposit = parseFloat(req.body.securityDeposit || "0");
        if (!isNaN(securityDeposit)) {
          const rentalReward = 25 + Math.floor(securityDeposit * 0.05);
          shareCoinsReward += rentalReward;
        } else {
          shareCoinsReward += 25;
        }
      }

      if (isGift) {
        shareCoinsReward += 5;
      }
    }

    // Ensure shareCoinsReward is a valid number
    if (isNaN(shareCoinsReward)) {
      shareCoinsReward = 5; // Fallback to base reward
    }

    // Set replacement value for all items (locked at listing time)
    // Always take the MAX of AI market estimate and original value range midpoint.
    // The owner paid the original price — replacement value must protect them at that level
    // even if the AI's current resale estimate is lower.
    let replacementValue: number | null = null;
    if (aiValuationResult && aiValuationResult.internalItemValue > 0) {
      replacementValue = Math.max(aiValuationResult.internalItemValue, calculatedRV);
      console.log(`Replacement value: $${replacementValue} (AI: $${aiValuationResult.internalItemValue}, range midpoint: $${calculatedRV})`);
    } else {
      replacementValue = calculatedRV;
      console.log(`Replacement value from ${rvSource === 'ai' ? 'SmartScan' : 'range midpoint'}: $${replacementValue}`);
    }

    if (replacementValue !== null && replacementValue > 2000) {
      return res.status(400).json({
        message: "Items with a replacement value over $2,000 cannot be listed at this time. Please select a lower value range.",
      });
    }

    // Parse swap preferences
    const swapDesiredItem = req.body.swapDesiredItem || null;
    const swapNotifyOnMatch = req.body.swapNotifyOnMatch === "true";

    const itemData: InsertItem = {
      name: req.body.name,
      description: req.body.description,
      category: req.body.category || null,
      brand: req.body.brand || null,
      itemType: req.body.itemType || null,
      condition: req.body.condition || null,
      originalValue: req.body.originalValue || null,
      tier: tier,
      conditionRating: parseInt(req.body.conditionRating) || 0,
      photos: photoUrls,
      latitude: latitude?.toString() || null,
      longitude: longitude?.toString() || null,
      address: req.body.address,
      city: req.body.city,
      state: req.body.state,
      country: req.body.country,
      isLendable,
      isSwappable,
      isRentable,
      isGift,
      securityDeposit: req.body.rentalSecurityDeposit || req.body.securityDeposit || "0",
      dollarsPrice: req.body.dollarsPrice || null,
      lendingDuration: parseInt(req.body.lendingDuration || "0") || 0,
      shareCoinsReward: shareCoinsReward.toString(),
      shareCoinPrice: shareCoinsReward.toString(),
      estimatedValue: replacementValue ? replacementValue.toString() : null,
      replacementValue: replacementValue,
      isAvailable: true,
      isConditionVerified: false,
      wasSmartScanned: wasSmartScanned,
      swapDesiredItem: swapDesiredItem,
      swapNotifyOnMatch: swapNotifyOnMatch,
      listingExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ownerId: req.user.id,
    };

    // First insert the item
    const [item] = await db.insert(items).values(itemData).returning();

    // Note: ShareCoins are NOT awarded on listing based on item value
    // The shareCoinsReward field stores the item's valuation for swap calculations
    // However, we DO award a one-time +1 SC bonus for the user's FIRST listing

    // Check if this is user's first listing and award bonus
    let firstListingBonus = 0;
    const [userRecord] = await db
      .select({ hasCompletedFirstListing: users.hasCompletedFirstListing })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (userRecord && !userRecord.hasCompletedFirstListing) {
      firstListingBonus = 1;
      
      // Award 1 ShareCoin for first listing
      await db.insert(shareCoinsTransactions).values({
        userId: req.user.id,
        amount: "1",
        description: "First Listing Bonus",
        transactionType: "EARNED",
      });

      await db
        .update(users)
        .set({
          shareCoins: sql`share_coins + 1`,
          hasCompletedFirstListing: true,
        })
        .where(eq(users.id, req.user.id));

      console.log(`✅ Awarded 1 ShareCoin to user ${req.user.id} for first listing`);
    }

    // Check for swap match notifications
    // Find items where owners want to be notified when matching items are listed
    if (item.isSwappable) {
      try {
        // Get all items with swapNotifyOnMatch enabled (exclude current user's items)
        const itemsWantingMatches = await db
          .select({
            id: items.id,
            ownerId: items.ownerId,
            name: items.name,
            swapDesiredItem: items.swapDesiredItem,
            itemType: items.itemType,
            category: items.category,
          })
          .from(items)
          .where(
            and(
              eq(items.swapNotifyOnMatch, true),
              eq(items.isSwappable, true),
              eq(items.isAvailable, true),
              ne(items.ownerId, req.user.id)
            )
          );

        // Check for matches based on keyword or category
        const newItemName = item.name?.toLowerCase() || "";
        const newItemCategory = item.category?.toLowerCase() || "";
        const newItemType = item.itemType?.toLowerCase() || "";

        for (const existingItem of itemsWantingMatches) {
          const desiredItem = existingItem.swapDesiredItem?.toLowerCase().trim() || "";
          
          // Skip if no swap desired item specified
          if (!desiredItem) continue;
          
          // Split desired item into keywords (handles comma-separated and space-separated)
          const desiredKeywords = desiredItem
            .split(/[,\s]+/)
            .map(k => k.trim())
            .filter(k => k.length > 2);

          // Match criteria:
          // 1. Keyword match: new item name contains desired item keywords
          // 2. Category match: desired item keywords match new item's category or type
          const keywordMatch = 
            // Full phrase match
            newItemName.includes(desiredItem) ||
            // Individual keyword matches in name
            desiredKeywords.some(keyword => newItemName.includes(keyword));
          
          const categoryMatch = 
            // Desired keywords match the new item's category
            desiredKeywords.some(keyword => newItemCategory.includes(keyword)) ||
            // Desired keywords match the new item's type
            desiredKeywords.some(keyword => newItemType.includes(keyword));

          if (keywordMatch || categoryMatch) {
            // Create notification for the item owner
            await db.insert(notifications).values({
              userId: existingItem.ownerId!,
              type: "swap_match",
              title: "New Swap Match",
              message: `"${item.name.length > 22 ? item.name.slice(0, 22) + "…" : item.name}" matches your swap request for "${existingItem.name!.length > 22 ? existingItem.name!.slice(0, 22) + "…" : existingItem.name}".`,
              itemId: item.id,
              isRead: false,
            });
            
            console.log(`📣 Swap match notification sent to user ${existingItem.ownerId} for item "${item.name}"`);
          }
        }
      } catch (error) {
        console.error("Error checking swap matches:", error);
        // Don't fail the request if notification fails
      }
    }

    // Prepare response with AI valuation details
    const responseData: any = {
      ...item,
      shareCoinsReward,
    };
    
    if (aiValuationResult) {
      responseData.aiValuation = {
        tierBand: aiValuationResult.tierBand,
        reasoning: aiValuationResult.reasoning,
        factors: aiValuationResult.factors,
      };
    }

    res.status(201).json(responseData);
    } catch (error) {
      console.error("Error creating item:", error);
      res.status(500).json({ error: "Failed to create item. Please try again." });
    }
  });

  // Update item endpoint
  app.patch("/api/items/:id", upload.array("photos"), requireEmailVerified, async (req: any, res) => {
    try {
      const itemId = parseInt(req.params.id);
      
      // Check if item exists and belongs to the user
      const [existingItem] = await db.select().from(items).where(eq(items.id, itemId));
      
      if (!existingItem) {
        return res.status(404).json({ error: "Item not found" });
      }
      
      if (existingItem.ownerId !== req.user.id) {
        return res.status(403).json({ error: "You can only edit your own items" });
      }

      // Handle photos
      let photoUrls: string[] = existingItem.photos || [];
      const files = req.files as Express.Multer.File[];
      
      if (files && files.length > 0) {
        // Upload new photos to object storage
        photoUrls = [];
        for (const file of files) {
          try {
            const storageUrl = await uploadToStorage(file.buffer, file.originalname);
            photoUrls.push(storageUrl);
            console.log(`[Item Update] Photo uploaded: ${file.originalname} -> ${storageUrl}`);
          } catch (error) {
            console.error(`[Item Update] Failed to upload ${file.originalname}:`, error);
          }
        }
      } else if (req.body.existingPhotos) {
        // Keep existing photos
        photoUrls = JSON.parse(req.body.existingPhotos);
      }

      // Parse location data
      const latitude = req.body.latitude ? parseFloat(req.body.latitude) : null;
      const longitude = req.body.longitude ? parseFloat(req.body.longitude) : null;

      // Parse boolean flags
      const isLendable = req.body.isLendable === "true";
      const isSwappable = req.body.isSwappable === "true";
      const isRentable = req.body.isRentable === "true";
      const isGift = req.body.isGift === "true";

      // Parse tier
      const tier = req.body.tier ? parseInt(req.body.tier) : existingItem.tier;

      // Parse swap preferences
      const swapDesiredItem = req.body.swapDesiredItem !== undefined 
        ? (req.body.swapDesiredItem || null)
        : existingItem.swapDesiredItem;
      const swapNotifyOnMatch = req.body.swapNotifyOnMatch !== undefined
        ? req.body.swapNotifyOnMatch === "true"
        : existingItem.swapNotifyOnMatch;

      const updateData = {
        name: req.body.name || existingItem.name,
        description: req.body.description || existingItem.description,
        itemType: req.body.itemType || existingItem.itemType,
        condition: req.body.condition || existingItem.condition,
        originalValue: req.body.originalValue || existingItem.originalValue,
        tier: tier,
        conditionRating: parseInt(req.body.conditionRating) || existingItem.conditionRating,
        photos: photoUrls,
        latitude: latitude?.toString() || existingItem.latitude,
        longitude: longitude?.toString() || existingItem.longitude,
        isLendable,
        isSwappable,
        isRentable,
        isGift,
        securityDeposit: req.body.rentalSecurityDeposit || req.body.securityDeposit || existingItem.securityDeposit,
        dollarsPrice: req.body.dollarsPrice || existingItem.dollarsPrice,
        swapDesiredItem: swapDesiredItem,
        swapNotifyOnMatch: swapNotifyOnMatch,
        updatedAt: new Date(),
      };

      const [updatedItem] = await db
        .update(items)
        .set(updateData)
        .where(eq(items.id, itemId))
        .returning();

      res.json(updatedItem);
    } catch (error) {
      console.error("Error updating item:", error);
      res.status(500).json({ error: "Failed to update item" });
    }
  });

  // Delete item (hard delete - permanently removes from database)
  app.delete("/api/items/:id", requireEmailVerified, async (req: any, res) => {

    try {
      const itemId = parseInt(req.params.id);
      
      // Check if item exists and belongs to the user
      const [existingItem] = await db.select().from(items).where(eq(items.id, itemId));
      
      if (!existingItem) {
        return res.status(404).json({ error: "Item not found" });
      }
      
      if (existingItem.ownerId !== req.user.id) {
        return res.status(403).json({ error: "You can only delete your own items" });
      }

      // Block deletion for items with active/ongoing transactions
      const BLOCKED_STATUSES = [
        "PENDING", "ACCEPTED", "DEPOSIT_CONFIRMED",
        "AWAITING_HANDOFF_CONFIRM", "HANDOFF_CONFIRMED", "IN_PROGRESS",
        "HANDOFF_DISPUTED", "DISPUTED"
      ];
      const blockingRequests = await db.query.itemRequests.findMany({
        where: and(
          eq(itemRequests.itemId, itemId),
          inArray(itemRequests.status, BLOCKED_STATUSES)
        ),
      });

      if (blockingRequests.length > 0) {
        const s = blockingRequests[0].status;
        const isDispute = s === 'HANDOFF_DISPUTED' || s === 'DISPUTED';
        const isActive = ['IN_PROGRESS', 'HANDOFF_CONFIRMED', 'DEPOSIT_CONFIRMED', 'AWAITING_HANDOFF_CONFIRM'].includes(s);
        const msg = isDispute
          ? "This item is in a dispute and cannot be removed until resolved."
          : isActive
          ? "This item is currently out with a neighbour and cannot be removed."
          : "This item has a pending or accepted request. Please complete or decline it first.";
        return res.status(400).json({ error: msg });
      }

      // Soft-delete: preserve all transaction history
      await db.update(items).set({ isDeleted: true, isAvailable: false }).where(eq(items.id, itemId));

      res.json({ success: true, message: "Item removed from your inventory" });
    } catch (error) {
      console.error("Error deleting item:", error);
      res.status(500).json({ error: "Failed to delete item" });
    }
  });

  // Add new endpoint for finding nearby items (MUST come before /api/items/:id)
  app.get("/api/items/nearby", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { latitude, longitude, radius = 10, type } = req.query; // radius in kilometers, default 10km

      if (!latitude || !longitude) {
        return res
          .status(400)
          .json({ error: "Latitude and longitude are required" });
      }

      const userLat = parseFloat(latitude as string);
      const userLon = parseFloat(longitude as string);

      if (isNaN(userLat) || isNaN(userLon)) {
        return res
          .status(400)
          .json({ error: "Invalid latitude or longitude values" });
      }

      const radiusKm = Number(radius);
      
      // Calculate bounding box for efficient database filtering
      const bbox = calculateBoundingBox(userLat, userLon, radiusKm);

      let whereConditions = [
        eq(items.isAvailable, true),
        eq(items.isDeleted, false),
        sql`${items.latitude} IS NOT NULL`,
        sql`${items.longitude} IS NOT NULL`,
        sql`${items.latitude}::numeric >= ${bbox.minLat}`,
        sql`${items.latitude}::numeric <= ${bbox.maxLat}`,
      ];
      
      // Handle antimeridian crossing with OR condition for longitude
      if (bbox.crossesAntimeridian) {
        whereConditions.push(
          or(
            sql`${items.longitude}::numeric >= ${bbox.minLon}`,
            sql`${items.longitude}::numeric <= ${bbox.maxLon}`
          )!
        );
      } else {
        whereConditions.push(
          sql`${items.longitude}::numeric >= ${bbox.minLon}`,
          sql`${items.longitude}::numeric <= ${bbox.maxLon}`
        );
      }
      
      // Add type-specific filtering
      if (type === 'rent') {
        whereConditions.push(eq(items.isRentable, true));
      } else if (type === 'borrow') {
        whereConditions.push(eq(items.isLendable, true));
      } else if (type === 'swap') {
        whereConditions.push(eq(items.isSwappable, true));
      }

      // Query only items within the bounding box (dramatically reduces data)
      const boundedItems = await db.query.items.findMany({
        where: and(...whereConditions),
        with: {
          owner: {
            columns: {
              id: true,
              username: true,
              isVerified: true,
              reputationLevel: true,
              accountStatus: true,
            }
          }
        }
      });

      // Filter out items from deactivated users (defense in depth)
      const activeItems = boundedItems.filter(
        (item) => (item.owner as any)?.accountStatus !== 'deactivated'
      );

      // Calculate exact distance and filter by radius
      const nearbyItems = activeItems
        .map((item) => ({
          ...item,
          distance: calculateDistance(
            userLat,
            userLon,
            Number(item.latitude),
            Number(item.longitude),
          ),
        }))
        .filter((item) => item.distance <= radiusKm)
        .sort((a, b) => {
          // Verified users get slight priority boost
          const aVerified = a.owner?.isVerified ? 1 : 0;
          const bVerified = b.owner?.isVerified ? 1 : 0;
          if (bVerified !== aVerified) return bVerified - aVerified;
          // Then sort by distance
          return a.distance - b.distance;
        });

      res.json(nearbyItems);
    } catch (error) {
      console.error("Error fetching nearby items:", error);
      res.status(500).json({ error: "Failed to fetch nearby items" });
    }
  });

  // Get all available items (fallback if no location)
  app.get("/api/items", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { type } = req.query; // Add type filter (rent, borrow, swap, gift)
      
      const now = new Date();
      // Show items that are available OR currently out with a neighbour (active handoff).
      // Currently-out items appear with browsing allowed but requests disabled — users
      // can subscribe to be notified when the item returns.
      const activeHandoffStatuses = [
        'ACCEPTED','IN_PROGRESS','HANDOFF_CONFIRMED','DEPOSIT_CONFIRMED',
        'AWAITING_HANDOFF_CONFIRM','HANDOFF_DISPUTED','DISPUTED',
      ];
      let whereConditions = [
        or(
          eq(items.isAvailable, true),
          sql`EXISTS (
            SELECT 1 FROM item_requests ir
            WHERE ir.item_id = ${items.id}
            AND ir.status = ANY(ARRAY[${sql.raw(activeHandoffStatuses.map(s => `'${s}'`).join(','))}])
          )`
        )!,
        eq(items.isDeleted, false),
        eq(items.isSwapped, false),
        // Exclude expired listings (null = no expiry, for legacy items)
        or(isNull(items.listingExpiresAt), gte(items.listingExpiresAt, now))!,
      ];

      // Add type-specific filtering
      if (type === 'rent') {
        whereConditions.push(eq(items.isRentable, true));
      } else if (type === 'borrow') {
        whereConditions.push(eq(items.isLendable, true));
      } else if (type === 'swap') {
        whereConditions.push(eq(items.isSwappable, true));
      } else if (type === 'gift') {
        whereConditions.push(eq(items.isGift, true));
      }

      const allItems = await db.query.items.findMany({
        where: and(...whereConditions),
        orderBy: desc(items.createdAt),
        with: {
          owner: {
            columns: {
              id: true,
              username: true,
              isVerified: true,
              reputationLevel: true,
              accountStatus: true,
            }
          }
        }
      });

      // Filter out items from deactivated users (defense in depth)
      const activeItems = allItems.filter(
        (item) => (item.owner as any)?.accountStatus !== 'deactivated'
      );

      // Sort to prioritize items from verified users (slight boost in feed priority)
      const sortedItems = activeItems.sort((a, b) => {
        // Verified users get priority
        const aVerified = a.owner?.isVerified ? 1 : 0;
        const bVerified = b.owner?.isVerified ? 1 : 0;
        if (bVerified !== aVerified) return bVerified - aVerified;
        // Then sort by creation date
        return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime();
      });

      res.json(sortedItems);
    } catch (error) {
      console.error("Error fetching items:", error);
      res.status(500).json({ error: "Failed to fetch items" });
    }
  });

  app.get("/api/my-items", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const userItems = await db
        .select()
        .from(items)
        .where(and(eq(items.ownerId, req.user.id), eq(items.isDeleted, false)))
        .orderBy(desc(items.createdAt));

      if (userItems.length === 0) {
        return res.json([]);
      }

      // Fetch most-relevant request per item (for grouped status derivation on the client)
      const itemIds = userItems.map((i) => i.id);
      const STATUS_PRIORITY: Record<string, number> = {
        HANDOFF_DISPUTED: 10, DISPUTED: 9,
        IN_PROGRESS: 8, HANDOFF_CONFIRMED: 7,
        DEPOSIT_CONFIRMED: 6, AWAITING_HANDOFF_CONFIRM: 4,
        ACCEPTED: 3, PENDING: 2,
        COMPLETED_EARLY: 1, COMPLETED: 0,
      };
      const allRequests = await db.query.itemRequests.findMany({
        where: and(
          inArray(itemRequests.itemId, itemIds),
          notInArray(itemRequests.status, ["CANCELLED", "REJECTED"])
        ),
        columns: { id: true, itemId: true, status: true, requestType: true, startDate: true, endDate: true },
      });
      const requestMap = new Map<number, typeof allRequests[0]>();
      for (const req of allRequests) {
        const curr = requestMap.get(req.itemId);
        const newPri = STATUS_PRIORITY[req.status] ?? -1;
        const oldPri = curr ? (STATUS_PRIORITY[curr.status] ?? -1) : -2;
        if (newPri > oldPri) requestMap.set(req.itemId, req);
      }

      const enriched = userItems.map((item) => ({
        ...item,
        activeRequest: requestMap.get(item.id) ?? null,
      }));

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching user items:", error);
      res.status(500).json({ error: "Failed to fetch your items" });
    }
  });

  // Add recommendations endpoint
  app.get("/api/recommendations", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const recommendations = await recommendationEngine.getRecommendations(req.user.id, limit);
      res.json(recommendations);
    } catch (error) {
      console.error("Error getting recommendations:", error);
      res.status(500).json({ error: "Failed to get recommendations" });
    }
  });

  // Get seasonal recommendations
  app.get("/api/recommendations/seasonal", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const limit = parseInt(req.query.limit as string) || 8;
      const seasonalRecs = await recommendationEngine.getSeasonalRecommendations(req.user.id, limit);
      res.json(seasonalRecs);
    } catch (error) {
      console.error("Error getting seasonal recommendations:", error);
      res.status(500).json({ error: "Failed to get seasonal recommendations" });
    }
  });

  // Wishlist endpoints
  app.get("/api/wishlists", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Get all active wishlists with user info
      const allWishlists = await db
        .select({
          id: wishlists.id,
          userId: wishlists.userId,
          itemName: wishlists.itemName,
          description: wishlists.description,
          category: wishlists.category,
          needType: wishlists.needType,
          maxShareCoinPrice: wishlists.maxShareCoinPrice,
          maxDollarPrice: wishlists.maxDollarPrice,
          preferredLocation: wishlists.preferredLocation,
          neededDate: wishlists.neededDate,
          returnDate: wishlists.returnDate,
          urgency: wishlists.urgency,
          isActive: wishlists.isActive,
          createdAt: wishlists.createdAt,
          username: users.username,
          handle: users.handle,
          displayName: users.displayName,
          isVerified: users.isVerified,
          reputationLevel: users.reputationLevel,
        })
        .from(wishlists)
        .innerJoin(users, eq(users.id, wishlists.userId))
        .where(and(eq(wishlists.isActive, true), ne(wishlists.userId, (req.user as any).id)))
        .orderBy(desc(wishlists.createdAt));

      // For urgent wishlists, highlight verified users and calculate expired status
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const wishlistsWithHighlight = allWishlists.map(w => {
        // Check if wishlist is expired based on returnDate or neededDate
        let isExpired = false;
        if (w.returnDate) {
          isExpired = new Date(w.returnDate) < today;
        } else if (w.neededDate) {
          isExpired = new Date(w.neededDate) < today;
        }

        const { username, handle, displayName, isVerified, reputationLevel, ...rest } = w;
        
        return {
          ...rest,
          isExpired,
          // Verified users are highlighted in urgent wishlists
          highlightVerified: (w.urgency === 'urgent' || w.urgency === 'high') && w.isVerified,
          user: {
            id: w.userId,
            username,
            handle,
            displayName,
            isVerified,
            reputationLevel,
          },
        };
      });

      // Sort: urgent first, then verified users, then by date
      const sortedWishlists = wishlistsWithHighlight.sort((a, b) => {
        const urgencyOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
        const aUrgency = urgencyOrder[a.urgency || 'normal'] ?? 2;
        const bUrgency = urgencyOrder[b.urgency || 'normal'] ?? 2;
        if (aUrgency !== bUrgency) return aUrgency - bUrgency;
        // Within same urgency, verified users first
        if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
        // Then by date
        return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime();
      });

      res.json(sortedWishlists);
    } catch (error) {
      console.error("Error fetching wishlists:", error);
      res.status(500).json({ error: "Failed to fetch wishlists" });
    }
  });

  // Create wishlist from an existing item (looks up name/category server-side)
  app.post("/api/wishlists/from-item", requireEmailVerified, csrfProtection, async (req: any, res) => {
    try {
      const { itemId } = req.body;
      if (!itemId) return res.status(400).json({ error: "itemId is required" });

      const [found] = await db.select().from(items).where(eq(items.id, Number(itemId))).limit(1);
      if (!found) return res.status(404).json({ error: "Item not found" });

      const [newWishlist] = await db
        .insert(wishlists)
        .values({
          userId: req.user.id,
          itemName: found.name,
          category: found.category ?? undefined,
          needType: "borrow",
        })
        .returning();

      res.status(201).json(newWishlist);
    } catch (error) {
      console.error("Error creating wishlist from item:", error);
      res.status(500).json({ error: "Failed to add to wishlist" });
    }
  });

  // Create wishlist item
  app.post("/api/wishlists", requireEmailVerified, async (req: any, res) => {
    try {
      const { itemName, description, category, needType, maxShareCoinPrice, maxDollarPrice, preferredLocation, neededDate, returnDate, urgency, isPrivate } = req.body;

      if (!itemName) {
        return res.status(400).json({ error: "Item name is required" });
      }

      const [newWishlist] = await db
        .insert(wishlists)
        .values({
          userId: req.user.id,
          itemName,
          description,
          category,
          needType: needType || 'borrow',
          maxShareCoinPrice,
          maxDollarPrice,
          preferredLocation,
          neededDate: neededDate || null,
          returnDate: returnDate || null,
          urgency: urgency || 'normal',
          isPrivate: isPrivate ?? false,
        })
        .returning();

      res.status(201).json(newWishlist);
    } catch (error) {
      console.error("Error creating wishlist:", error);
      res.status(500).json({ error: "Failed to create wishlist item" });
    }
  });

  // Update wishlist item
  app.patch("/api/wishlists/:id", requireEmailVerified, async (req: any, res) => {
    try {
      const wishlistId = parseInt(req.params.id);
      if (isNaN(wishlistId)) {
        return res.status(400).json({ error: "Invalid wishlist ID" });
      }

      // Check ownership
      const [existing] = await db
        .select()
        .from(wishlists)
        .where(and(eq(wishlists.id, wishlistId), eq(wishlists.userId, req.user.id)));

      if (!existing) {
        return res.status(404).json({ error: "Wishlist item not found" });
      }

      const { itemName, description, category, needType, maxShareCoinPrice, maxDollarPrice, preferredLocation, neededDate, returnDate, urgency, isPrivate } = req.body;

      const [updated] = await db
        .update(wishlists)
        .set({
          itemName: itemName ?? existing.itemName,
          description: description ?? existing.description,
          category: category ?? existing.category,
          needType: needType ?? existing.needType,
          maxShareCoinPrice: maxShareCoinPrice !== undefined ? maxShareCoinPrice : existing.maxShareCoinPrice,
          maxDollarPrice: maxDollarPrice !== undefined ? maxDollarPrice : existing.maxDollarPrice,
          preferredLocation: preferredLocation ?? existing.preferredLocation,
          neededDate: neededDate !== undefined ? neededDate : existing.neededDate,
          returnDate: returnDate !== undefined ? returnDate : existing.returnDate,
          urgency: urgency ?? existing.urgency,
          isPrivate: isPrivate !== undefined ? isPrivate : existing.isPrivate,
        })
        .where(eq(wishlists.id, wishlistId))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Error updating wishlist:", error);
      res.status(500).json({ error: "Failed to update wishlist item" });
    }
  });

  // Delete wishlist item
  app.delete("/api/wishlists/:id", async (req: any, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Please sign in to continue" });
    }
    try {
      const wishlistId = parseInt(req.params.id);
      if (isNaN(wishlistId)) {
        return res.status(400).json({ error: "Invalid wishlist ID" });
      }

      // Check ownership
      const [existing] = await db
        .select()
        .from(wishlists)
        .where(and(eq(wishlists.id, wishlistId), eq(wishlists.userId, req.user.id)));

      if (!existing) {
        return res.status(404).json({ error: "Wishlist item not found" });
      }

      await db.delete(wishlists).where(eq(wishlists.id, wishlistId));

      res.json({ success: true, message: "Wishlist item deleted" });
    } catch (error) {
      console.error("Error deleting wishlist:", error);
      res.status(500).json({ error: "Failed to delete wishlist item" });
    }
  });

  // Get my wishlists
  app.get("/api/my-wishlists", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const myWishlists = await db
        .select()
        .from(wishlists)
        .where(eq(wishlists.userId, req.user.id))
        .orderBy(desc(wishlists.createdAt));

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const withExpiry = myWishlists.map(w => {
        let isExpired = false;
        if (w.returnDate) {
          isExpired = new Date(w.returnDate) < today;
        } else if (w.neededDate) {
          isExpired = new Date(w.neededDate) < today;
        }
        return { ...w, isExpired };
      });

      res.json(withExpiry);
    } catch (error) {
      console.error("Error fetching my wishlists:", error);
      res.status(500).json({ error: "Failed to fetch your wishlists" });
    }
  });

  // Notify wishlist owner about a matching item
  app.post("/api/wishlist-match-notification", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { itemId, wishlistId, wishlistOwnerId } = req.body;

      if (!itemId || !wishlistId || !wishlistOwnerId) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Get the item details
      const [item] = await db
        .select()
        .from(items)
        .where(eq(items.id, itemId));

      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }

      // Get the lister's display name
      const [lister] = await db
        .select({ displayName: users.displayName, username: users.username })
        .from(users)
        .where(eq(users.id, req.user.id));

      const listerName = lister?.displayName || lister?.username || "A neighbour";

      // Create notification for the wishlist owner
      await db.insert(notifications).values({
        userId: wishlistOwnerId,
        type: "wishlist_match",
        title: "New Match For Your Wishlist",
        message: `"${item.name.length > 22 ? item.name.slice(0, 22) + "…" : item.name}" listed by ${listerName}`,
        itemId: itemId,
        isRead: false,
      });

      console.log(`📣 Wishlist match notification sent to user ${wishlistOwnerId} for item "${item.name}"`);

      res.json({ 
        success: true, 
        message: "Notification sent to wishlist owner",
        listerName: listerName
      });
    } catch (error) {
      console.error("Error sending wishlist match notification:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

  // Wishlist Offers — record that a user has offered to help with a community wishlist item
  app.post("/api/wishlist-offers", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const { wishlistId } = req.body;
    if (!wishlistId || isNaN(parseInt(wishlistId))) {
      return res.status(400).json({ error: "wishlistId required" });
    }
    try {
      await db.insert(wishlistOffers)
        .values({ userId: req.user.id, wishlistId: parseInt(wishlistId) })
        .onConflictDoNothing();
      res.json({ ok: true });
    } catch (error) {
      console.error("Error creating wishlist offer:", error);
      res.status(500).json({ error: "Failed to record offer" });
    }
  });

  // Return all wishlist IDs the current user has offered to help with
  app.get("/api/wishlist-offers/mine", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const rows = await db
        .select({ wishlistId: wishlistOffers.wishlistId })
        .from(wishlistOffers)
        .where(eq(wishlistOffers.userId, req.user.id));
      res.json(rows.map((r) => r.wishlistId));
    } catch (error) {
      console.error("Error fetching wishlist offers:", error);
      res.status(500).json({ error: "Failed to fetch offers" });
    }
  });

  // Smart swap matching
  app.get("/api/swap-matches/:requestId/:userItemId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      const userItemId = parseInt(req.params.userItemId);
      
      if (isNaN(requestId) || isNaN(userItemId)) {
        return res.status(400).json({ error: "Invalid request or item ID" });
      }

      const matches = await recommendationEngine.findSwapMatches(requestId, userItemId);
      res.json(matches);
    } catch (error) {
      console.error("Error finding swap matches:", error);
      res.status(500).json({ error: "Failed to find swap matches" });
    }
  });

  // Location alerts management
  app.post("/api/location-alerts", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { keywords, latitude, longitude, radius } = req.body;
      
      if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
        return res.status(400).json({ error: "Keywords are required" });
      }

      const [alert] = await db
        .insert(locationAlerts)
        .values({
          userId: req.user.id,
          keywords,
          latitude: latitude ? String(latitude) : null,
          longitude: longitude ? String(longitude) : null,
          radius: radius || 10,
          isActive: true,
        })
        .returning();

      res.status(201).json(alert);
    } catch (error) {
      console.error("Error creating location alert:", error);
      res.status(500).json({ error: "Failed to create location alert" });
    }
  });

  app.get("/api/location-alerts", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const alerts = await db
        .select()
        .from(locationAlerts)
        .where(eq(locationAlerts.userId, req.user.id))
        .orderBy(desc(locationAlerts.createdAt));

      res.json(alerts);
    } catch (error) {
      console.error("Error fetching location alerts:", error);
      res.status(500).json({ error: "Failed to fetch location alerts" });
    }
  });

  // Enhanced delivery arrangements with security deposit options
  // Add GET route for single item (MUST come after specific routes)
  // Renew a listing for another 30 days
  app.post("/api/items/:itemId/relist", requireEmailVerified, csrfProtection, async (req: any, res) => {
    const itemId = parseInt(req.params.itemId);
    if (isNaN(itemId)) return res.status(400).json({ error: "Invalid item ID" });

    try {
      const [item] = await db.select({ ownerId: items.ownerId }).from(items).where(eq(items.id, itemId)).limit(1);
      if (!item) return res.status(404).json({ error: "Item not found" });
      if (item.ownerId !== req.user.id) return res.status(403).json({ error: "Not your item" });

      const { availableToDate } = req.body as { availableToDate?: string };
      const newExpiry = availableToDate
        ? new Date(availableToDate)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db.update(items)
        .set({ isAvailable: true, listingExpiresAt: newExpiry, updatedAt: new Date() })
        .where(eq(items.id, itemId));

      res.json({ success: true, listingExpiresAt: newExpiry.toISOString() });
    } catch (err) {
      console.error("Error relisting item:", err);
      res.status(500).json({ error: "Failed to relist item" });
    }
  });

  // Returns active booking windows for an item so the request form can block those dates
  app.get("/api/items/:itemId/booked-dates", async (req, res) => {
    const itemId = parseInt(req.params.itemId);
    if (isNaN(itemId)) return res.status(400).json({ error: "Invalid item ID" });

    try {
      const activeStatuses = [
        "ACCEPTED",
        "DEPOSIT_CONFIRMED",
        "AWAITING_HANDOFF_CONFIRM",
        "IN_PROGRESS",
      ];

      const bookings = await db
        .select({
          startDate: itemRequests.startDate,
          endDate: itemRequests.endDate,
          counterStartDate: itemRequests.counterStartDate,
          counterEndDate: itemRequests.counterEndDate,
          negotiationStatus: itemRequests.negotiationStatus,
        })
        .from(itemRequests)
        .where(
          and(
            eq(itemRequests.itemId, itemId),
            inArray(itemRequests.status, activeStatuses),
          )
        );

      const result = bookings
        .map((b) => {
          // Use counter dates when a counter is pending, otherwise use committed dates
          const start = b.negotiationStatus === "counter_proposed"
            ? (b.counterStartDate ?? b.startDate)
            : b.startDate;
          const end = b.negotiationStatus === "counter_proposed"
            ? (b.counterEndDate ?? b.endDate)
            : b.endDate;
          if (!start || !end) return null;
          return {
            startDate: start instanceof Date ? start.toISOString().split("T")[0] : String(start).split("T")[0],
            endDate:   end   instanceof Date ? end.toISOString().split("T")[0]   : String(end).split("T")[0],
          };
        })
        .filter(Boolean);

      res.json(result);
    } catch (err) {
      console.error("Error fetching booked dates:", err);
      res.status(500).json({ error: "Failed to fetch booked dates" });
    }
  });

  app.get("/api/items/:id", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      return res.status(400).json({ error: "Invalid item ID" });
    }

    const [itemWithOwner] = await db
      .select({
        id: items.id,
        name: items.name,
        description: items.description,
        category: items.category,
        brand: items.brand,
        conditionRating: items.conditionRating,
        photos: items.photos,
        city: items.city,
        state: items.state,
        country: items.country,
        address: items.address,
        latitude: items.latitude,
        longitude: items.longitude,
        isLendable: items.isLendable,
        isRentable: items.isRentable,
        isSwappable: items.isSwappable,
        lendingDuration: items.lendingDuration,
        shareCoinsReward: items.shareCoinsReward,
        shareCoinPrice: items.shareCoinPrice,
        dollarsPrice: items.dollarsPrice,
        estimatedValue: items.estimatedValue,
        isAvailable: items.isAvailable,
        isConditionVerified: items.isConditionVerified,
        wasSmartScanned: items.wasSmartScanned,
        securityDeposit: items.securityDeposit,
        replacementValue: items.replacementValue,
        isGift: items.isGift,
        ownerId: items.ownerId,
        createdAt: items.createdAt,
        itemType: items.itemType,
        condition: items.condition,
        originalValue: items.originalValue,
        tier: items.tier,
        swapDesiredItem: items.swapDesiredItem,
        swapNotifyOnMatch: items.swapNotifyOnMatch,
        updatedAt: items.updatedAt,
        owner: {
          id: users.id,
          username: users.username,
          handle: users.handle,
          displayName: users.displayName,
          isVerified: users.isVerified,
          isPremium: users.isPremium,
          reputationLevel: users.reputationLevel,
        },
      })
      .from(items)
      .innerJoin(users, eq(users.id, items.ownerId))
      .where(eq(items.id, itemId))
      .limit(1);

    if (!itemWithOwner) {
      return res.status(404).send("Item not found");
    }

    // Attach isCurrentlyOut — true when item is committed to a neighbour (ACCEPTED or physically out)
    const activeHandoffSt = ['ACCEPTED','IN_PROGRESS','HANDOFF_CONFIRMED','DEPOSIT_CONFIRMED','AWAITING_HANDOFF_CONFIRM','HANDOFF_DISPUTED','DISPUTED'];
    const activeReq = await db.select({ id: itemRequests.id, endDate: itemRequests.endDate, counterEndDate: itemRequests.counterEndDate, requestType: itemRequests.requestType }).from(itemRequests)
      .where(and(eq(itemRequests.itemId, itemId), sql`${itemRequests.status} = ANY(ARRAY[${sql.raw(activeHandoffSt.map(s=>`'${s}'`).join(','))}])`))
      .limit(1);
    const isCurrentlyOut = activeReq.length > 0;
    // Use counter-proposed end date if set (negotiated terms), falling back to original end date
    const activeRequestEndDate: string | null = (activeReq[0]?.counterEndDate ?? activeReq[0]?.endDate as any) ?? null;

    // Cooldown check: did this user get declined on this item within the last 7 days,
    // and has the listing NOT been updated since?
    let isCooldownActive = false;
    let cooldownExpiresAt: Date | null = null;
    if (req.isAuthenticated() && (req as any).user?.id && (req as any).user.id !== itemWithOwner.ownerId) {
      const cooldownWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [recentDecline] = await db
        .select({ id: itemRequests.id, createdAt: itemRequests.createdAt })
        .from(itemRequests)
        .where(and(
          eq(itemRequests.itemId, itemId),
          eq(itemRequests.requesterId, (req as any).user.id),
          eq(itemRequests.status, "DECLINED"),
          gte(itemRequests.createdAt, cooldownWindow)
        ))
        .orderBy(desc(itemRequests.createdAt))
        .limit(1);

      if (recentDecline) {
        const itemUpdatedAt = itemWithOwner.updatedAt;
        const wasReset = itemUpdatedAt && itemUpdatedAt > recentDecline.createdAt;
        if (!wasReset) {
          isCooldownActive = true;
          cooldownExpiresAt = new Date(recentDecline.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
      }
    }

    // Check if item was permanently passed on via a completed GIFT or SWAP
    const [passedOnReq] = await db
      .select({ requestType: itemRequests.requestType })
      .from(itemRequests)
      .where(and(
        eq(itemRequests.itemId, itemId),
        inArray(itemRequests.status, ["COMPLETED", "COMPLETED_EARLY"]),
        inArray(itemRequests.requestType, ["GIFT", "SWAP"]),
      ))
      .limit(1);
    const isPassedOn = !!passedOnReq;

    res.json({ ...itemWithOwner, isCurrentlyOut, activeRequestEndDate, isCooldownActive, cooldownExpiresAt, isPassedOn });
  });

  // ── Availability notification subscriptions ────────────────────────────────

  // Get all item IDs the current user is subscribed to (bulk)
  app.get("/api/items/my-subscriptions", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.json({ itemIds: [] });
    const rows = await db
      .select({ itemId: itemAvailabilitySubscribers.itemId })
      .from(itemAvailabilitySubscribers)
      .where(eq(itemAvailabilitySubscribers.userId, req.user.id));
    res.json({ itemIds: rows.map(r => r.itemId) });
  });

  // Get full item data for all subscribed items (regardless of availability)
  // Used on browse page to show "Currently Out" badges for watched items
  app.get("/api/items/my-subscribed-items", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.json([]);
    const rows = await db
      .select({
        id: items.id,
        name: items.name,
        photos: items.photos,
        isAvailable: items.isAvailable,
        isGift: items.isGift,
        city: items.city,
        conditionRating: items.conditionRating,
        isLendable: items.isLendable,
        isSwappable: items.isSwappable,
        isRentable: items.isRentable,
      })
      .from(itemAvailabilitySubscribers)
      .innerJoin(items, eq(items.id, itemAvailabilitySubscribers.itemId))
      .where(
        and(
          eq(itemAvailabilitySubscribers.userId, req.user.id),
          eq(items.isAvailable, false),
          eq(items.isDeleted, false),
        )
      );
    res.json(rows);
  });

  // Check if current user is subscribed
  app.get("/api/items/:itemId/notify-me", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const itemId = parseInt(req.params.itemId);
    const [sub] = await db.select({ id: itemAvailabilitySubscribers.id })
      .from(itemAvailabilitySubscribers)
      .where(and(eq(itemAvailabilitySubscribers.itemId, itemId), eq(itemAvailabilitySubscribers.userId, req.user.id)))
      .limit(1);
    res.json({ subscribed: !!sub });
  });

  // Subscribe
  app.post("/api/items/:itemId/notify-me", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const itemId = parseInt(req.params.itemId);
    await db.insert(itemAvailabilitySubscribers)
      .values({ itemId, userId: req.user.id })
      .onConflictDoNothing();
    res.json({ subscribed: true });
  });

  // Unsubscribe
  app.delete("/api/items/:itemId/notify-me", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const itemId = parseInt(req.params.itemId);
    await db.delete(itemAvailabilitySubscribers)
      .where(and(eq(itemAvailabilitySubscribers.itemId, itemId), eq(itemAvailabilitySubscribers.userId, req.user.id)));
    res.json({ subscribed: false });
  });

  // Item condition verification endpoints
  app.post(
    "/api/items/:itemId/verify-condition",
    upload.array("photos"),
    async (req, res) => {
      if (!req.isAuthenticated()) {
        return res.sendStatus(401);
      }

      // TODO: Add admin check here
      const itemId = parseInt(req.params.itemId);
      const files = req.files as Express.Multer.File[];
      const photoUrls = files
        ? files.map((file) => `/uploads/${file.filename}`)
        : [];

      const [verification] = await db
        .insert(itemConditionVerifications)
        .values({
          itemId: itemId,
          verifierId: req.user.id,
          actualConditionRating: parseInt(req.body.actualConditionRating),
          notes: req.body.notes,
          photos: photoUrls,
          status: req.body.status,
        })
        .returning();

      if (req.body.status === "approved") {
        await db
          .update(items)
          .set({
            isConditionVerified: true,
            conditionRating: parseInt(req.body.actualConditionRating),
          })
          .where(eq(items.id, itemId));
      }

      res.status(201).json(verification);
    },
  );

  app.get("/api/items/:itemId/verifications", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const itemId = parseInt(req.params.itemId);
    const verifications = await db
      .select({
        id: itemConditionVerifications.id,
        actualConditionRating: itemConditionVerifications.actualConditionRating,
        notes: itemConditionVerifications.notes,
        photos: itemConditionVerifications.photos,
        status: itemConditionVerifications.status,
        createdAt: itemConditionVerifications.createdAt,
        verifierName: users.username,
      })
      .from(itemConditionVerifications)
      .innerJoin(users, eq(users.id, itemConditionVerifications.verifierId))
      .where(eq(itemConditionVerifications.itemId, itemId))
      .orderBy(itemConditionVerifications.createdAt);

    res.json(verifications);
  });

  // Chat API endpoints
  app.post("/api/messages", requireEmailVerified, async (req: any, res) => {
    const { receiverId, content, requestId } = req.body;
    const parsedRequestId = requestId ? parseInt(requestId) : null;

    const [message] = await db
      .insert(messages)
      .values({
        senderId: req.user.id,
        receiverId,
        content,
        requestId: parsedRequestId,
      })
      .returning();

    // Auto-unarchive: if this message belongs to a completed/cancelled/declined thread,
    // record the unarchive timestamp so the thread resurfaces in the active inbox.
    if (parsedRequestId) {
      const ARCHIVED_STATUSES = ["COMPLETED", "COMPLETED_EARLY", "CANCELLED", "DECLINED"];
      const [reqRow] = await db
        .select({ status: itemRequests.status })
        .from(itemRequests)
        .where(eq(itemRequests.id, parsedRequestId));
      if (reqRow && ARCHIVED_STATUSES.includes(reqRow.status)) {
        await db
          .update(itemRequests)
          .set({ unarchivedAt: new Date() })
          .where(eq(itemRequests.id, parsedRequestId));
      }
    }

    // Push to recipient in real-time if they are connected via WebSocket
    const receiverWs = connectedClients.get(receiverId);
    if (receiverWs?.readyState === WebSocket.OPEN) {
      receiverWs.send(JSON.stringify({ type: "new_message", message }));
    }

    // Native push notification so the message arrives even when the app is closed
    sendPushToUser(receiverId, {
      title: "New Message",
      body: content.length > 120 ? content.slice(0, 120) + "…" : content,
      data: { screen: "chat", chatUserId: req.user.id },
    }, "messages").catch(() => {});

    res.status(201).json(message);
  });

  app.get("/api/messages/:userId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const partnerId = parseInt(req.params.userId);
    const requestId = req.query.requestId ? parseInt(req.query.requestId as string) : null;

    const pairCondition = or(
      and(
        eq(messages.senderId, req.user.id),
        eq(messages.receiverId, partnerId),
      ),
      and(
        eq(messages.senderId, partnerId),
        eq(messages.receiverId, req.user.id),
      ),
    );

    let whereClause;
    if (requestId) {
      // Show only messages for this specific request
      whereClause = and(pairCondition, eq(messages.requestId, requestId));
    } else {
      // No request context — show messages with no requestId (pure chat)
      whereClause = and(pairCondition, sql`${messages.requestId} IS NULL`);
    }

    const chatMessages = await db
      .select()
      .from(messages)
      .where(whereClause)
      .orderBy(messages.createdAt);

    res.json(chatMessages);
  });

  app.post("/api/messages/mark-read/:partnerId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const partnerId = parseInt(req.params.partnerId);
    if (isNaN(partnerId)) {
      return res.status(400).json({ error: "Invalid partner ID" });
    }

    const requestId = req.body?.requestId ? parseInt(req.body.requestId) : null;

    try {
      const baseWhere = and(
        eq(messages.senderId, partnerId),
        eq(messages.receiverId, req.user.id),
        eq(messages.isRead, false)
      );
      // If a requestId is provided, scope to that thread only
      const whereClause = requestId
        ? and(baseWhere, eq(messages.requestId, requestId))
        : baseWhere;

      await db.update(messages).set({ isRead: true }).where(whereClause);
      // Request notifications and inbox activity describe the same lifecycle
      // event. Opening a request thread should clear both alerts together.
      if (requestId) {
        await db
          .update(notifications)
          .set({ isRead: true })
          .where(
            and(
              eq(notifications.userId, req.user.id),
              eq(notifications.requestId, requestId),
              eq(notifications.isRead, false),
            ),
          );
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking messages as read:", error);
      res.status(500).json({ error: "Failed to mark messages as read" });
    }
  });

  // Public profile for any user (for chat headers, trust info)
  app.get("/api/users/:id/public-profile", async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: "Invalid user id" });

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        handle: users.handle,
        displayName: users.displayName,
        profilePhoto: users.profilePhoto,
        isVerified: users.isVerified,
        reputationScore: users.reputationScore,
        lastActiveAt: users.lastActiveAt,
        bio: users.bio,
        location: users.location,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, targetId));

    if (!user) return res.status(404).json({ error: "User not found" });

    // Run all stats queries in parallel
    const [
      reviews,
      completedSharesResult,
      completedBorrows,
      uniqueSenders,
      uniqueRecipients,
      issuesResult,
      activeStatus,
      responseTime,
      referralCountResult,
      lateTaggedTransactions,
      last10ReviewsReceived,
    ] = await Promise.all([
      db.select({ rating: userReviews.rating }).from(userReviews).where(eq(userReviews.reviewedUserId, targetId)),
      db.select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .innerJoin(items, eq(itemRequests.itemId, items.id))
        .where(and(
          or(eq(itemRequests.requesterId, targetId), sql`${items.ownerId} = ${targetId}`),
          or(eq(itemRequests.status, 'COMPLETED'), eq(itemRequests.status, 'COMPLETED_EARLY'))
        )),
      // Include id so we can cross-reference with late_return review tags
      db.select({ id: itemRequests.id, returnConfirmedAt: itemRequests.returnConfirmedAt, endDate: itemRequests.endDate })
        .from(itemRequests)
        .where(and(
          eq(itemRequests.requesterId, targetId),
          or(eq(itemRequests.status, 'COMPLETED'), eq(itemRequests.status, 'COMPLETED_EARLY')),
          isNotNull(itemRequests.endDate),
          isNotNull(itemRequests.returnConfirmedAt),
        )),
      db.selectDistinct({ senderId: messages.senderId }).from(messages).where(eq(messages.receiverId, targetId)),
      db.selectDistinct({ receiverId: messages.receiverId }).from(messages).where(eq(messages.senderId, targetId)),
      db.select({ count: sql<number>`count(*)` })
        .from(rentalReturns)
        .where(and(
          or(eq(rentalReturns.renterId, targetId), eq(rentalReturns.ownerId, targetId)),
          or(eq(rentalReturns.status, 'DAMAGED'), eq(rentalReturns.status, 'LOST'))
        )),
      computeActiveStatusFromDb(targetId, user.lastActiveAt ?? null),
      computeResponseTime(targetId),
      db.select({ count: sql<number>`count(*)` }).from(referrals).where(and(eq(referrals.referrerId, targetId), eq(referrals.isRewardClaimed, true))),
      // Transactions where a late_return tag was left for this user as borrower
      db.select({ transactionId: userReviews.transactionId })
        .from(userReviews)
        .where(and(
          eq(userReviews.reviewedUserId, targetId),
          sql`'late_return' = ANY(${userReviews.feedbackTags})`,
          isNotNull(userReviews.transactionId),
        )),
      // Last 10 reviews received — for "Frequently late" flag
      db.select({ feedbackTags: userReviews.feedbackTags })
        .from(userReviews)
        .where(eq(userReviews.reviewedUserId, targetId))
        .orderBy(desc(userReviews.createdAt))
        .limit(10),
    ]);

    const reviewCount = reviews.length;
    const averageRating = reviewCount > 0
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviewCount) * 10) / 10
      : null;
    const completedShares = Number(completedSharesResult[0]?.count ?? 0);
    const referralCount = Number(referralCountResult[0]?.count ?? 0);

    // On-time return rate (as borrower)
    // A borrow is considered late if the date was overdue OR a reviewer left a late_return tag
    const lateTaggedIds = new Set(lateTaggedTransactions.map(r => r.transactionId).filter(Boolean));
    let onTimeReturnRate: number | null = null;
    if (completedBorrows.length > 0) {
      const onTime = completedBorrows.filter(r =>
        r.returnConfirmedAt! <= r.endDate! && !lateTaggedIds.has(r.id)
      ).length;
      onTimeReturnRate = Math.round((onTime / completedBorrows.length) * 100);
    }

    // "Frequently late" flag: 3+ late_return tags in the last 10 reviews received
    const frequentlyLate = last10ReviewsReceived.filter(r =>
      Array.isArray(r.feedbackTags) && r.feedbackTags.includes('late_return')
    ).length >= 3;

    // Reply rate
    const senderSet = new Set(uniqueSenders.map(s => s.senderId));
    const recipientSet = new Set(uniqueRecipients.map(r => r.receiverId));
    const repliedCount = [...senderSet].filter(id => recipientSet.has(id)).length;
    const replyRate = senderSet.size > 0 ? Math.round((repliedCount / senderSet.size) * 100) : null;

    const issuesCount = Number(issuesResult[0]?.count ?? 0);
    const trustScore = Math.min(100, user.reputationScore ?? 0);

    res.json({
      ...user,
      reviewCount,
      averageRating,
      completedShares,
      referralCount,
      onTimeReturnRate,
      frequentlyLate,
      replyRate,
      issuesCount,
      trustScore,
      activeStatus,
      responseTime,
    });
  });

  // Unified inbox: one entry per item request, sorted by most recent activity.
  // ?archived=true returns completed/cancelled/declined threads; default returns active ones.
  app.get("/api/inbox", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = req.user.id;
    const showArchived = req.query.archived === "true";

    // Statuses considered "archived" (transaction done — read-only history)
    const ARCHIVED_STATUSES = ["COMPLETED", "COMPLETED_EARLY", "CANCELLED", "DECLINED"];


    // --- Gather all item requests involving this user ---
    const allRequests = await db
      .select({
        id: itemRequests.id,
        requesterId: itemRequests.requesterId,
        ownerId: items.ownerId,
        itemName: items.name,
        itemId: itemRequests.itemId,
        itemPhotos: items.photos,
        requestType: itemRequests.requestType,
        status: itemRequests.status,
        negotiationStatus: itemRequests.negotiationStatus,
        unarchivedAt: itemRequests.unarchivedAt,
        createdAt: itemRequests.createdAt,
      })
      .from(itemRequests)
      .innerJoin(items, eq(itemRequests.itemId, items.id))
      .where(
        or(
          eq(itemRequests.requesterId, userId),
          sql`${items.ownerId} = ${userId}`
        )
      )
      .orderBy(desc(itemRequests.createdAt));

    if (allRequests.length === 0) {
      return res.json([]);
    }

    // Batch-fetch messages for ALL requests so we can compute effective archive status
    const allReqIds = allRequests.map(r => r.id);
    const allThreadMessages = allReqIds.length > 0
      ? await db
          .select({
            id: messages.id,
            senderId: messages.senderId,
            receiverId: messages.receiverId,
            content: messages.content,
            isRead: messages.isRead,
            createdAt: messages.createdAt,
            messageType: messages.messageType,
            requestId: messages.requestId,
          })
          .from(messages)
          .where(
            and(
              or(eq(messages.senderId, userId), eq(messages.receiverId, userId)),
              sql`${messages.requestId} = ANY(ARRAY[${sql.raw(allReqIds.join(','))}]::int[])`
            )
          )
          .orderBy(desc(messages.createdAt))
      : [];

    // A request notification is also inbox activity. Some request flows already
    // write a chat lifecycle event, while scheduled/system flows only create a
    // notification. Reading notification rows here ensures every request-linked
    // bell alert appears as an unread inbox alert without duplicating messages.
    const allRequestNotifications = allReqIds.length > 0
      ? await db
          .select({
            requestId: notifications.requestId,
            title: notifications.title,
            message: notifications.message,
            isRead: notifications.isRead,
            createdAt: notifications.createdAt,
          })
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, userId),
              sql`${notifications.requestId} = ANY(ARRAY[${sql.raw(allReqIds.join(','))}]::int[])`,
            ),
          )
          .orderBy(desc(notifications.createdAt))
      : [];

    // Build per-request message map (covers all requests so we can use unread for archive decisions)
    const reqMsgMap = new Map<number, { lastMsg: string; lastTime: Date; unread: number; lastSenderId: number }>();
    for (const msg of allThreadMessages) {
      const rid = msg.requestId!;
      if (!reqMsgMap.has(rid)) {
        const unread = allThreadMessages.filter(
          m => m.requestId === rid && m.senderId !== userId && m.receiverId === userId && !m.isRead
        ).length;
        reqMsgMap.set(rid, {
          lastMsg: msg.content,
          lastTime: msg.createdAt!,
          unread,
          lastSenderId: msg.senderId,
        });
      }
    }

    const reqNotificationMap = new Map<number, { lastMsg: string; lastTime: Date; unread: number }>();
    for (const notification of allRequestNotifications) {
      if (!notification.requestId) continue;
      const notificationTime = notification.createdAt ?? new Date(0);
      const existing = reqNotificationMap.get(notification.requestId);
      if (!existing) {
        reqNotificationMap.set(notification.requestId, {
          lastMsg: notification.message || notification.title,
          lastTime: notificationTime,
          unread: notification.isRead ? 0 : 1,
        });
      } else if (!notification.isRead) {
        existing.unread += 1;
      }
    }

    // Avoid double-counting actions that already have both a lifecycle message
    // and a bell notification, while still surfacing notification-only events.
    const threadUnreadCount = (requestId: number) =>
      Math.max(
        reqMsgMap.get(requestId)?.unread ?? 0,
        reqNotificationMap.get(requestId)?.unread ?? 0,
      );

    // Determine effective archive status for each request.
    // A status-archived thread surfaces in the active inbox while it has unread messages.
    // Once all messages are read, it re-archives immediately.
    const isEffectivelyArchived = (r: { status: string; unarchivedAt: Date | null }, unread: number): boolean => {
      if (!ARCHIVED_STATUSES.includes(r.status)) return false;
      if (!r.unarchivedAt) return true;
      return unread === 0; // re-archive as soon as all messages are read
    };

    // Now filter to the requested bucket
    const filteredRequests = allRequests.filter(r => {
      const unread = threadUnreadCount(r.id);
      const archived = isEffectivelyArchived(r, unread);
      return showArchived ? archived : !archived;
    });

    if (filteredRequests.length === 0) {
      return res.json([]);
    }

    // Collect unique partner IDs
    const partnerIdsSet = new Set<number>();
    for (const r of filteredRequests) {
      const pid = r.requesterId === userId ? r.ownerId : r.requesterId;
      if (pid !== null) partnerIdsSet.add(pid);
    }
    const partnerIds = Array.from(partnerIdsSet);

    // Fetch partner user details
    const partnerDetails = partnerIds.length > 0
      ? await db
          .select({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            profilePhoto: users.profilePhoto,
            isVerified: users.isVerified,
            lastActiveAt: users.lastActiveAt,
          })
          .from(users)
          .where(sql`${users.id} = ANY(ARRAY[${sql.raw(partnerIds.join(','))}]::int[])`)
      : [];
    const partnerMap = new Map(partnerDetails.map(u => [u.id, u]));

    // Compute active status + response times (parallel)
    const partnerStatResults = await Promise.all(
      partnerIds.map(async (pid) => {
        const partner = partnerMap.get(pid);
        const [activeStatus, responseTime] = await Promise.all([
          computeActiveStatusFromDb(pid, partner?.lastActiveAt ?? null),
          computeResponseTime(pid),
        ]);
        return { pid, activeStatus, responseTime };
      })
    );
    const partnerActiveStatusMap = new Map(partnerStatResults.map(r => [r.pid, r.activeStatus]));
    const partnerResponseTimeMap = new Map(partnerStatResults.map(r => [r.pid, r.responseTime]));

    // Build one inbox entry per request
    const inboxItems = filteredRequests.map((reqData) => {
      const partnerId: number = reqData.requesterId === userId ? reqData.ownerId! : reqData.requesterId;
      const partner = partnerMap.get(partnerId);
      const msgData = reqMsgMap.get(reqData.id);
      const notificationData = reqNotificationMap.get(reqData.id);

      const msgTime = msgData?.lastTime ? new Date(msgData.lastTime) : null;
      const notificationTime = notificationData?.lastTime
        ? new Date(notificationData.lastTime)
        : null;
      const reqTime = reqData.createdAt ? new Date(reqData.createdAt) : new Date(0);

      let lastActivityTime: Date;
      let preview: string;
      let previewType: "message" | "request";
      let previewSentByMe: boolean | null;

      if (
        notificationTime &&
        notificationTime >= reqTime &&
        (!msgTime || notificationTime > msgTime)
      ) {
        lastActivityTime = notificationTime;
        previewType = "message";
        preview = notificationData!.lastMsg;
        previewSentByMe = false;
      } else if (msgTime && msgTime >= reqTime) {
        lastActivityTime = msgTime;
        previewType = "message";
        preview = msgData!.lastMsg;
        previewSentByMe = msgData!.lastSenderId === userId;
      } else {
        lastActivityTime = reqTime;
        previewType = "request";
        preview = `${reqData.requestType} · ${reqData.status}`;
        previewSentByMe = null;
      }

      return {
        requestId: reqData.id,
        partnerId,
        partnerUsername: partner?.username || "Unknown",
        partnerDisplayName: partner?.displayName || null,
        partnerPhoto: partner?.profilePhoto || null,
        partnerIsVerified: partner?.isVerified || false,
        partnerLastActiveAt: partner?.lastActiveAt || null,
        partnerActiveStatus: partnerActiveStatusMap.get(partnerId) || null,
        partnerResponseTime: partnerResponseTimeMap.get(partnerId) || null,
        lastActivityTime,
        preview,
        previewType,
        previewSentByMe,
        unreadCount: threadUnreadCount(reqData.id),
        requestType: reqData.requestType,
        requestStatus: reqData.status,
        requestNegotiationStatus: reqData.negotiationStatus || null,
        itemName: reqData.itemName,
        itemId: reqData.itemId,
        itemPhoto: (reqData.itemPhotos as string[] | null)?.[0] ?? null,
        iAmRequester: reqData.requesterId === userId,
        isArchived: isEffectivelyArchived(reqData, threadUnreadCount(reqData.id)),
      };
    });

    // Sort by most recent activity (newest first)
    inboxItems.sort((a, b) => b.lastActivityTime.getTime() - a.lastActivityTime.getTime());

    res.json(inboxItems);
  });

  // Get all conversations for the current user
  app.get("/api/conversations", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    // Get all messages involving the current user
    // Use explicit column selection to avoid issues with jsonb columns in wildcard select
    const allMessages = await db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        receiverId: messages.receiverId,
        content: messages.content,
        isRead: messages.isRead,
        createdAt: messages.createdAt,
        messageType: messages.messageType,
      })
      .from(messages)
      .where(
        or(
          eq(messages.senderId, req.user.id),
          eq(messages.receiverId, req.user.id)
        )
      )
      .orderBy(desc(messages.createdAt));

    // Group by conversation partner
    const conversationMap = new Map<number, {
      lastMessage: string;
      lastMessageTime: Date;
      unreadCount: number;
    }>();

    for (const msg of allMessages) {
      const partnerId = msg.senderId === req.user.id ? msg.receiverId : msg.senderId;
      
      if (!conversationMap.has(partnerId)) {
        const unread = allMessages.filter(
          m => m.senderId === partnerId && m.receiverId === req.user.id && !m.isRead
        ).length;

        conversationMap.set(partnerId, {
          lastMessage: msg.content,
          lastMessageTime: msg.createdAt!,
          unreadCount: unread,
        });
      }
    }

    // Get user details and transaction types for each conversation
    const conversations = await Promise.all(
      Array.from(conversationMap.entries()).map(async ([partnerId, data]) => {
        // Get user details
        const [otherUser] = await db
          .select({
            id: users.id,
            username: users.username,
          })
          .from(users)
          .where(eq(users.id, partnerId));

        // Try to find related item request to determine transaction type
        const relatedRequests = await db
          .select({
            requestType: itemRequests.requestType,
            itemName: items.name,
          })
          .from(itemRequests)
          .innerJoin(items, eq(itemRequests.itemId, items.id))
          .where(
            or(
              and(
                eq(itemRequests.requesterId, partnerId),
                eq(items.ownerId, req.user.id)
              ),
              and(
                eq(itemRequests.requesterId, req.user.id),
                eq(items.ownerId, partnerId)
              )
            )
          )
          .orderBy(desc(itemRequests.createdAt))
          .limit(1);

        return {
          userId: partnerId,
          username: otherUser?.username || 'Unknown',
          lastMessage: data.lastMessage,
          lastMessageTime: data.lastMessageTime,
          unreadCount: data.unreadCount,
          transactionType: relatedRequests[0]?.requestType || null,
          itemName: relatedRequests[0]?.itemName || null,
        };
      })
    );

    // Sort by most recent message
    conversations.sort((a, b) => 
      new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
    );

    res.json(conversations);
  });

  // ShareCoins transaction endpoints
  app.get("/api/transactions", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const transactions = await db
      .select()
      .from(shareCoinsTransactions)
      .where(eq(shareCoinsTransactions.userId, req.user.id))
      .orderBy(desc(shareCoinsTransactions.createdAt));

    res.json(transactions);
  });

  // Game reward endpoint
  app.post("/api/transactions/game-reward", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const { amount, gameType } = req.body;

    // Insert the ShareCoins transaction
    await db.insert(shareCoinsTransactions).values({
      userId: req.user.id,
      amount: amount.toString(),
      description: `Earned from playing ${gameType} game`,
      transactionType: "EARNED",
    });

    // Update user's ShareCoins balance
    await db
      .update(users)
      .set({
        shareCoins: sql`share_coins + ${amount}`,
      })
      .where(eq(users.id, req.user.id));

    res.status(201).json({ success: true });
  });

  // Sponsored Games endpoints
  app.get("/api/games/sponsored", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const games = await db
      .select()
      .from(sponsoredGames)
      .where(eq(sponsoredGames.isActive, true));

    res.json(games);
  });

  // Offer eligibility status — checks transaction unlock, daily cap, monthly cap
  app.get("/api/games/offer-status", async (req: any, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });

    const userId = req.user.id;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Check if user has at least 1 completed transaction
    const [{ txCount }] = await db
      .select({ txCount: sql<number>`COUNT(*)` })
      .from(itemRequests)
      .where(and(
        eq(itemRequests.requesterId, userId),
        inArray(itemRequests.status, ["ACTIVE", "RETURNED", "COMPLETED"]),
      ));
    const hasCompletedTransaction = Number(txCount) > 0;

    // Count SC earned from games today
    const [{ dailyClaimed }] = await db
      .select({ dailyClaimed: sql<number>`COALESCE(SUM(reward_amount), 0)` })
      .from(gameSessions)
      .where(and(
        eq(gameSessions.userId, userId),
        eq(gameSessions.status, "completed"),
        sql`completed_at >= ${startOfDay}`,
      ));

    // Count SC earned from games this month
    const [{ monthlyClaimed }] = await db
      .select({ monthlyClaimed: sql<number>`COALESCE(SUM(reward_amount), 0)` })
      .from(gameSessions)
      .where(and(
        eq(gameSessions.userId, userId),
        eq(gameSessions.status, "completed"),
        sql`completed_at >= ${startOfMonth}`,
      ));

    const DAILY_MAX = 1;
    const MONTHLY_MAX = 20;
    const dailyLimitReached = Number(dailyClaimed) >= DAILY_MAX;
    const monthlyLimitReached = Number(monthlyClaimed) >= MONTHLY_MAX;

    res.json({
      hasCompletedTransaction,
      dailyClaimed: Number(dailyClaimed),
      dailyMax: DAILY_MAX,
      dailyLimitReached,
      monthlyClaimed: Number(monthlyClaimed),
      monthlyMax: MONTHLY_MAX,
      monthlyLimitReached,
      canClaim: hasCompletedTransaction && !dailyLimitReached && !monthlyLimitReached,
    });
  });

  app.post("/api/games/:gameId/start-session", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const gameId = parseInt(req.params.gameId);
    const [game] = await db
      .select()
      .from(sponsoredGames)
      .where(eq(sponsoredGames.id, gameId))
      .limit(1);

    if (!game) {
      return res.status(404).send("Game not found");
    }

    const [session] = await db
      .insert(gameSessions)
      .values({
        userId: req.user.id,
        gameId: gameId,
        status: "started",
      })
      .returning();

    res.status(201).json(session);
  });

  // Game session completion endpoint — enforces daily (1 SC) and monthly (20 SC) caps
  app.post("/api/games/:gameId/complete-session", async (req: any, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });

    const userId = req.user.id;
    const gameId = parseInt(req.params.gameId);
    const { score, sessionId } = req.body;

    // Require at least 1 completed transaction to earn from offers
    const [{ txCount }] = await db
      .select({ txCount: sql<number>`COUNT(*)` })
      .from(itemRequests)
      .where(and(
        eq(itemRequests.requesterId, userId),
        inArray(itemRequests.status, ["ACTIVE", "RETURNED", "COMPLETED"]),
      ));
    if (Number(txCount) === 0) {
      return res.status(403).json({
        error: "Complete your first transaction to unlock ShareCoin rewards from sponsored offers.",
        code: "TRANSACTION_REQUIRED",
      });
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Daily cap: 1 SC per day
    const [{ dailyClaimed }] = await db
      .select({ dailyClaimed: sql<number>`COALESCE(SUM(reward_amount), 0)` })
      .from(gameSessions)
      .where(and(
        eq(gameSessions.userId, userId),
        eq(gameSessions.status, "completed"),
        sql`completed_at >= ${startOfDay}`,
      ));
    if (Number(dailyClaimed) >= 1) {
      return res.status(429).json({
        error: "You've already claimed your daily ShareCoin reward. Check back tomorrow.",
        code: "DAILY_LIMIT_REACHED",
      });
    }

    // Monthly cap: 20 SC per month
    const [{ monthlyClaimed }] = await db
      .select({ monthlyClaimed: sql<number>`COALESCE(SUM(reward_amount), 0)` })
      .from(gameSessions)
      .where(and(
        eq(gameSessions.userId, userId),
        eq(gameSessions.status, "completed"),
        sql`completed_at >= ${startOfMonth}`,
      ));
    if (Number(monthlyClaimed) >= 20) {
      return res.status(429).json({
        error: "You've reached your monthly limit of 20 ShareCoins from sponsored offers.",
        code: "MONTHLY_LIMIT_REACHED",
      });
    }

    // Find the game and validate
    const [game] = await db
      .select()
      .from(sponsoredGames)
      .where(eq(sponsoredGames.id, gameId))
      .limit(1);

    if (!game) {
      return res.status(404).json({ error: "Offer not found" });
    }

    // Award exactly 1 SC regardless of game.rewardAmount (standardised reward)
    const REWARD = 1;

    const [session] = await db
      .update(gameSessions)
      .set({
        completedAt: now,
        score: score || null,
        rewardAmount: REWARD.toString(),
        status: "completed",
      })
      .where(eq(gameSessions.id, parseInt(sessionId)))
      .returning();

    await db.insert(shareCoinsTransactions).values({
      userId,
      amount: REWARD.toString(),
      description: `Sponsored offer: ${game.name}`,
      transactionType: "EARNED",
    });

    await db
      .update(users)
      .set({ shareCoins: sql`share_coins + ${REWARD}` })
      .where(eq(users.id, userId));

    res.json({ success: true, reward: REWARD });
  });

  // Get all challenges
  app.get("/api/challenges", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const challenges = await db
      .select()
      .from(communityChallenges)
      .orderBy(desc(communityChallenges.startDate));

    res.json(challenges);
  });

  // Get participants for a challenge
  app.get("/api/challenges/participants/:challengeId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const challengeId = parseInt(req.params.challengeId);

    const participants = await db
      .select({
        userId: challengeParticipants.userId,
        username: users.username,
        currentScore: challengeParticipants.currentScore,
        currentRank: challengeParticipants.currentRank,
      })
      .from(challengeParticipants)
      .innerJoin(users, eq(users.id, challengeParticipants.userId))
      .where(eq(challengeParticipants.challengeId, challengeId))
      .orderBy(desc(challengeParticipants.currentScore));

    res.json(participants);
  });

  // Join a challenge
  app.post("/api/challenges/:challengeId/join", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const challengeId = parseInt(req.params.challengeId);

    // Check if challenge exists and is active
    const [challenge] = await db
      .select()
      .from(communityChallenges)
      .where(
        and(
          eq(communityChallenges.id, challengeId),
          eq(communityChallenges.status, "active"),
        ),
      )
      .limit(1);

    if (!challenge) {
      return res.status(404).send("Challenge not found or not active");
    }

    // Check if user is already participating
    const [existing] = await db
      .select()
      .from(challengeParticipants)
      .where(
        and(
          eq(challengeParticipants.challengeId, challengeId),
          eq(challengeParticipants.userId, req.user.id),
        ),
      )
      .limit(1);

    if (existing) {
      return res.status(400).send("Already participating in this challenge");
    }

    // Join the challenge
    const [participant] = await db
      .insert(challengeParticipants)
      .values({
        userId: req.user.id,
        challengeId: challengeId,
        currentScore: 0,
        currentRank: 0,
        rewardClaimed: false,
      })
      .returning();

    res.status(201).json(participant);
  });

  // Create item request
  app.post("/api/items/:itemId/request", requireEmailVerified, async (req: any, res) => {
    const itemId = parseInt(req.params.itemId);
    const { requestType, message, startDate, endDate, deliveryMethod, depositMethod, swapOfferedItemIds, swapRequestedItemIds } = req.body;

    // BORROW and RENT require full verification (email + ID + payment)
    if ((requestType === "BORROW" || requestType === "RENT") && req.verificationLevel.level !== 'fully_verified') {
      return res.status(403).json({ 
        error: "Please complete identity and payment verification to borrow or rent items",
        code: "FULL_VERIFICATION_REQUIRED",
        missing: {
          idVerified: req.verificationLevel.idVerified,
          paymentVerified: req.verificationLevel.paymentVerified
        }
      });
    }

    // Enforce Free tier borrow limit (max 2 borrows per 30-day window)
    if (requestType === "BORROW") {
      const blockedBorrow = await getBlockingOverdueBorrow(req.user.id);
      if (blockedBorrow) {
        return res.status(403).json(overdueBorrowRestrictionResponse(blockedBorrow));
      }

      const [borrowerRecord] = await db
        .select({
          subscriptionTier: users.subscriptionTier,
          monthlyBorrowCount: users.monthlyBorrowCount,
          monthlyBorrowResetAt: users.monthlyBorrowResetAt,
        })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      const tier = (borrowerRecord as any)?.subscriptionTier || 'free';
      if (tier === 'free') {
        const now = new Date();
        const resetAt = (borrowerRecord as any)?.monthlyBorrowResetAt
          ? new Date((borrowerRecord as any).monthlyBorrowResetAt)
          : now;
        const thirtyDayMs = 30 * 24 * 60 * 60 * 1000;

        if (now.getTime() - resetAt.getTime() > thirtyDayMs) {
          // Reset window
          await db.update(users)
            .set({ monthlyBorrowCount: 0, monthlyBorrowResetAt: now } as any)
            .where(eq(users.id, req.user.id));
        } else if (((borrowerRecord as any)?.monthlyBorrowCount || 0) >= 3) {
          return res.status(403).json({
            error: "You've reached your monthly borrow limit of 3 items on the Free plan. Upgrade to Member for unlimited borrows.",
            code: "BORROW_LIMIT_REACHED",
            currentTier: 'free',
            limit: 3,
          });
        }
      }
    }

    // Validate deliveryMethod
    const validDeliveryMethods = ["in_person"];
    const validatedDeliveryMethod = validDeliveryMethods.includes(deliveryMethod) 
      ? deliveryMethod 
      : "in_person";

    // Validate depositMethod
    const validDepositMethods = ["in_app", "in_person"];
    const validatedDepositMethod = validDepositMethods.includes(depositMethod)
      ? depositMethod
      : "in_app";

    // Check if item exists and is available
    const [item] = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.id, itemId),
          eq(items.isAvailable, true),
          // Check if the requested type is available
          or(
            and(eq(items.isLendable, true), eq(requestType, "BORROW")),
            and(eq(items.isRentable, true), eq(requestType, "RENT")),
            and(eq(items.isSwappable, true), eq(requestType, "SWAP")),
            and(eq(items.isGift, true), eq(requestType, "GIFT")),
          ),
        ),
      )
      .limit(1);

    if (!item) {
      return res
        .status(404)
        .send("Item not found or not available for this type of request");
    }

    // Prevent owners from requesting their own items
    if (item.ownerId === req.user.id) {
      return res.status(403).json({ error: "You cannot request your own item" });
    }

    // Cooldown check: block re-request if declined within 7 days and listing not updated since
    {
      const cooldownWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [recentDecline] = await db
        .select({ id: itemRequests.id, createdAt: itemRequests.createdAt })
        .from(itemRequests)
        .where(and(
          eq(itemRequests.itemId, itemId),
          eq(itemRequests.requesterId, req.user.id),
          eq(itemRequests.status, "DECLINED"),
          gte(itemRequests.createdAt, cooldownWindow)
        ))
        .orderBy(desc(itemRequests.createdAt))
        .limit(1);

      if (recentDecline) {
        const wasReset = item.updatedAt && item.updatedAt > recentDecline.createdAt;
        if (!wasReset) {
          const expiresAt = new Date(recentDecline.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
          return res.status(429).json({
            error: "Your previous request was declined. Please wait before requesting again.",
            code: "COOLDOWN_ACTIVE",
            cooldownExpiresAt: expiresAt,
          });
        }
      }
    }

    // Prevent borrowing if Replacement Value is missing
    if (requestType === "BORROW" && !item.replacementValue) {
      return res
        .status(400)
        .send("This item cannot be borrowed because it does not have a Replacement Value set.");
    }

    // Prevent renting if Replacement Value is missing
    if (requestType === "RENT" && !item.replacementValue) {
      return res
        .status(400)
        .send("This item cannot be rented because it does not have a Replacement Value set.");
    }

    // Create the request
    const [request] = await db
      .insert(itemRequests)
      .values({
        itemId,
        requesterId: req.user.id,
        requestType,
        message,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        status: "PENDING",
        deliveryMethod: validatedDeliveryMethod,
        depositMethod: validatedDepositMethod,
        deliveryConfirmed: false,
        ...(requestType === "SWAP" && Array.isArray(swapOfferedItemIds) && swapOfferedItemIds.length > 0
          ? { swapOfferedItemIds: swapOfferedItemIds.map(Number) }
          : {}),
        ...(requestType === "SWAP" && Array.isArray(swapRequestedItemIds) && swapRequestedItemIds.length > 0
          ? { swapRequestedItemIds: swapRequestedItemIds.map(Number) }
          : {}),
      })
      .returning();

    // Increment monthly borrow count for Free tier users
    if (requestType === "BORROW") {
      const [borrowerSub] = await db
        .select({ subscriptionTier: users.subscriptionTier })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);
      if ((borrowerSub as any)?.subscriptionTier === 'free') {
        await db.update(users)
          .set({ monthlyBorrowCount: sql`${users.monthlyBorrowCount} + 1` } as any)
          .where(eq(users.id, req.user.id));
      }
    }

    // Get requester info for notification
    const [requester] = await db
      .select({ username: users.username, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    const requesterName = requester?.displayName || requester?.username || "Someone";
    const requestTypeLabel = requestType.charAt(0).toUpperCase() + requestType.slice(1).toLowerCase();

    // Open the inbox thread with party-specific system summaries. The owner
    // receives the sender's name and the requester sees a clear confirmation
    // without generating an unread message for either party.
    if (item.ownerId) {
      const itemShortName = item.name.length > 30 ? item.name.slice(0, 30) + "…" : item.name;
      await db.insert(messages).values([
        {
          content: `📬 You sent a ${requestTypeLabel.toLowerCase()} request for "${itemShortName}"`,
          senderId: req.user.id,
          receiverId: item.ownerId,
          requestId: request.id,
          messageType: "system",
          isRead: true,
          metadata: { visibleToUserId: req.user.id },
        },
        {
          content: `📬 ${requesterName} sent a ${requestTypeLabel.toLowerCase()} request for "${itemShortName}"`,
          senderId: req.user.id,
          receiverId: item.ownerId,
          requestId: request.id,
          messageType: "system",
          metadata: { visibleToUserId: item.ownerId },
        },
      ]);
    }

    // Send the requester's note into the inbox chat thread
    if (message && message.trim() && item.ownerId) {
      await db.insert(messages).values({
        content: message.trim(),
        senderId: req.user.id,
        receiverId: item.ownerId,
        requestId: request.id,
        messageType: "text",
      });
    }

    // Create notification for item owner
    if (item.ownerId) {
      await db.insert(notifications).values({
        userId: item.ownerId,
        type: "item_request",
        title: `New ${requestTypeLabel} Request`,
        message: `${requesterName} wants to ${requestType === "GIFT" ? "claim gift" : requestType.toLowerCase()} "${item.name.length > 22 ? item.name.slice(0, 22) + "…" : item.name}"`,
        itemId: item.id,
        requestId: request.id,
        isRead: false,
      });
      // Native push so the owner is alerted instantly even if the app is closed
      sendPushToUser(item.ownerId, {
        title: `New ${requestTypeLabel} Request`,
        body: `${requesterName} wants to ${requestType === "GIFT" ? "claim gift" : requestType.toLowerCase()} "${item.name.length > 22 ? item.name.slice(0, 22) + "…" : item.name}"`,
        data: { screen: "chat", chatUserId: req.user.id, requestId: request.id, itemId: item.id },
      }, "requests").catch(() => {});
    }

    res.status(201).json(request);
  });

  // Get item requests for a user (both as requester and owner)
  app.get("/api/requests", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const rawRows = await db
      .select({
        id: itemRequests.id,
        itemId: itemRequests.itemId,
        requesterId: itemRequests.requesterId,
        requestType: itemRequests.requestType,
        status: itemRequests.status,
        message: itemRequests.message,
        startDate: itemRequests.startDate,
        endDate: itemRequests.endDate,
        createdAt: itemRequests.createdAt,
        deliveryMethod: itemRequests.deliveryMethod,
        depositMethod: itemRequests.depositMethod,
        deliveryConfirmed: itemRequests.deliveryConfirmed,
        deliveryConfirmedAt: itemRequests.deliveryConfirmedAt,
        // Trust deposit fields
        trustDepositAmount: itemRequests.trustDepositAmount,
        trustDepositBaseAmount: itemRequests.trustDepositBaseAmount,
        trustDiscountPercentage: itemRequests.trustDiscountPercentage,
        shareCoinAmount: itemRequests.shareCoinAmount,
        depositStatus: itemRequests.depositStatus,
        // Negotiation / counter-proposal
        negotiationStatus: itemRequests.negotiationStatus,
        counterDeliveryMethod: itemRequests.counterDeliveryMethod,
        counterDepositMethod: itemRequests.counterDepositMethod,
        counterStartDate: itemRequests.counterStartDate,
        counterEndDate: itemRequests.counterEndDate,
        counterProposedBy: itemRequests.counterProposedBy,
        counterProposedAt: itemRequests.counterProposedAt,
        termsAcceptedAt: itemRequests.termsAcceptedAt,
        termsDeclinedAt: itemRequests.termsDeclinedAt,
        // Swap item tracking
        swapOfferedItemIds: itemRequests.swapOfferedItemIds,
        swapRequestedItemIds: itemRequests.swapRequestedItemIds,
        counterSwapOwnerItemIds: itemRequests.counterSwapOwnerItemIds,
        counterSwapRequesterItemIds: itemRequests.counterSwapRequesterItemIds,
        counterNote: itemRequests.counterNote,
        counterRound: itemRequests.counterRound,
        // Delay notification
        returnDelayNotifiedAt: itemRequests.returnDelayNotifiedAt,
        returnDelayFollowUpNotifiedAt: sql<Date | null>`(
          SELECT ${notifications.createdAt}
          FROM ${notifications}
          WHERE ${notifications.requestId} = ${itemRequests.id}
            AND ${notifications.type} = 'return_delay_follow_up'
          ORDER BY ${notifications.createdAt} DESC
          LIMIT 1
        )`,
        // Handoff / return confirmations
        ownerConfirmedHandoff: itemRequests.ownerConfirmedHandoff,
        borrowerConfirmedHandoff: itemRequests.borrowerConfirmedHandoff,
        handoffConfirmDeadline: itemRequests.handoffConfirmDeadline,
         handoffConfirmedAt: itemRequests.handoffConfirmedAt,
        actualHandoffAt: itemRequests.actualHandoffAt,
        actualReturnAt: itemRequests.actualReturnAt,
        ownerConfirmedReturn: itemRequests.ownerConfirmedReturn,
        borrowerConfirmedReturn: itemRequests.borrowerConfirmedReturn,
        returnConditionOk: itemRequests.returnConditionOk,
        returnDisputeTriggered: itemRequests.returnDisputeTriggered,
        returnDisputeReason: itemRequests.returnDisputeReason,
        returnDisputePhotoUrl: itemRequests.returnDisputePhotoUrl,
        returnConditionNotes: itemRequests.returnConditionNotes,
        returnConditionRating: itemRequests.returnConditionRating,
        itemDbId: items.id,
        itemName: items.name,
        itemDescription: items.description,
        itemPhotos: items.photos,
        itemReplacementValue: items.replacementValue,
        itemTier: items.tier,
        itemOriginalValue: items.originalValue,
        itemShareCoinPrice: items.shareCoinPrice,
        itemOwnerId: items.ownerId,
        itemDollarsPrice: items.dollarsPrice,
        itemCategory: items.category,
        itemSecurityDeposit: items.securityDeposit,
        reqId: users.id,
        reqUsername: users.username,
        reqHandle: users.handle,
        reqDisplayName: users.displayName,
        reqIsVerified: users.isVerified,
        reqReputationLevel: users.reputationLevel,
        ownerUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${items.ownerId})`,
        ownerDisplayName: sql<string | null>`(SELECT display_name FROM users WHERE id = ${items.ownerId})`,
      })
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .innerJoin(users, eq(users.id, itemRequests.requesterId))
      .where(
        or(
          eq(items.ownerId, req.user.id),
          eq(itemRequests.requesterId, req.user.id),
        ),
      )
      .orderBy(desc(itemRequests.createdAt));

    const requests = rawRows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      requesterId: r.requesterId,
      requestType: r.requestType,
      status: r.status,
      message: r.message,
      startDate: r.startDate,
      endDate: r.endDate,
      createdAt: r.createdAt,
      deliveryMethod: r.deliveryMethod,
      depositMethod: r.depositMethod,
      deliveryConfirmed: r.deliveryConfirmed,
      deliveryConfirmedAt: r.deliveryConfirmedAt,
      trustDepositAmount: r.trustDepositAmount,
      trustDepositBaseAmount: r.trustDepositBaseAmount,
      trustDiscountPercentage: r.trustDiscountPercentage,
      shareCoinAmount: r.shareCoinAmount,
      depositStatus: r.depositStatus,
      negotiationStatus: r.negotiationStatus,
      counterDeliveryMethod: r.counterDeliveryMethod,
      counterDepositMethod: r.counterDepositMethod,
      counterStartDate: r.counterStartDate,
      counterEndDate: r.counterEndDate,
      counterProposedBy: r.counterProposedBy,
      counterProposedAt: r.counterProposedAt,
      termsAcceptedAt: r.termsAcceptedAt,
      termsDeclinedAt: r.termsDeclinedAt,
      swapOfferedItemIds: r.swapOfferedItemIds,
      swapRequestedItemIds: r.swapRequestedItemIds,
      counterSwapOwnerItemIds: r.counterSwapOwnerItemIds,
      counterSwapRequesterItemIds: r.counterSwapRequesterItemIds,
      counterNote: r.counterNote,
      counterRound: r.counterRound,
      returnDelayNotifiedAt: r.returnDelayNotifiedAt,
      returnDelayFollowUpNotifiedAt: r.returnDelayFollowUpNotifiedAt,
      ownerConfirmedHandoff: r.ownerConfirmedHandoff,
      borrowerConfirmedHandoff: r.borrowerConfirmedHandoff,
      handoffConfirmDeadline: r.handoffConfirmDeadline,
       actualHandoffAt: r.actualHandoffAt ?? r.handoffConfirmedAt,
      actualReturnAt: r.actualReturnAt,
      ownerConfirmedReturn: r.ownerConfirmedReturn,
      borrowerConfirmedReturn: r.borrowerConfirmedReturn,
      returnConditionOk: r.returnConditionOk,
      returnDisputeTriggered: r.returnDisputeTriggered,
      returnDisputeReason: r.returnDisputeReason,
      returnDisputePhotoUrl: r.returnDisputePhotoUrl,
      returnConditionNotes: r.returnConditionNotes,
      returnConditionRating: r.returnConditionRating,
      item: {
        id: r.itemDbId,
        name: r.itemName,
        description: r.itemDescription,
        photos: r.itemPhotos,
        replacementValue: r.itemReplacementValue,
        tier: r.itemTier,
        originalValue: r.itemOriginalValue,
        shareCoinPrice: r.itemShareCoinPrice,
        ownerId: r.itemOwnerId,
        dollarsPrice: r.itemDollarsPrice,
        category: r.itemCategory,
        securityDeposit: r.itemSecurityDeposit,
      },
      requester: {
        id: r.reqId,
        username: r.reqUsername,
        handle: r.reqHandle,
        displayName: r.reqDisplayName,
        isVerified: r.reqIsVerified,
        reputationLevel: r.reqReputationLevel,
      },
      owner: {
        username: r.ownerUsername,
        displayName: r.ownerDisplayName,
      },
    }));

    // Enrich SWAP requests with offered item details (original + counter items)
    const allOfferedIds = [...new Set(
      requests.flatMap(r => r.requestType === "SWAP" ? [
        ...(r.swapOfferedItemIds ?? []),
        ...(r.swapRequestedItemIds ?? []),
        ...(r.counterSwapOwnerItemIds ?? []),
        ...(r.counterSwapRequesterItemIds ?? []),
      ] : [])
    )];
    const offeredItemsMap = new Map<number, { id: number; name: string; photos: string[]; tier: number | null }>();
    if (allOfferedIds.length > 0) {
      const offeredRows = await db
        .select({ id: items.id, name: items.name, photos: items.photos, tier: items.tier })
        .from(items)
        .where(inArray(items.id, allOfferedIds));
      for (const row of offeredRows) offeredItemsMap.set(row.id, row);
    }
    const enrichedRequests = requests.map(r => ({
      ...r,
      swapOfferedItems: r.requestType === "SWAP"
        ? (r.swapOfferedItemIds ?? []).map(id => offeredItemsMap.get(id)).filter(Boolean)
        : [],
      swapRequestedItems: r.requestType === "SWAP"
        ? (r.swapRequestedItemIds ?? []).map(id => offeredItemsMap.get(id)).filter(Boolean)
        : [],
      counterSwapOwnerItems: r.requestType === "SWAP"
        ? (r.counterSwapOwnerItemIds ?? []).map(id => offeredItemsMap.get(id)).filter(Boolean)
        : [],
      counterSwapRequesterItems: r.requestType === "SWAP"
        ? (r.counterSwapRequesterItemIds ?? []).map(id => offeredItemsMap.get(id)).filter(Boolean)
        : [],
    }));

    // Sort to prioritize verified requesters for pending requests (owner sees verified first)
    const sortedRequests = enrichedRequests.sort((a, b) => {
      // Pending requests with verified requesters should appear first
      if (a.status === 'PENDING' && b.status === 'PENDING') {
        const aVerified = a.requester.isVerified ? 1 : 0;
        const bVerified = b.requester.isVerified ? 1 : 0;
        if (bVerified !== aVerified) return bVerified - aVerified;
      }
      // Then sort by creation date (most recent first)
      return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime();
    });

    res.json(sortedRequests);
  });

  // Update request status (accept/decline)
  app.patch("/api/requests/:requestId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);
    const { status } = req.body;

    const [request] = await db
      .select()
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(
        and(eq(itemRequests.id, requestId), eq(items.ownerId, req.user.id)),
      )
      .limit(1);

    if (!request) {
      return res.status(404).send("Request not found");
    }

    // Block acceptance if the item is currently physically out with another neighbour
    if (status === "ACCEPTED") {
      const physicallyOutStatuses = ["IN_PROGRESS", "HANDOFF_CONFIRMED", "AWAITING_HANDOFF_CONFIRM", "HANDOFF_DISPUTED", "DISPUTED"];
      const [activeOut] = await db
        .select({ id: itemRequests.id, status: itemRequests.status })
        .from(itemRequests)
        .where(
          and(
            eq(itemRequests.itemId, request.items.id),
            ne(itemRequests.id, requestId),
            sql`${itemRequests.status} = ANY(ARRAY[${sql.raw(physicallyOutStatuses.map(s => `'${s}'`).join(","))}])`
          )
        )
        .limit(1);

      if (activeOut) {
        return res.status(409).json({
          error: "This item is currently out with a neighbour. You can only accept new requests once it has been returned safely.",
        });
      }
    }

    // BORROW requests are paid for by the requester. Enforce the prorated
    // ShareCoin requirement on the server so an owner cannot accept a request
    // whose borrower cannot afford the final date range.
    if (status === "ACCEPTED" && request.item_requests.requestType === "BORROW") {
      const blockedBorrow = await getBlockingOverdueBorrow(request.item_requests.requesterId);
      if (blockedBorrow) {
        return res.status(403).json(overdueBorrowRestrictionResponse(blockedBorrow));
      }

      const weeklyPrice = parseFloat(request.items.shareCoinPrice?.toString() ?? "0") || 5;
      const startDate = request.item_requests.counterStartDate || request.item_requests.startDate;
      const endDate = request.item_requests.counterEndDate || request.item_requests.endDate;
      const days = startDate && endDate
        ? Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000))
        : 0;
      const required = days > 0 ? Math.max(1, Math.ceil((weeklyPrice / 7) * days)) : weeklyPrice;
      const [borrower] = await db
        .select({ shareCoins: users.shareCoins })
        .from(users)
        .where(eq(users.id, request.item_requests.requesterId))
        .limit(1);
      const currentBalance = Math.floor(parseFloat(borrower?.shareCoins?.toString() ?? "0"));

      if (currentBalance < required) {
        return res.status(400).json({
          code: "INSUFFICIENT_SHARECOINS",
          error: `The borrower needs ${required} ShareCoins for these dates but has ${currentBalance}.`,
          required,
          currentBalance,
          payerIsRequester: true,
        });
      }
    }

    // Check for active cooldowns before accepting swaps
    if (status === "ACCEPTED" && request.item_requests.requestType === "SWAP") {
      const cooldownCheck = await CooldownChecker.checkSwapCooldown(
        request.item_requests.requesterId,
        req.user.id
      );
      
      if (cooldownCheck.inCooldown) {
        const timeRemaining = CooldownChecker.getCooldownTimeRemaining(cooldownCheck.cooldownUntil!);
        return res.status(429).json({
          error: `Swap cooldown active. Please wait ${timeRemaining} minutes before swapping with this user again.`,
          cooldownUntil: cooldownCheck.cooldownUntil,
          reason: cooldownCheck.reason
        });
      }
    }

    // For SWAP acceptance: block if the payer (owner or requester) can't cover the coin offset
    if (status === "ACCEPTED" && request.item_requests.requestType === "SWAP") {
      const acOwnerItemIds = (request.item_requests.counterSwapOwnerItemIds as number[] | null)?.length
        ? (request.item_requests.counterSwapOwnerItemIds as number[])
        : [request.items.id];
      const acRequesterItemIds = (request.item_requests.counterSwapRequesterItemIds as number[] | null)?.length
        ? (request.item_requests.counterSwapRequesterItemIds as number[])
        : ((request.item_requests.swapOfferedItemIds as number[] | null) ?? []);

      if (acOwnerItemIds.length > 0 && acRequesterItemIds.length > 0) {
        const acAllIds = [...new Set([...acOwnerItemIds, ...acRequesterItemIds])];
        const acItemRows = await db.select({ id: items.id, tier: items.tier }).from(items).where(inArray(items.id, acAllIds));
        const acTierMap = new Map(acItemRows.map(r => [r.id, r.tier]));
        const acOwnerSC = acOwnerItemIds.reduce((s: number, id: number) => s + serverGetTierSC(acTierMap.get(id)), 0);
        const acRequesterSC = acRequesterItemIds.reduce((s: number, id: number) => s + serverGetTierSC(acTierMap.get(id)), 0);
        const acOffset = Math.abs(acOwnerSC - acRequesterSC);

        if (acOffset > 0) {
          const acPayerId = acOwnerSC < acRequesterSC ? request.items.ownerId! : request.item_requests.requesterId;
          const [acPayerRow] = await db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, acPayerId)).limit(1);
          const acBalance = parseInt(acPayerRow?.shareCoins?.toString() ?? "0");

          if (acBalance < acOffset) {
            const payerIsOwner = acPayerId === req.user.id;
            return res.status(402).json({
              error: payerIsOwner
                ? `You need ${acOffset} ShareCoins to complete this swap (your item is valued lower), but you only have ${acBalance}. Earn more ShareCoins first.`
                : `This swap can't proceed — the requester needs ${acOffset} ShareCoins to cover the value difference but doesn't have enough.`,
              code: "INSUFFICIENT_SHARECOINS",
              required: acOffset,
              available: acBalance,
              payerIsRequester: !payerIsOwner,
            });
          }
        }
      }
    }

    // When accepting, promote any pending counter-proposed dates/methods into the main fields
    const counterPromotionFields =
      status === "ACCEPTED" && request.item_requests.counterStartDate
        ? {
            startDate:      request.item_requests.counterStartDate,
            endDate:        request.item_requests.counterEndDate ?? request.item_requests.endDate,
            deliveryMethod: request.item_requests.counterDeliveryMethod ?? request.item_requests.deliveryMethod,
            depositMethod:  request.item_requests.counterDepositMethod ?? request.item_requests.depositMethod,
          }
        : {};

    const [updatedRequest] = await db
      .update(itemRequests)
      .set({ status, ...counterPromotionFields, ...(status === "ACCEPTED" ? { acceptedAt: new Date() } : {}) })
      .where(eq(itemRequests.id, requestId))
      .returning();

    // Generate handoff PIN on acceptance (owner gets a unique 4-digit code to verify the exchange)
    if (status === "ACCEPTED") {
      try { await issueHandoffPin(requestId); } catch (_) {}

      // System message → requester's inbox badge fires immediately on acceptance.
      // Inserted before any early-return paths so it always runs.
      try {
        const _itemShortAcc = request.items.name.length > 30 ? request.items.name.slice(0, 30) + "…" : request.items.name;
        const _typeLabel = request.item_requests.requestType === "GIFT" ? "gift claim" : (request.item_requests.requestType?.toLowerCase() || "request") + " request";
        await db.insert(messages).values({
          content: `✅ Your ${_typeLabel} for "${_itemShortAcc}" was accepted`,
          senderId: req.user.id,
          receiverId: request.item_requests.requesterId,
          messageType: "system",
          requestId,
        });
      } catch (_) {}

      // For BORROW requests where the deposit is exchanged in person, no in-app payment is
      // needed — skip straight to DEPOSIT_CONFIRMED so the handoff PIN flow unlocks immediately.
      if (
        request.item_requests.requestType === "BORROW" &&
        request.item_requests.depositMethod === "in_person"
      ) {
        const [advanced] = await db
          .update(itemRequests)
          .set({ status: "DEPOSIT_CONFIRMED" })
          .where(eq(itemRequests.id, requestId))
          .returning();
        if (advanced) return res.json(advanced);
      }
    }

    // Award ShareCoins for successful swaps (with anti-farming protection)
    if (status === "ACCEPTED" && request.item_requests.requestType === "SWAP") {
      try {
        // Run anti-farming detection
        const farmingDetection = await AntiFarmingSystem.detectSwapFarming(
          request.item_requests.requesterId,
          req.user.id,
          request.items.id
        );
        
        // Log detection results
        await db.insert(farmingDetections).values({
          userId1: request.item_requests.requesterId,
          userId2: req.user.id,
          itemId: request.items.id,
          riskLevel: farmingDetection.riskLevel,
          detectionReason: farmingDetection.reason || 'Normal transaction',
          actionTaken: farmingDetection.recommendations.join(', '),
        });
        
        // Apply anti-farming measures
        const measures = await AntiFarmingSystem.applyAntifarmingMeasures(
          farmingDetection,
          request.item_requests.requesterId,
          req.user.id
        );
        
        // Block transaction if critical farming detected
        if (measures.blockTransaction) {
          return res.status(400).json({ 
            error: "Transaction blocked due to suspicious activity. Please contact support if you believe this is an error.",
            riskLevel: farmingDetection.riskLevel
          });
        }
        
        // Apply cooldown if necessary
        if (measures.cooldownHours > 0) {
          const cooldownUntil = new Date(Date.now() + measures.cooldownHours * 60 * 60 * 1000);
          await db.insert(swapCooldowns).values({
            userId1: Math.min(request.item_requests.requesterId, req.user.id),
            userId2: Math.max(request.item_requests.requesterId, req.user.id),
            cooldownUntil,
            reason: farmingDetection.reason || 'Automated farming protection',
          });
        }
        
        // Coins, trust points, referral bonuses, and achievements are awarded at handoff confirmation
        // (not at acceptance) — see confirm-handoff route below
        if (!measures.awardShareCoins) {
          console.log(`🚫 ShareCoins will not be awarded at handoff due to farming detection (${farmingDetection.riskLevel})`);
        } else {
          console.log(`✅ Swap accepted — coins/milestones deferred to handoff confirmation`);
        }
        
      } catch (error) {
        console.error("Error in swap processing with anti-farming:", error);
        // Don't fail the request acceptance if anti-farming processing fails
      }
    }

    // Log accept/decline as an event in the chat thread
    try {
      if (status === "ACCEPTED" || status === "DECLINED") {
        await logRequestEvent(req.user.id, request.item_requests.requesterId, requestId,
          status === "ACCEPTED" ? "request_accepted" : "request_declined",
          { requestType: request.item_requests.requestType, itemName: request.items.name }
        );
      }
    } catch (_) {}


    // Handle commission for rental transactions
    // NOTE: Platform commission is FREE for the first 3 transactions per requester.
    // Standard rates apply after that. No ShareCoin deduction is made here.
    if (status === "ACCEPTED" && request.item_requests.requestType === "RENT") {
      // Logging only — actual fee waiver is enforced at payment time
      console.log(`ℹ️ Rental accepted — fee waiver status checked at payment step`);
    }

    // Notify the requester that their request was accepted or declined
    if (status === "ACCEPTED" || status === "DECLINED") {
      try {
        const requestType = request.item_requests.requestType;
        const itemName = request.items.name;
        const itemShort = itemName.length > 28 ? itemName.slice(0, 28) + "…" : itemName;
        const isGift = requestType === "GIFT";
        const notifTitle = status === "ACCEPTED"
          ? (isGift ? "Gift Accepted! 🎁" : "Request Accepted")
          : "Request Declined";
        const actionWord = isGift ? "gift claim" : requestType.toLowerCase() + " request";
        const notifMessage = status === "ACCEPTED"
          ? `Your ${actionWord} for "${itemShort}" was accepted`
          : `Your ${actionWord} for "${itemShort}" was declined`;
        await db.insert(notifications).values({
          userId: request.item_requests.requesterId,
          type: status === "ACCEPTED" ? "request_accepted" : "request_declined",
          title: notifTitle,
          message: notifMessage,
          itemId: request.items.id,
          requestId,
          isRead: false,
        });
        // Push via WebSocket so the requester's client refreshes immediately
        const requesterWs = connectedClients.get(request.item_requests.requesterId);
        if (requesterWs?.readyState === WebSocket.OPEN) {
          requesterWs.send(JSON.stringify({ type: "notification", requestId }));
        }
        // Native push so requester gets instant alert when app is closed
        sendPushToUser(request.item_requests.requesterId, {
          title: notifTitle,
          body: notifMessage,
          data: { screen: "chat", chatUserId: request.items.ownerId, requestId, itemId: request.items.id },
        }, "requests").catch(() => {});
      } catch (_) {}
    }

    res.json(updatedRequest);
  });

  // =====================================
  // TERMS NEGOTIATION ENDPOINTS
  // =====================================

  // Helper: generate a random 4-digit handoff PIN
  function generateHandoffPin(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  // Helper: generate and store a handoff PIN for a newly-accepted request
  async function issueHandoffPin(requestId: number) {
    const pin = generateHandoffPin();
    const pinExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.update(itemRequests)
      .set({ handoffPin: pin, pinExpiresAt, pinUsed: false, pinAttempts: 0 } as any)
      .where(eq(itemRequests.id, requestId));
    return pin;
  }

  // Helper: log a request lifecycle event as a system message in the chat thread
  async function logRequestEvent(
    senderId: number,
    receiverId: number,
    requestId: number,
    eventType: string,
    metadata: Record<string, unknown>
  ) {
    const labelMap: Record<string, string> = {
      counter_proposed: "New terms proposed",
      terms_accepted: "Terms accepted",
      terms_declined: "Terms declined",
      request_accepted: "Request accepted",
      request_declined: "Request declined",
    };
    const label = labelMap[eventType] || eventType;
    await db.insert(messages).values({
      senderId,
      receiverId,
      content: label,
      messageType: "event",
      metadata: { eventType, ...metadata },
      requestId,
    });
  }

  // Either owner OR requester may propose counter terms
  app.post("/api/requests/:requestId/counter-proposal", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);
    const { deliveryMethod, depositMethod, startDate, endDate,
            swapOwnerItemIds, swapRequesterItemIds, counterNote } = req.body;

    // Load the request with item — user must be owner or requester
    const [request] = await db
      .select()
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(
        and(
          eq(itemRequests.id, requestId),
          or(
            eq(items.ownerId, req.user.id),
            eq(itemRequests.requesterId, req.user.id)
          )
        )
      )
      .limit(1);

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.item_requests.status !== "PENDING") {
      return res.status(400).json({ error: "Can only propose changes to pending requests" });
    }

    const isRequester = req.user.id === request.item_requests.requesterId;
    const isOwner = req.user.id === request.items.ownerId;
    const isSwap = request.item_requests.requestType === "SWAP";

    if (isRequester && request.item_requests.negotiationStatus !== "counter_proposed") {
      return res.status(400).json({ error: "No counter-proposal to respond to with your own counter" });
    }

    // Enforce max 2 counter proposals for all request types
    const currentRound = request.item_requests.counterRound ?? 0;
    if (currentRound >= 2) {
      return res.status(400).json({ error: "Maximum counter proposals (2) reached. Please accept or decline." });
    }

    const newRound = currentRound + 1;

    const swapUpdateFields = isSwap ? {
      counterSwapOwnerItemIds: Array.isArray(swapOwnerItemIds) ? swapOwnerItemIds.map(Number) : (request.item_requests.counterSwapOwnerItemIds ?? []),
      counterSwapRequesterItemIds: Array.isArray(swapRequesterItemIds) ? swapRequesterItemIds.map(Number) : (request.item_requests.counterSwapRequesterItemIds ?? []),
      counterNote: counterNote ?? null,
    } : {};

    const [updated] = await db
      .update(itemRequests)
      .set({
        negotiationStatus: "counter_proposed",
        counterDeliveryMethod: deliveryMethod || request.item_requests.deliveryMethod,
        counterDepositMethod: depositMethod || request.item_requests.depositMethod,
        counterStartDate: startDate ? new Date(startDate) : (request.item_requests.startDate ?? null),
        counterEndDate: endDate ? new Date(endDate) : (request.item_requests.endDate ?? null),
        counterProposedAt: new Date(),
        counterProposedBy: req.user.id,
        counterRound: newRound,
        ...swapUpdateFields,
      })
      .where(eq(itemRequests.id, requestId))
      .returning();

    const otherUserId = isOwner ? request.item_requests.requesterId : request.items.ownerId!;

    // For SWAP counters, also resolve item names for the event metadata
    let swapEventMeta: Record<string, unknown> = {};
    if (isSwap) {
      const allSwapIds = [
        ...(updated.counterSwapOwnerItemIds ?? []),
        ...(updated.counterSwapRequesterItemIds ?? []),
      ].filter(Boolean);
      const swapItemData: Record<number, { name: string; photos: string[]; tier: number | null }> = {};
      if (allSwapIds.length > 0) {
        const swapItems = await db.select({ id: items.id, name: items.name, photos: items.photos, tier: items.tier }).from(items).where(inArray(items.id, allSwapIds));
        for (const si of swapItems) swapItemData[si.id] = { name: si.name, photos: si.photos ?? [], tier: si.tier };
      }
      const ownerIds = updated.counterSwapOwnerItemIds ?? [];
      const requesterIds = updated.counterSwapRequesterItemIds ?? [];
      swapEventMeta = {
        swapOwnerItemIds: ownerIds,
        swapRequesterItemIds: requesterIds,
        swapOwnerItemNames: ownerIds.map(id => swapItemData[id]?.name ?? `Item #${id}`),
        swapRequesterItemNames: requesterIds.map(id => swapItemData[id]?.name ?? `Item #${id}`),
        swapOwnerItemPhotos: ownerIds.map(id => swapItemData[id]?.photos?.[0] ?? null),
        swapRequesterItemPhotos: requesterIds.map(id => swapItemData[id]?.photos?.[0] ?? null),
        swapOwnerItemTiers: ownerIds.map(id => swapItemData[id]?.tier ?? 2),
        swapRequesterItemTiers: requesterIds.map(id => swapItemData[id]?.tier ?? 2),
        counterNote: updated.counterNote,
        counterRound: updated.counterRound,
      };
    }

    // Log event in chat — snapshot original (pre-counter) dates so the chat card can show "Current → Proposed"
    await logRequestEvent(req.user.id, otherUserId, requestId, "counter_proposed", {
      requestType: request.item_requests.requestType,
      deliveryMethod: updated.counterDeliveryMethod,
      depositMethod: updated.counterDepositMethod,
      startDate: updated.counterStartDate,
      endDate: updated.counterEndDate,
      origDeliveryMethod: request.item_requests.deliveryMethod,
      origDepositMethod: request.item_requests.depositMethod ?? "in_app",
      origStartDate: request.item_requests.startDate,
      origEndDate: request.item_requests.endDate,
      proposedByRole: isOwner ? "owner" : "requester",
      ...swapEventMeta,
    });

    // Notify other party
    const _cpItemName1 = request.items.name;
    const _cpType1 = request.item_requests.requestType?.toLowerCase() || "request";
    const _cpItemShort1 = _cpItemName1.length > 30 ? _cpItemName1.slice(0, 30) + "…" : _cpItemName1;
    await db.insert(notifications).values({
      userId: otherUserId,
      type: "terms_counter_proposed",
      title: "New Terms Proposed",
      message: `For ${isSwap ? "swap" : _cpType1} request on "${_cpItemShort1}"`,
      itemId: request.items.id,
      requestId,
    });

    res.json({ success: true, request: updated, message: "Counter-proposal sent" });
  });

  // Respond to a counter-proposal: accept, decline, or counter back
  app.post("/api/requests/:requestId/respond-to-counter", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);
    const { accept, counter } = req.body; // accept: bool | counter: { deliveryMethod, depositMethod, startDate, endDate, swapOwnerItemIds, swapRequesterItemIds, counterNote }

    const [request] = await db
      .select()
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(
        and(
          eq(itemRequests.id, requestId),
          or(
            eq(itemRequests.requesterId, req.user.id),
            eq(items.ownerId, req.user.id)
          )
        )
      )
      .limit(1);

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.item_requests.negotiationStatus !== "counter_proposed") {
      return res.status(400).json({ error: "No counter-proposal to respond to" });
    }

    const isSwap = request.item_requests.requestType === "SWAP";

    const isRequester = req.user.id === request.item_requests.requesterId;
    const isOwner = req.user.id === request.items.ownerId;
    const otherUserId = isRequester ? request.items.ownerId! : request.item_requests.requesterId;

    // The responder must be the other party from whoever proposed
    if (request.item_requests.counterProposedBy === req.user.id) {
      return res.status(400).json({ error: "You already proposed the current counter. Wait for the other party." });
    }

    // Counter-back
    if (counter) {
      // Enforce max 2 counter proposals for all request types
      const currentRound = request.item_requests.counterRound ?? 0;
      if (currentRound >= 2) {
        return res.status(400).json({ error: "Maximum counter proposals (2) reached. Please accept or decline." });
      }

      const newRound = currentRound + 1;
      const swapCounterFields = isSwap ? {
        counterSwapOwnerItemIds: Array.isArray(counter.swapOwnerItemIds) ? counter.swapOwnerItemIds.map(Number) : (request.item_requests.counterSwapOwnerItemIds ?? []),
        counterSwapRequesterItemIds: Array.isArray(counter.swapRequesterItemIds) ? counter.swapRequesterItemIds.map(Number) : (request.item_requests.counterSwapRequesterItemIds ?? []),
        counterNote: counter.counterNote ?? null,
      } : {};

      const [updated] = await db
        .update(itemRequests)
        .set({
          negotiationStatus: "counter_proposed",
          counterDeliveryMethod: counter.deliveryMethod || request.item_requests.counterDeliveryMethod,
          counterDepositMethod: counter.depositMethod || request.item_requests.counterDepositMethod,
          counterStartDate: counter.startDate ? new Date(counter.startDate) : (request.item_requests.counterStartDate ?? null),
          counterEndDate: counter.endDate ? new Date(counter.endDate) : (request.item_requests.counterEndDate ?? null),
          counterProposedAt: new Date(),
          counterProposedBy: req.user.id,
          counterRound: newRound,
          ...swapCounterFields,
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      let swapCounterBackMeta: Record<string, unknown> = {};
      if (isSwap) {
        const allSwapIds2 = [...(updated.counterSwapOwnerItemIds ?? []), ...(updated.counterSwapRequesterItemIds ?? [])].filter(Boolean);
        const swapItemNames2: Record<number, string> = {};
        if (allSwapIds2.length > 0) {
          const swapItems2 = await db.select({ id: items.id, name: items.name }).from(items).where(inArray(items.id, allSwapIds2));
          for (const si of swapItems2) swapItemNames2[si.id] = si.name;
        }
        swapCounterBackMeta = {
          swapOwnerItemIds: updated.counterSwapOwnerItemIds,
          swapRequesterItemIds: updated.counterSwapRequesterItemIds,
          swapOwnerItemNames: (updated.counterSwapOwnerItemIds ?? []).map(id => swapItemNames2[id] ?? `Item #${id}`),
          swapRequesterItemNames: (updated.counterSwapRequesterItemIds ?? []).map(id => swapItemNames2[id] ?? `Item #${id}`),
          counterNote: updated.counterNote,
          counterRound: updated.counterRound,
        };
      }

      // Log event in chat — snapshot the PREVIOUS counter's proposed terms as "orig" so the
      // chat card can show "Previous (pending counter) → New proposal"
      await logRequestEvent(req.user.id, otherUserId, requestId, "counter_proposed", {
        requestType: request.item_requests.requestType,
        deliveryMethod: updated.counterDeliveryMethod,
        depositMethod: updated.counterDepositMethod,
        startDate: updated.counterStartDate,
        endDate: updated.counterEndDate,
        origDeliveryMethod: request.item_requests.counterDeliveryMethod ?? request.item_requests.deliveryMethod,
        origDepositMethod: request.item_requests.counterDepositMethod ?? request.item_requests.depositMethod ?? "in_app",
        origStartDate: request.item_requests.counterStartDate ?? request.item_requests.startDate,
        origEndDate: request.item_requests.counterEndDate ?? request.item_requests.endDate,
        proposedByRole: isOwner ? "owner" : "requester",
        ...swapCounterBackMeta,
      });

      const _cpItemName2 = request.items.name;
      const _cpType2 = request.item_requests.requestType?.toLowerCase() || "request";
      const _cpItemShort2 = _cpItemName2.length > 30 ? _cpItemName2.slice(0, 30) + "…" : _cpItemName2;
      await db.insert(notifications).values({
        userId: otherUserId,
        type: "terms_counter_proposed",
        title: "New Terms Proposed",
        message: `For ${isSwap ? "swap" : _cpType2} request on "${_cpItemShort2}"`,
        itemId: request.items.id,
        requestId,
      });

      return res.json({ success: true, request: updated, message: "Counter-proposal sent" });
    }

    if (accept) {
      const finalDeliveryMethod = request.item_requests.counterDeliveryMethod || request.item_requests.deliveryMethod;
      const finalDepositMethod = request.item_requests.counterDepositMethod || request.item_requests.depositMethod;
      const finalStartDate = request.item_requests.counterStartDate || request.item_requests.startDate;
      const finalEndDate = request.item_requests.counterEndDate || request.item_requests.endDate;

      // The requester pays the ShareCoin cost for BORROW requests, regardless
      // of whether the requester or owner clicks Accept on these final terms.
      if (request.item_requests.requestType === "BORROW") {
        const blockedBorrow = await getBlockingOverdueBorrow(request.item_requests.requesterId);
        if (blockedBorrow) {
          return res.status(403).json(overdueBorrowRestrictionResponse(blockedBorrow));
        }

        const weeklyPrice = parseFloat(request.items.shareCoinPrice?.toString() ?? "0") || 5;
        const days = finalStartDate && finalEndDate
          ? Math.max(1, Math.ceil((new Date(finalEndDate).getTime() - new Date(finalStartDate).getTime()) / 86_400_000))
          : 0;
        const required = days > 0 ? Math.max(1, Math.ceil((weeklyPrice / 7) * days)) : weeklyPrice;
        const [borrower] = await db
          .select({ shareCoins: users.shareCoins })
          .from(users)
          .where(eq(users.id, request.item_requests.requesterId))
          .limit(1);
        const currentBalance = Math.floor(parseFloat(borrower?.shareCoins?.toString() ?? "0"));

        if (currentBalance < required) {
          return res.status(400).json({
            code: "INSUFFICIENT_SHARECOINS",
            error: `The borrower needs ${required} ShareCoins for these dates but has ${currentBalance}.`,
            required,
            currentBalance,
            payerIsRequester: true,
          });
        }
      }

      // When the OWNER accepts a counter, fully accept the request (they have final approval authority).
      // When the REQUESTER accepts, the owner still needs to formally approve.
      const ownerIsAccepting = isOwner;

      const [updated] = await db
        .update(itemRequests)
        .set({
          negotiationStatus: "terms_accepted",
          status: ownerIsAccepting ? "ACCEPTED" : request.item_requests.status,
          deliveryMethod: finalDeliveryMethod,
          depositMethod: finalDepositMethod,
          startDate: finalStartDate,
          endDate: finalEndDate,
          termsAcceptedAt: new Date(),
          ...(ownerIsAccepting ? { acceptedAt: new Date() } : {}),
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      // Generate handoff PIN when owner formally accepts
      if (ownerIsAccepting) {
        try { await issueHandoffPin(requestId); } catch (_) {}
      }

      // If owner accepted, create delivery arrangement so requester can proceed to deposit
      if (ownerIsAccepting && finalDeliveryMethod && finalDepositMethod) {
        try {
          await db.insert(deliveryArrangements).values({
            requestId,
            deliveryType: "SELF_ARRANGE",
            deliveryMethod: finalDeliveryMethod,
            depositMethod: finalDepositMethod,
            securityDeposit: request.items.replacementValue?.toString() || "50",
            status: "PENDING",
          });
        } catch (_) {
          // Arrangement may already exist — ignore duplicate
        }
      }

      await logRequestEvent(req.user.id, otherUserId, requestId,
        ownerIsAccepting ? "request_accepted" : "terms_accepted",
        {
          deliveryMethod: updated.deliveryMethod,
          depositMethod: updated.depositMethod,
          startDate: updated.startDate,
          endDate: updated.endDate,
          acceptedByRole: isOwner ? "owner" : "requester",
        }
      );

      // The lifecycle event above is the canonical chat message. Do not add a
      // second system stamp for the same acceptance/terms action.

      // Notification message: for in-person BORROW deposit, skip deposit step messaging
      const inPersonBorrowDeposit =
        ownerIsAccepting &&
        request.item_requests.requestType === "BORROW" &&
        finalDepositMethod === "in_person";

      await db.insert(notifications).values({
        userId: otherUserId,
        type: ownerIsAccepting ? "request_accepted" : "terms_accepted",
        title: ownerIsAccepting ? "Request Accepted" : "Terms Accepted",
        message: ownerIsAccepting
          ? inPersonBorrowDeposit
            ? `"${request.items.name}" — meet up and exchange the deposit in person.`
            : `"${request.items.name}" — pay your deposit to confirm.`
          : "Your terms were accepted. Accept or decline to proceed.",
        itemId: request.items.id,
        requestId,
      });
      // Native push for terms negotiation updates
      const termsTitle = ownerIsAccepting ? "Request Accepted" : "Terms Accepted";
      const termsBody = ownerIsAccepting
        ? inPersonBorrowDeposit
          ? `"${request.items.name}" — meet up and exchange the deposit in person.`
          : `"${request.items.name}" — pay your deposit to confirm.`
        : "Your terms were accepted. Accept or decline to proceed.";
      sendPushToUser(otherUserId, {
        title: termsTitle,
        body: termsBody,
        data: { screen: "chat", chatUserId: req.user.id, requestId, itemId: request.items.id },
      }, "requests").catch(() => {});

      // For BORROW with in-person deposit, skip the in-app deposit step entirely
      let finalRequest = updated;
      if (inPersonBorrowDeposit) {
        const [advanced] = await db
          .update(itemRequests)
          .set({ status: "DEPOSIT_CONFIRMED" })
          .where(eq(itemRequests.id, requestId))
          .returning();
        if (advanced) finalRequest = advanced;
      }

      return res.json({
        success: true,
        request: finalRequest,
        ownerAccepted: ownerIsAccepting,
        message: ownerIsAccepting
          ? inPersonBorrowDeposit
            ? "Request accepted! Meet up and exchange the deposit in person."
            : "Request accepted! The requester can now pay their deposit."
          : "You've accepted the new terms. Waiting for owner to accept.",
      });
    } else {
      const [updated] = await db
        .update(itemRequests)
        .set({ negotiationStatus: "terms_declined", status: "CANCELLED", termsDeclinedAt: new Date() })
        .where(eq(itemRequests.id, requestId))
        .returning();

      await logRequestEvent(req.user.id, otherUserId, requestId, "terms_declined", {
        declinedByRole: isOwner ? "owner" : "requester",
      });

      await db.insert(notifications).values({
        userId: otherUserId,
        type: "terms_declined",
        title: "Terms Declined",
        message: "The other party declined. The request has been cancelled.",
        itemId: request.items.id,
        requestId,
      });

      return res.json({ success: true, request: updated, message: "Request cancelled" });
    }
  });

  // Fetch swap-eligible items for a user (for counter-proposal item picker)
  // Returns items that are: isAvailable, isSwappable, not in active locked transactions, not archived
  app.get("/api/swap-eligible-items", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const partnerId = req.query.partnerId ? parseInt(req.query.partnerId as string) : null;
    const userId = partnerId ?? req.user.id;

    const LOCKED_STATUSES = ["ACCEPTED", "DEPOSIT_CONFIRMED", "IN_PROGRESS"];

    // Get all item IDs currently locked in active transactions
    const lockedItemRows = await db
      .select({ itemId: itemRequests.itemId })
      .from(itemRequests)
      .where(inArray(itemRequests.status, LOCKED_STATUSES));
    const lockedItemIds = lockedItemRows.map(r => r.itemId);

    const eligibleItems = await db
      .select({
        id: items.id,
        name: items.name,
        photos: items.photos,
        tier: items.tier,
        shareCoinPrice: items.shareCoinPrice,
        originalValue: items.originalValue,
        ownerId: items.ownerId,
      })
      .from(items)
      .where(
        and(
          eq(items.ownerId, userId),
          eq(items.isAvailable, true),
          eq(items.isSwappable, true),
          lockedItemIds.length > 0 ? notInArray(items.id, lockedItemIds) : undefined
        )
      );

    res.json(eligibleItems);
  });

  // Gift handoff confirmation - for both giver and receiver
  app.post("/api/requests/:requestId/confirm-gift-handoff", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);
    const { role } = req.body; // "giver" or "receiver"

    if (!role || !["giver", "receiver"].includes(role)) {
      return res.status(400).json({ error: "Invalid role. Must be 'giver' or 'receiver'" });
    }

    // Fetch the request with item info
    const [request] = await db
      .select()
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(eq(itemRequests.id, requestId))
      .limit(1);

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.item_requests.requestType !== "GIFT") {
      return res.status(400).json({ error: "This endpoint is only for gift transactions" });
    }

    if (request.item_requests.status !== "ACCEPTED") {
      return res.status(400).json({ error: "Gift must be accepted before confirming handoff" });
    }

    // Validate the user is authorized
    const isGiver = request.items.ownerId === req.user.id;
    const isReceiver = request.item_requests.requesterId === req.user.id;

    if (role === "giver" && !isGiver) {
      return res.status(403).json({ error: "Only the giver can confirm as giver" });
    }
    if (role === "receiver" && !isReceiver) {
      return res.status(403).json({ error: "Only the receiver can confirm as receiver" });
    }

    // Idempotency: check if user already confirmed
    if (role === "giver" && request.item_requests.ownerConfirmedHandoff) {
      return res.json({ success: true, completed: false, message: "Already confirmed. Waiting for receiver." });
    }
    if (role === "receiver" && request.item_requests.borrowerConfirmedHandoff) {
      return res.json({ success: true, completed: false, message: "Already confirmed. Waiting for giver." });
    }

    // Update the confirmation status
    const updateData: any = {};
    if (role === "giver") {
      updateData.ownerConfirmedHandoff = true;
    } else {
      updateData.borrowerConfirmedHandoff = true;
    }

    const [updated] = await db
      .update(itemRequests)
      .set(updateData)
      .where(eq(itemRequests.id, requestId))
      .returning();

    // Check if both parties have confirmed
    const giverConfirmed = role === "giver" ? true : request.item_requests.ownerConfirmedHandoff;
    const receiverConfirmed = role === "receiver" ? true : request.item_requests.borrowerConfirmedHandoff;

    if (giverConfirmed && receiverConfirmed) {
      // Both confirmed - complete the gift!
      await db
        .update(itemRequests)
        .set({ status: "COMPLETED" })
        .where(eq(itemRequests.id, requestId));

      // Mark item as gifted/unavailable
      await db
        .update(items)
        .set({ isAvailable: false })
        .where(eq(items.id, request.items.id));

      const giverId = request.items.ownerId!;
      const receiverId = request.item_requests.requesterId;

      // Award first-time bonus to giver only (no recurring reward; receiver gets nothing)
      const giftBonusResult = await awardShareCoinsWithFirstTimeBonus(giverId, 'GIFT', request.items.name, 0);

      // Update trust scores — with anti-farming guards
      try {
        // Guard 1: only award gift trust points once per giver→receiver pair (lifetime)
        const [priorGiftBetweenPair] = await db
          .select({ cnt: sql<number>`count(*)` })
          .from(itemRequests)
          .innerJoin(items, eq(items.id, itemRequests.itemId))
          .where(
            and(
              eq(itemRequests.requestType, "GIFT"),
              eq(itemRequests.status, "COMPLETED"),
              eq(items.ownerId, giverId),
              eq(itemRequests.requesterId, receiverId),
              ne(itemRequests.id, requestId),
            ),
          );

        // Guard 2: receiver account must be at least 14 days old
        const [receiverUser] = await db
          .select({ createdAt: users.createdAt })
          .from(users)
          .where(eq(users.id, receiverId))
          .limit(1);
        const receiverAgeDays = receiverUser
          ? (Date.now() - new Date(receiverUser.createdAt!).getTime()) / 86_400_000
          : 0;

        if (Number(priorGiftBetweenPair?.cnt ?? 1) > 0) {
          console.log(`⚠️ Gift trust points skipped — giver ${giverId} has already gifted receiver ${receiverId} before (pair cap).`);
        } else if (receiverAgeDays < 14) {
          console.log(`⚠️ Gift trust points skipped — receiver ${receiverId} account is only ${receiverAgeDays.toFixed(1)} days old (minimum 14).`);
        } else {
          await awardGiftingPoints(giverId, receiverId, requestId, request.items.id);
          console.log(`✅ Awarded trust points for completed gift`);
          await db.insert(notifications).values({
            userId: giverId,
            type: "trust_score_changed",
            title: "Trust Score +10",
            message: "Gift completed +10",
            itemId: request.items.id,
            requestId,
            isRead: false,
          });
        }
      } catch (trustError) {
        console.error("Error awarding gift trust points:", trustError);
      }

      // Check and award referral bonus for both users (first transaction completion)
      await checkAndAwardReferralBonus(giverId, requestId, 'GIFT');
      await checkAndAwardReferralBonus(receiverId, requestId, 'GIFT');
      // Check and award any newly unlocked badges
      await checkAndAwardAchievements(giverId);
      await checkAndAwardAchievements(receiverId);

      // Send chat completion stamp
      await db.insert(messages).values({
        content: `🎁 Gift has been handed over. Thank you for caring!`,
        senderId: giverId,
        receiverId,
        messageType: "system",
        requestId,
      });

      // Send completion notification to both parties
      await db.insert(notifications).values([
        {
          userId: giverId,
          type: "gift_completed",
          title: "Gift Completed! 🎁",
          message: giftBonusResult.isFirstTime
            ? `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" gifted — first-time bonus: +1 SC.`
            : `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" gifted successfully.`,
          itemId: request.items.id,
          requestId: requestId,
        },
        {
          userId: receiverId,
          type: "gift_completed",
          title: "Gift Received! 🎁",
          message: `"${request.items.name.length > 22 ? request.items.name.slice(0, 22) + "…" : request.items.name}" is yours — enjoy!`,
          itemId: request.items.id,
          requestId: requestId,
        },
      ]);

      return res.json({
        success: true,
        completed: true,
        message: "Gift complete! The giver earns a first-time bonus ShareCoin. Enjoy your new item!",
      });
    }

    // Only one party confirmed so far — look up the confirming user's name
    const [confirmerUser] = await db
      .select({ displayName: users.displayName, username: users.username })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);
    const confirmerName = confirmerUser?.displayName || confirmerUser?.username || (role === "giver" ? "The giver" : "The receiver");

    const otherPartyId = role === "giver" ? request.item_requests.requesterId : request.items.ownerId!;

    // Send role-specific confirmation stamps
    await db.insert(messages).values([
      {
        content: `✅ You confirmed the handoff`,
        senderId: request.items.ownerId!,
        receiverId: request.item_requests.requesterId,
        messageType: "system",
        requestId,
        metadata: { visibleToUserId: req.user.id },
      },
      {
        content: `✅ ${confirmerName} confirmed the handoff`,
        senderId: request.items.ownerId!,
        receiverId: request.item_requests.requesterId,
        messageType: "system",
        requestId,
        metadata: { visibleToUserId: otherPartyId },
      },
      {
        content: `If only one person confirms, we'll complete this automatically in 24 hours.`,
        senderId: request.items.ownerId!,
        receiverId: request.item_requests.requesterId,
        messageType: "system",
        requestId,
      },
    ]);
    await db.insert(notifications).values({
      userId: otherPartyId,
      type: "gift_handoff_pending",
      title: role === "giver" ? "Giver Confirmed Handoff" : "Receiver Confirmed Receipt",
      message: `Confirm gift handoff for "${request.items.name.length > 22 ? request.items.name.slice(0, 22) + "…" : request.items.name}".`,
      itemId: request.items.id,
      requestId: requestId,
    });

    res.json({
      success: true,
      completed: false,
      message: "Confirmation recorded. Waiting for the other party to confirm.",
    });
  });

  // Create Stripe payment authorization hold for security deposit
  app.post("/api/stripe/create-deposit-hold", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { depositAmount, requestId } = req.body;
      if (!depositAmount || depositAmount <= 0) {
        return res.status(400).json({ error: "Invalid deposit amount" });
      }

      // Look up saved payment method
      const [userRecord] = await db
        .select({ stripeCustomerId: users.stripeCustomerId, stripePaymentMethodId: users.stripePaymentMethodId })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!userRecord?.stripeCustomerId || !userRecord?.stripePaymentMethodId) {
        return res.status(400).json({ error: "No payment method on file. Please add a card in Settings." });
      }

      // Create authorization hold for deposit only (platform fee charged separately)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(depositAmount * 100),
        currency: "usd",
        capture_method: "manual",
        customer: userRecord.stripeCustomerId,
        payment_method: userRecord.stripePaymentMethodId,
        confirm: true,
        off_session: true,
        metadata: {
          type: "security_deposit",
          request_id: requestId.toString(),
          user_id: req.user.id.toString(),
          deposit_amount: depositAmount.toString(),
        },
        description: `Security deposit hold for ShareSwap request #${requestId}`,
      });

      res.json({ paymentIntentId: paymentIntent.id, depositAmount });
    } catch (error: any) {
      console.error("Error creating deposit hold:", error);
      res.status(500).json({ error: "Failed to create deposit hold: " + error.message });
    }
  });

  // Charge platform fee immediately (separate from the authorization hold)
  app.post("/api/stripe/charge-platform-fee", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { platformFeeAmount, requestId } = req.body;
      if (!platformFeeAmount || platformFeeAmount <= 0) {
        return res.status(400).json({ error: "Invalid platform fee amount" });
      }

      // Platform fee waived for first 3 completed transactions per user
      const FREE_TRANSACTIONS = 3;
      const [{ count: txCount }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(itemRequests)
        .where(and(
          eq(itemRequests.requesterId, req.user.id),
          inArray(itemRequests.status, ["ACTIVE", "RETURNED", "COMPLETED"]),
        ));
      if (Number(txCount) < FREE_TRANSACTIONS) {
        console.log(`🎉 Platform fee waived (${Number(txCount) + 1}/3 free transactions) for request #${requestId}`);
        return res.json({ chargeId: null, amount: 0, waived: true });
      }

      const [userRecord] = await db
        .select({ stripeCustomerId: users.stripeCustomerId, stripePaymentMethodId: users.stripePaymentMethodId })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!userRecord?.stripeCustomerId || !userRecord?.stripePaymentMethodId) {
        return res.status(400).json({ error: "No payment method on file. Please add a card in Settings." });
      }

      // Immediate capture — this is the real charge (not a hold)
      const paymentIntent = await stripe.paymentIntents.create({
        // Enforce Stripe's $0.50 minimum charge
        amount: Math.max(50, Math.round(platformFeeAmount * 100)),
        currency: "usd",
        customer: userRecord.stripeCustomerId,
        payment_method: userRecord.stripePaymentMethodId,
        confirm: true,
        off_session: true,
        metadata: {
          type: "platform_fee",
          request_id: requestId.toString(),
          user_id: req.user.id.toString(),
        },
        description: `ShareSwap platform fee for request #${requestId}`,
      });

      res.json({ chargeId: paymentIntent.id, amount: platformFeeAmount });
    } catch (error: any) {
      console.error("Error charging platform fee:", error);
      res.status(500).json({ error: "Failed to charge platform fee: " + error.message });
    }
  });

  // Capture deposit (charge for damage/non-return)
  app.post("/api/stripe/capture-deposit", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { paymentIntentId, reason, amount, requestId } = req.body;

      if (!paymentIntentId) {
        return res.status(400).json({ error: "Payment intent ID required" });
      }

      // Capture the payment (charge the customer)
      const capturedPayment = await stripe.paymentIntents.capture(paymentIntentId, {
        amount_to_capture: amount ? Math.round(amount * 100) : undefined,
      });

      // Apply deposit claimed penalty to the borrower/renter
      if (capturedPayment.status === "succeeded" && requestId) {
        try {
          const [request] = await db
            .select()
            .from(itemRequests)
            .innerJoin(items, eq(items.id, itemRequests.itemId))
            .where(eq(itemRequests.id, parseInt(requestId)))
            .limit(1);
          
          if (request) {
            await applyDepositClaimedPenalty(
              request.item_requests.requesterId,
              parseInt(requestId),
              request.items.id
            );
            console.log(`🚨 Deposit claimed penalty applied to user ${request.item_requests.requesterId}`);
          }
        } catch (penaltyError) {
          console.error("Error applying deposit claimed penalty:", penaltyError);
          // Don't fail the capture if penalty fails
        }
      }

      res.json({
        success: true,
        captured: capturedPayment.status === "succeeded",
        amount: capturedPayment.amount_received / 100,
        reason,
      });
    } catch (error: any) {
      console.error("Error capturing deposit:", error);
      res.status(500).json({ error: "Failed to capture deposit: " + error.message });
    }
  });

  // Cancel deposit hold (refund on safe return)
  app.post("/api/stripe/cancel-deposit", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { paymentIntentId } = req.body;

      if (!paymentIntentId) {
        return res.status(400).json({ error: "Payment intent ID required" });
      }

      // Cancel the payment intent (release the hold)
      const canceledPayment = await stripe.paymentIntents.cancel(paymentIntentId);

      res.json({
        success: true,
        canceled: canceledPayment.status === "canceled",
        message: "Deposit hold released successfully",
      });
    } catch (error: any) {
      console.error("Error canceling deposit:", error);
      res.status(500).json({ error: "Failed to cancel deposit: " + error.message });
    }
  });

  // =====================================
  // OPTIMAL RENTAL PRICING SUGGESTION
  // =====================================

  app.get("/api/rental-pricing-suggestion", async (req: any, res) => {
    try {
      const { category, itemValue, tier, condition } = req.query;
      const parsedValue = parseFloat(itemValue as string) || 100;
      const parsedTier = parseInt(tier as string) || 2;
      const categoryStr = (category as string) || "";
      const conditionStr = (condition as string) || "Good";

      const similarItems = await db
        .select({
          dollarsPrice: items.dollarsPrice,
          securityDeposit: items.securityDeposit,
          itemType: items.itemType,
          tier: items.tier,
          condition: items.condition,
          replacementValue: items.replacementValue,
        })
        .from(items)
        .where(
          and(
            eq(items.isRentable, true),
            eq(items.isAvailable, true),
            items.dollarsPrice ? sql`${items.dollarsPrice} IS NOT NULL AND ${items.dollarsPrice} != '0'` : sql`true`,
          )
        )
        .limit(100);

      const sameCategoryItems = similarItems.filter(
        (i) => i.itemType === categoryStr && i.dollarsPrice && parseFloat(i.dollarsPrice) > 0
      );
      const sameTierItems = similarItems.filter(
        (i) => i.tier === parsedTier && i.dollarsPrice && parseFloat(i.dollarsPrice) > 0
      );

      const rentalDemand = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .where(eq(itemRequests.requestType, "RENT"));
      const totalRentalRequests = Number(rentalDemand[0]?.count) || 0;

      const wishlistDemand = await db
        .select({ count: sql<number>`count(*)` })
        .from(wishlists)
        .where(
          and(
            eq(wishlists.isActive, true),
            sql`${wishlists.needType} LIKE '%rent%'`,
          )
        );
      const rentWishlistCount = Number(wishlistDemand[0]?.count) || 0;

      const categoryWishlistDemand = categoryStr ? await db
        .select({ count: sql<number>`count(*)` })
        .from(wishlists)
        .where(
          and(
            eq(wishlists.isActive, true),
            eq(wishlists.category, categoryStr),
          )
        ) : [{ count: 0 }];
      const categoryWishlistCount = Number(categoryWishlistDemand[0]?.count) || 0;

      const totalRentableItems = similarItems.length;

      let demandLevel: "low" | "moderate" | "high" = "moderate";
      let demandMultiplier = 1.0;

      if (totalRentableItems > 0) {
        const requestToSupplyRatio = totalRentalRequests / Math.max(1, totalRentableItems);
        if (requestToSupplyRatio > 2 || categoryWishlistCount >= 3) {
          demandLevel = "high";
          demandMultiplier = 1.15;
        } else if (requestToSupplyRatio < 0.5 && categoryWishlistCount === 0) {
          demandLevel = "low";
          demandMultiplier = 0.90;
        }
      }

      if (categoryWishlistCount >= 5) {
        demandLevel = "high";
        demandMultiplier = Math.max(demandMultiplier, 1.20);
      }

      const CATEGORY_RATES: Record<string, number> = {
        "Baby & Kids": 0.05,
        "Electronics": 0.07,
        "Tools & Equipment": 0.06,
        "Home & Kitchen": 0.05,
        "Clothing & Accessories": 0.08,
        "Hobbies & Collectibles": 0.04,
      };

      const TIER_DEPOSIT_PCT: Record<number, number> = {
        1: 0.25,
        2: 0.30,
        3: 0.35,
        4: 0.40,
      };

      const baseRate = CATEGORY_RATES[categoryStr] || 0.05;
      let suggestedWeeklyRate = Math.max(3, Math.round(parsedValue * baseRate));
      const baseDeposit = TIER_DEPOSIT_PCT[parsedTier] || 0.30;
      let suggestedDeposit = Math.max(10, Math.round(parsedValue * baseDeposit));

      let marketAvgRate: number | null = null;
      let marketAvgDeposit: number | null = null;
      const dataSource: string[] = [];

      if (sameCategoryItems.length >= 2) {
        const rates = sameCategoryItems.map((i) => parseFloat(i.dollarsPrice!));
        marketAvgRate = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
        const deposits = sameCategoryItems
          .filter((i) => i.securityDeposit && parseFloat(i.securityDeposit) > 0)
          .map((i) => parseFloat(i.securityDeposit!));
        if (deposits.length > 0) {
          marketAvgDeposit = Math.round(deposits.reduce((a, b) => a + b, 0) / deposits.length);
        }
        dataSource.push(`${sameCategoryItems.length} similar ${categoryStr} listings`);
      } else if (sameTierItems.length >= 2) {
        const rates = sameTierItems.map((i) => parseFloat(i.dollarsPrice!));
        marketAvgRate = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
        dataSource.push(`${sameTierItems.length} items in the same value tier`);
      }

      if (marketAvgRate !== null) {
        suggestedWeeklyRate = Math.round((suggestedWeeklyRate * 0.6 + marketAvgRate * 0.4));
        dataSource.push("blended with category base rate");
      }

      suggestedWeeklyRate = Math.max(3, Math.round(suggestedWeeklyRate * demandMultiplier));

      if (conditionStr === "Like New" || conditionStr === "New") {
        suggestedWeeklyRate = Math.round(suggestedWeeklyRate * 1.10);
      } else if (conditionStr === "Fair" || conditionStr === "Well Loved") {
        suggestedWeeklyRate = Math.round(suggestedWeeklyRate * 0.85);
      }

      if (marketAvgDeposit !== null) {
        suggestedDeposit = Math.round((suggestedDeposit * 0.7 + marketAvgDeposit * 0.3));
      }

      const reasoning: string[] = [];
      reasoning.push(`Based on ${baseRate * 100}% weekly rate for ${categoryStr || "general"} items`);
      if (dataSource.length > 0) reasoning.push(`Market data: ${dataSource.join(", ")}`);
      if (demandLevel === "high") reasoning.push("High demand in this category (+15% boost)");
      if (demandLevel === "low") reasoning.push("Lower demand (-10% adjustment)");
      if (conditionStr === "Like New" || conditionStr === "New") reasoning.push("Premium condition (+10%)");
      if (conditionStr === "Fair" || conditionStr === "Well Loved") reasoning.push("Condition adjustment (-15%)");

      res.json({
        suggestedWeeklyRate,
        suggestedDeposit,
        demandLevel,
        demandSignals: {
          totalRentalRequests,
          rentWishlistCount,
          categoryWishlistCount,
          totalRentableItems,
        },
        marketData: {
          sameCategoryCount: sameCategoryItems.length,
          sameTierCount: sameTierItems.length,
          marketAvgRate,
          marketAvgDeposit,
        },
        reasoning,
        itemValue: parsedValue,
      });
    } catch (error) {
      console.error("Error calculating rental pricing suggestion:", error);
      res.status(500).json({ error: "Failed to calculate pricing suggestion" });
    }
  });

  // =====================================
  // RENTAL BALANCE & PAYOUT ENDPOINTS
  // =====================================

  // Get user's rental balance and payout history
  app.get("/api/rental-balance", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Get user's balance
      const [user] = await db
        .select({
          rentalBalance: users.rentalBalance,
          pendingRentalBalance: users.pendingRentalBalance,
          stripeConnectedAccountId: users.stripeConnectedAccountId,
        })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      // Get recent payout history
      const payouts = await db
        .select({
          id: rentalPayouts.id,
          requestId: rentalPayouts.requestId,
          amount: rentalPayouts.amount,
          rentalAmount: rentalPayouts.rentalAmount,
          platformFee: rentalPayouts.platformFee,
          processingFee: rentalPayouts.processingFee,
          netAmount: rentalPayouts.netAmount,
          status: rentalPayouts.status,
          disputeStatus: rentalPayouts.disputeStatus,
          releasedAt: rentalPayouts.releasedAt,
          paidOutAt: rentalPayouts.paidOutAt,
          createdAt: rentalPayouts.createdAt,
        })
        .from(rentalPayouts)
        .where(eq(rentalPayouts.userId, req.user.id))
        .orderBy(desc(rentalPayouts.createdAt))
        .limit(50);

      res.json({
        balance: {
          available: parseFloat(user?.rentalBalance || "0"),
          pending: parseFloat(user?.pendingRentalBalance || "0"),
          total: parseFloat(user?.rentalBalance || "0") + parseFloat(user?.pendingRentalBalance || "0"),
        },
        hasConnectedAccount: !!user?.stripeConnectedAccountId,
        payouts,
      });
    } catch (error: any) {
      console.error("Error fetching rental balance:", error);
      res.status(500).json({ error: "Failed to fetch balance" });
    }
  });

  // Request payout to bank account
  app.post("/api/rental-balance/payout", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { amount } = req.body;

      // Get user's balance
      const [user] = await db
        .select({
          rentalBalance: users.rentalBalance,
          stripeConnectedAccountId: users.stripeConnectedAccountId,
          email: users.username,
        })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      const availableBalance = parseFloat(user?.rentalBalance || "0");
      const requestedAmount = parseFloat(amount);

      if (requestedAmount <= 0) {
        return res.status(400).json({ error: "Invalid payout amount" });
      }

      if (requestedAmount > availableBalance) {
        return res.status(400).json({ error: "Insufficient balance" });
      }

      // Minimum payout amount
      if (requestedAmount < 10) {
        return res.status(400).json({ error: "Minimum payout amount is $10" });
      }

      // Verify user has set up a payout method (bank account via Stripe Connect)
      if (!user?.stripeConnectedAccountId) {
        return res.status(400).json({ 
          error: "Please set up your payout method first",
          code: "NO_PAYOUT_METHOD"
        });
      }

      // Create real Stripe transfer to connected account
      const transfer = await stripe.transfers.create({
        amount: Math.round(requestedAmount * 100), // cents
        currency: 'cad',
        destination: user.stripeConnectedAccountId,
        description: `ShareSwap payout ${new Date().toISOString().split('T')[0]}`,
      });

      // Deduct from balance
      await db
        .update(users)
        .set({ rentalBalance: sql`${users.rentalBalance} - ${requestedAmount}` })
        .where(eq(users.id, req.user.id));

      // Create payout tracking record
      const [payoutRecord] = await db.insert(rentalPayouts).values({
        userId: req.user.id,
        requestId: null,
        amount: requestedAmount.toString(),
        rentalAmount: requestedAmount.toString(),
        platformFee: "0",
        processingFee: "0",
        netAmount: requestedAmount.toString(),
        status: 'paid_out',
        paidOutAt: new Date(),
      }).returning();

      // Notify owner
      await db.insert(notifications).values({
        userId: req.user.id,
        type: "payment_received",
        title: "Payout Sent",
        message: `$${requestedAmount.toFixed(2)} is on its way — arrives in 2–5 business days.`,
        isRead: false,
      });
      sendPushToUser(req.user.id, {
        title: "Payout Sent",
        body: `$${requestedAmount.toFixed(2)} is on its way — arrives in 2–5 business days.`,
        data: { screen: "notifications" },
      }, "payments").catch(() => {});

      res.json({
        success: true,
        message: `$${requestedAmount.toFixed(2)} payout initiated. Funds arrive in 2–5 business days.`,
        payout: {
          id: payoutRecord.id,
          amount: requestedAmount,
          status: 'paid_out',
          stripeTransferId: transfer.id,
          estimatedArrival: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
        },
      });
    } catch (error: any) {
      console.error("Error processing payout:", error);
      res.status(500).json({ error: "Failed to process payout" });
    }
  });

  // ── Stripe Connect Express ────────────────────────────────────────────────────

  // Create/retrieve a Connect Express account and return the hosted onboarding URL
  app.post("/api/stripe/connect/onboard", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const [user] = await db
        .select({ stripeConnectedAccountId: users.stripeConnectedAccountId, email: users.username, displayName: users.displayName })
        .from(users).where(eq(users.id, req.user.id)).limit(1);

      let accountId = user?.stripeConnectedAccountId;

      if (!accountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          country: 'CA',
          email: user?.email || undefined,
          capabilities: { transfers: { requested: true } },
          business_type: 'individual',
          settings: { payouts: { schedule: { interval: 'manual' } } },
        });
        accountId = account.id;
        await db.update(users).set({ stripeConnectedAccountId: accountId }).where(eq(users.id, req.user.id));
      }

      const origin = `${req.protocol}://${req.get('host')}`;
      // Mobile app passes its own deep-link URLs; web falls back to origin-relative paths
      const returnUrl = req.body.returnUrl || `${origin}/my-balance?connected=true`;
      const refreshUrl = req.body.refreshUrl || `${origin}/my-balance?reconnect=true`;
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });

      res.json({ url: accountLink.url });
    } catch (error: any) {
      console.error("Error creating Stripe Connect onboarding link:", error);
      // Stripe Connect not enabled on this platform account
      if (error?.message?.includes('signed up for Connect') || error?.code === 'connect_not_enabled') {
        return res.status(503).json({
          error: "CONNECT_NOT_ENABLED",
          message: "Stripe Connect is not yet enabled on this account. An admin must enable it at https://dashboard.stripe.com/connect",
        });
      }
      res.status(500).json({ error: "Failed to start payout setup: " + error.message });
    }
  });

  // Check Stripe Connect account status
  app.get("/api/stripe/connect/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const [user] = await db
        .select({ stripeConnectedAccountId: users.stripeConnectedAccountId })
        .from(users).where(eq(users.id, req.user.id)).limit(1);

      if (!user?.stripeConnectedAccountId) {
        return res.json({ connected: false, payoutsEnabled: false, detailsSubmitted: false });
      }

      try {
        const account = await stripe.accounts.retrieve(user.stripeConnectedAccountId);
        res.json({
          connected: true,
          payoutsEnabled: account.payouts_enabled,
          chargesEnabled: account.charges_enabled,
          detailsSubmitted: account.details_submitted,
          accountId: account.id,
        });
      } catch (stripeErr: any) {
        if (stripeErr?.code === 'resource_missing') {
          await db.update(users).set({ stripeConnectedAccountId: null }).where(eq(users.id, req.user.id));
          return res.json({ connected: false, payoutsEnabled: false, detailsSubmitted: false });
        }
        throw stripeErr;
      }
    } catch (error: any) {
      console.error("Error fetching Stripe Connect status:", error);
      res.status(500).json({ error: "Failed to fetch payout account status" });
    }
  });

  // =====================================
  // RENTAL TRANSACTION LIFECYCLE ENDPOINTS
  // =====================================

  // Create rental payment hold (deposit + rental fee authorization)
  app.post("/api/rentals/create-payment-hold", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { requestId, depositAmount, rentalAmount, processingFee, platformFee, confirmIfSaved } = req.body;

      if (!requestId || !depositAmount || depositAmount <= 0) {
        return res.status(400).json({ error: "Invalid request parameters" });
      }

      // Verify request belongs to this user and is in ACCEPTED state
      const [request] = await db
        .select()
        .from(itemRequests)
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request || request.requesterId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      if (request.status !== "ACCEPTED") {
        return res.status(400).json({ error: "Request is not in accepted state" });
      }

      // Collect full rental + deposit + fees in one charge.
      // Rental is transferred to owner after handoff; deposit is refunded on safe return.
      const totalChargeAmount = (rentalAmount || 0) + depositAmount + (processingFee || 0);

      // Look up user's saved payment method from verification
      const [userRecord] = await db
        .select({ stripeCustomerId: users.stripeCustomerId, stripePaymentMethodId: users.stripePaymentMethodId })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      const hasSavedCard = !!(userRecord?.stripeCustomerId && userRecord?.stripePaymentMethodId);

      const paymentIntentParams: any = {
        amount: Math.round(totalChargeAmount * 100),
        currency: "usd",
        capture_method: "automatic",
        metadata: {
          type: "rental_payment",
          requestId: requestId.toString(),
          userId: req.user.id.toString(),
          depositAmount: depositAmount.toString(),
          rentalAmount: (rentalAmount || 0).toString(),
          processingFee: (processingFee || 0).toString(),
          platformFee: (platformFee || 0).toString(),
        },
      };

      // Attach saved card — user won't need to enter card details
      if (hasSavedCard) {
        paymentIntentParams.customer = userRecord.stripeCustomerId;
        paymentIntentParams.payment_method = userRecord.stripePaymentMethodId;
        // Native app path: confirm immediately off-session so no Stripe UI is needed.
        if (confirmIfSaved) {
          paymentIntentParams.confirm = true;
          paymentIntentParams.off_session = true;
        }
      }

      const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);
      const alreadyConfirmed =
        hasSavedCard &&
        !!confirmIfSaved &&
        (paymentIntent.status === "succeeded" || paymentIntent.status === "requires_capture");

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        hasSavedCard,
        alreadyConfirmed,
        depositAmount,
        rentalAmount,
        totalHoldAmount: totalChargeAmount,
      });
    } catch (error: any) {
      console.error("Error creating rental payment hold:", error);
      res.status(500).json({ error: "Failed to create rental payment: " + error.message });
    }
  });

  // Confirm rental deposit payment
  app.post("/api/requests/:requestId/confirm-rental-deposit", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      const { paymentIntentId, depositAmount, rentalAmount, processingFee, platformFee } = req.body;

      if (!paymentIntentId) {
        return res.status(400).json({ error: "Payment intent ID is required" });
      }

      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      if (request.item_requests.requesterId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      if (request.item_requests.status !== "ACCEPTED") {
        return res.status(400).json({ error: "Request is not in accepted state" });
      }

      // Verify the PaymentIntent with Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      // Verify payment intent is in the correct state (succeeded = charged, or requires_capture = legacy manual hold)
      if (paymentIntent.status !== "succeeded" && paymentIntent.status !== "requires_capture") {
        return res.status(400).json({ 
          error: "Payment has not been completed correctly",
          status: paymentIntent.status
        });
      }

      // Verify the payment intent belongs to this request
      if (paymentIntent.metadata.requestId !== requestId.toString()) {
        return res.status(400).json({ error: "Payment intent does not match this request" });
      }

      // Verify the payment intent belongs to this user
      if (paymentIntent.metadata.userId !== req.user.id.toString()) {
        return res.status(403).json({ error: "Payment intent does not belong to this user" });
      }

      // Update request with rental deposit info
      const [updated] = await db
        .update(itemRequests)
        .set({
          status: "DEPOSIT_CONFIRMED",
          depositPaymentIntentId: paymentIntentId,
          trustDepositAmount: depositAmount?.toString(),
          depositStatus: "authorized",
          depositAuthorizedAt: new Date(),
          rentalAmount: rentalAmount?.toString(),
          rentalProcessingFee: processingFee?.toString(),
          rentalPlatformFee: platformFee?.toString(),
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      // Create escrow record for rental earnings (held until return confirmed).
      // Commission split: 5% to platform Stripe account, 95% to owner pending balance.
      // First 3 transactions per requester are free — owner receives 100%.
      // The Stripe processing fee (~2.9% + $0.30) is absorbed by the platform from its 5% cut,
      // so it is never deducted from the owner's share.
      if (rentalAmount && rentalAmount > 0) {
        const actualRentalAmount = parseFloat(rentalAmount);
        const [{ count: rentalTxCount }] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(itemRequests)
          .where(and(
            eq(itemRequests.requesterId, request.item_requests.requesterId),
            inArray(itemRequests.status, ["ACTIVE", "RETURNED", "COMPLETED"]),
          ));
        // Check renter's subscription tier — Pro gets reduced 2% platform fee
        const [renterSubRecord] = await db
          .select({ subscriptionTier: users.subscriptionTier })
          .from(users)
          .where(eq(users.id, request.item_requests.requesterId))
          .limit(1);
        const renterTier = (renterSubRecord as any)?.subscriptionTier || 'free';
        const commissionRate = renterTier === 'pro' ? 0.04 : 0.05;

        const freeCommissionPeriod = Number(rentalTxCount) < 3;
        const actualPlatformFee = freeCommissionPeriod
          ? 0                                    // free period — no platform cut
          : parseFloat((actualRentalAmount * commissionRate).toFixed(2));
        const netAmount = parseFloat((actualRentalAmount - actualPlatformFee).toFixed(2));

        if (freeCommissionPeriod) {
          console.log(`🎉 Platform fee waived (first 3 transactions free) — owner receives full $${netAmount.toFixed(2)}`);
        } else {
          console.log(`💰 Platform fee $${actualPlatformFee.toFixed(2)} (${renterTier === 'pro' ? '2% Pro rate' : '5% standard'}) — owner receives $${netAmount.toFixed(2)}`);
        }

        // Create held payout record for the owner
        await db.insert(rentalPayouts).values({
          userId: request.items.ownerId!,
          requestId: requestId,
          amount: actualRentalAmount.toString(),
          rentalAmount: actualRentalAmount.toString(),
          platformFee: actualPlatformFee.toFixed(2),
          processingFee: "0.00",
          netAmount: netAmount.toFixed(2),
          status: 'held',
          stripePaymentIntentId: paymentIntentId,
          holdUntil: request.item_requests.endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Add to owner's pending balance
        await db
          .update(users)
          .set({
            pendingRentalBalance: sql`COALESCE(${users.pendingRentalBalance}, 0) + ${netAmount.toFixed(2)}`,
          })
          .where(eq(users.id, request.items.ownerId!));

        console.log(`Created escrow for $${netAmount.toFixed(2)} rental earnings (held until return) for owner ${request.items.ownerId}`);
      }

      // Notify both parties that the deposit authorization is in place
      await db.insert(messages).values({
        content: "🔒 Security deposit authorized — your card is not charged unless damage is reported.",
        senderId: request.items.ownerId!,
        receiverId: request.item_requests.requesterId,
        messageType: "system",
        requestId,
      });

      res.json({
        success: true,
        request: updated,
        nextStep: "await_handoff",
        message: "Rental deposit authorized successfully. Payment secured.",
      });
    } catch (error: any) {
      console.error("Error confirming rental deposit:", error);
      res.status(500).json({ error: "Failed to confirm rental deposit" });
    }
  });

  // =====================================
  // BORROW TRANSACTION LIFECYCLE ENDPOINTS
  // =====================================

  // Get request details for deposit modal (after acceptance)
  app.get("/api/requests/:requestId/deposit-details", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      
      const [request] = await db
        .select({
          request: itemRequests,
          item: items,
          requester: {
            id: users.id,
            username: users.username,
            reputationScore: users.reputationScore,
          },
        })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .innerJoin(users, eq(users.id, itemRequests.requesterId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      // Check if user is the requester
      if (request.request.requesterId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Calculate trust score based on reputation
      const reputationScore = request.requester.reputationScore || 0;
      const trustScore = Math.min(100, Math.round((reputationScore / 500) * 100) + 50);
      
      res.json({
        request: request.request,
        item: request.item,
        trustScore,
        deliveryMethod: request.request.deliveryMethod,
        depositMethod: request.request.depositMethod,
      });
    } catch (error: any) {
      console.error("Error fetching deposit details:", error);
      res.status(500).json({ error: "Failed to fetch deposit details" });
    }
  });

  // Pay trust deposit (step 1 after acceptance)
  app.post("/api/requests/:requestId/pay-deposit", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      const { 
        depositAmount, 
        baseDepositAmount, 
        discountPercentage, 
        trustScore,
        paymentIntentId,
        platformFeeChargeId,
        shareCoinAmount 
      } = req.body;
      
      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      // Must be the requester
      if (request.item_requests.requesterId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Request must be ACCEPTED
      if (request.item_requests.status !== "ACCEPTED") {
        return res.status(400).json({ error: "Request must be accepted before paying deposit" });
      }

      // For BORROW requests, verify the requester has enough ShareCoins
      if (request.item_requests.requestType === "BORROW" && shareCoinAmount) {
        const [requester] = await db
          .select({ shareCoins: users.shareCoins })
          .from(users)
          .where(eq(users.id, req.user.id))
          .limit(1);
        const balance = parseFloat(requester?.shareCoins ?? "0");
        const required = parseFloat(shareCoinAmount);
        if (balance < required) {
          return res.status(400).json({
            error: "insufficient_sharecoins",
            message: `You need ${required} ShareCoins but only have ${Math.floor(balance)}.`,
            required,
            balance: Math.floor(balance),
          });
        }
      }

      // Update request with deposit info
      const [updated] = await db
        .update(itemRequests)
        .set({
          status: "DEPOSIT_CONFIRMED",
          trustDepositAmount: depositAmount.toString(),
          trustDepositBaseAmount: baseDepositAmount?.toString(),
          trustDiscountPercentage: discountPercentage,
          requesterTrustScoreSnapshot: trustScore,
          depositStatus: "authorized",
          depositPaymentIntentId: paymentIntentId,
          depositAuthorizedAt: new Date(),
          platformFeeChargeId: platformFeeChargeId ?? null,
          shareCoinAmount: shareCoinAmount?.toString(),
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      // Notify both parties that the deposit authorization is in place (only for in-app Stripe holds)
      if (paymentIntentId) {
        await db.insert(messages).values({
          content: "🔒 Security deposit authorized — your card is not charged unless damage is reported.",
          senderId: request.items.ownerId!,
          receiverId: request.item_requests.requesterId,
          messageType: "system",
          requestId,
        });
      }

      res.json({
        success: true,
        request: updated,
        nextStep: "await_handoff",
      });
    } catch (error: any) {
      console.error("Error processing deposit payment:", error);
      res.status(500).json({ error: "Failed to process deposit payment" });
    }
  });

  // Requester withdraws their own PENDING offer (e.g. wrong terms) so they can resend
  app.post("/api/requests/:requestId/withdraw", csrfProtection, async (req: any, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const requestId = parseInt(req.params.requestId);
      const [row] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Request not found" });
      if (row.item_requests.requesterId !== req.user.id)
        return res.status(403).json({ error: "Only the requester can withdraw an offer" });
      if (row.item_requests.status !== "PENDING")
        return res.status(400).json({ error: "Can only withdraw pending offers" });

      const [updated] = await db
        .update(itemRequests)
        .set({ status: "CANCELLED" })
        .where(eq(itemRequests.id, requestId))
        .returning();

      // Notify the owner
      await db.insert(notifications).values({
        userId: row.items.ownerId,
        type: "request_withdrawn" as any,
        title: "Offer Withdrawn",
        message: `${(req.user as any).displayName || req.user.username} withdrew their offer for "${row.items.name}".`,
        itemId: row.items.id,
        requestId,
      });

      await logRequestEvent(req.user.id, row.items.ownerId, requestId, "request_cancelled", {
        cancelledByRole: "requester",
        itemName: row.items.name,
      });

      return res.json({
        success: true,
        request: updated,
        prefill: {
          itemId: row.items.id,
          requestType: row.item_requests.requestType,
          startDate: row.item_requests.startDate,
          endDate: row.item_requests.endDate,
          deliveryMethod: row.item_requests.deliveryMethod,
          depositMethod: row.item_requests.depositMethod,
        },
      });
    } catch (err: any) {
      console.error("Error withdrawing request:", err);
      return res.status(500).json({ error: "Failed to withdraw offer" });
    }
  });

  app.post("/api/requests/:requestId/cancel", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      const { reason } = req.body;
      
      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      // Check if user is involved in this request
      const isOwner = request.items.ownerId === req.user.id;
      const isRequester = request.item_requests.requesterId === req.user.id;
      
      if (!isOwner && !isRequester) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Can only cancel if pre-handoff
      const cancelableStatuses = ["PENDING", "ACCEPTED", "DEPOSIT_CONFIRMED", "HANDOFF_CONFIRMED"];
      if (!cancelableStatuses.includes(request.item_requests.status)) {
        return res.status(400).json({ 
          error: "Cannot cancel request in current status",
          currentStatus: request.item_requests.status
        });
      }

      // Release any held deposit via Stripe before cancelling
      if (request.item_requests.depositPaymentIntentId) {
        try {
          await stripe.paymentIntents.cancel(request.item_requests.depositPaymentIntentId);
        } catch (stripeError: any) {
          console.error("Error releasing deposit on cancel:", stripeError);
          // Continue with cancellation even if Stripe fails
        }
      }

      // Update request status to CANCELLED
      const [updated] = await db
        .update(itemRequests)
        .set({
          status: "CANCELLED",
          depositStatus: request.item_requests.depositPaymentIntentId ? "released" : null,
          depositReleasedAt: request.item_requests.depositPaymentIntentId ? new Date() : null,
          // Keep the cancelled thread in the active inbox until the other
          // party reads the cancellation event.
          unarchivedAt: new Date(),
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      // Make item available again
      await db
        .update(items)
        .set({ isAvailable: true, updatedAt: new Date() })
        .where(eq(items.id, request.items.id));
      notifyAvailabilitySubscribers(request.items.id, request.items.name).catch(() => {});

      // Void any held rental payout for this request and reverse the owner's pending balance
      if (request.item_requests.requestType === "RENT") {
        const [heldPayout] = await db
          .select({ id: rentalPayouts.id, netAmount: rentalPayouts.netAmount, userId: rentalPayouts.userId })
          .from(rentalPayouts)
          .where(and(eq(rentalPayouts.requestId, requestId), eq(rentalPayouts.status, "held")))
          .limit(1);

        if (heldPayout) {
          await db
            .update(rentalPayouts)
            .set({ status: "cancelled" })
            .where(eq(rentalPayouts.id, heldPayout.id));

          const reverseAmount = parseFloat(heldPayout.netAmount || "0");
          if (reverseAmount > 0) {
            await db
              .update(users)
              .set({
                pendingRentalBalance: sql`GREATEST(0, COALESCE(${users.pendingRentalBalance}, 0) - ${reverseAmount})`,
              })
              .where(eq(users.id, heldPayout.userId));
          }
          console.log(`Cancelled rental payout of $${reverseAmount.toFixed(2)} for request ${requestId}`);
        }
      }

      const otherPartyId = isOwner ? request.item_requests.requesterId : request.items.ownerId;
      await logRequestEvent(req.user.id, otherPartyId, requestId, "request_cancelled", {
        cancelledByRole: isOwner ? "owner" : "requester",
        itemName: request.items.name,
      });

      const cancelledByLabel = isOwner ? "The owner" : "The borrower";
      await db.insert(notifications).values({
        userId: otherPartyId,
        type: "request_cancelled",
        title: "Request Cancelled",
        message: `"${request.items.name}" — ${cancelledByLabel.toLowerCase()} cancelled the request.`,
        itemId: request.items.id,
        requestId,
        isRead: false,
      });
      sendPushToUser(otherPartyId, {
        title: "Request Cancelled",
        body: `"${request.items.name}" — ${cancelledByLabel.toLowerCase()} cancelled the request.`,
        data: { screen: "chat", chatUserId: req.user.id, requestId, itemId: request.items.id },
      }, "requests").catch(() => {});

      // If a Stripe deposit was held, confirm its release in the chat
      if (request.item_requests.depositPaymentIntentId && request.item_requests.depositMethod !== "in_person") {
        await db.insert(messages).values({
          content: "🔒 Security deposit hold has been lifted — nothing was charged.",
          senderId: request.items.ownerId!,
          receiverId: request.item_requests.requesterId,
          messageType: "system",
          requestId,
        });
      }

      // Apply cancellation penalty to the cancelling user (with grace pass for first offense)
      // Exception: giver cancelling their own gift is not penalised (they're doing a favour)
      const isGiftGiverCancelling = request.item_requests.requestType === "GIFT" && isOwner;
      let penaltyResult = { applied: false, wasGracePass: false };
      if (!isGiftGiverCancelling) {
        try {
          penaltyResult = await applyCancellationPenalty(
            req.user.id,
            requestId,
            request.items.id
          );
        } catch (penaltyError) {
          console.error("Error applying cancellation penalty:", penaltyError);
        }
      }

      res.json({
        success: true,
        request: updated,
        depositReleased: !!request.item_requests.depositPaymentIntentId,
        message: isGiftGiverCancelling
          ? "Gift cancelled. Your item is available again."
          : penaltyResult.wasGracePass 
            ? "Request cancelled. This is your first cancellation - no penalty applied, but future cancellations will affect your trust score."
            : penaltyResult.applied 
              ? "Request cancelled. A trust score penalty has been applied."
              : "Request cancelled successfully.",
      });
    } catch (error: any) {
      console.error("Error cancelling request:", error);
      res.status(500).json({ error: "Failed to cancel request" });
    }
  });

  // Report no-show (missed pickup window - applies penalty with grace pass)
  app.post("/api/requests/:requestId/report-no-show", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      const { reportedUserId, description } = req.body;
      
      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      // Check if reporter is involved in this request
      const isOwner = request.items.ownerId === req.user.id;
      const isRequester = request.item_requests.requesterId === req.user.id;
      
      if (!isOwner && !isRequester) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Can't report yourself
      if (reportedUserId === req.user.id) {
        return res.status(400).json({ error: "Cannot report yourself" });
      }

      // Verify the reported user is involved in this request
      if (reportedUserId !== request.items.ownerId && reportedUserId !== request.item_requests.requesterId) {
        return res.status(400).json({ error: "Reported user is not part of this transaction" });
      }

      // Only apply no-show penalty to valid statuses
      const noShowStatuses = ["DEPOSIT_CONFIRMED", "HANDOFF_CONFIRMED"];
      if (!noShowStatuses.includes(request.item_requests.status)) {
        return res.status(400).json({ 
          error: "Cannot report no-show in current status",
          currentStatus: request.item_requests.status
        });
      }

      // No-show acknowledged but not logged or penalized (minor violations removed)
      res.json({
        success: true,
        message: "No-show reported.",
      });
    } catch (error: any) {
      console.error("Error reporting no-show:", error);
      res.status(500).json({ error: "Failed to report no-show" });
    }
  });

  // ── ShareCoin borrow-cost helper ───────────────────────────────────────────
  // end date = return day (not last usage day), so usage days = end - start (no +1)
  // Formula: round( (weeklyPrice / 7) × days )
  // e.g. 10 SC/week item borrowed start=Mon, return=Fri → 4 usage days → round(10/7 × 4) = 6 SC
  function calcBorrowShareCoinCost(
    shareCoinPrice: number,
    startDate: Date | string | null | undefined,
    endDate: Date | string | null | undefined,
  ): number {
    if (!startDate || !endDate || shareCoinPrice <= 0) return Math.max(1, shareCoinPrice);
    const start = new Date(startDate);
    const end = new Date(endDate);
    const borrowDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
    return Math.max(1, Math.round((shareCoinPrice / 7) * borrowDays));
  }

  // Confirm handoff (item exchanged - charges ShareCoins, starts borrow period)
  app.post("/api/requests/:requestId/handoff", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      const { confirmedBy } = req.body; // 'owner' or 'borrower'
      
      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      // Check authorization (either owner or requester can confirm)
      const isOwner = request.items.ownerId === req.user.id;
      const isRequester = request.item_requests.requesterId === req.user.id;
      
      if (!isOwner && !isRequester) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Validate status (must be DEPOSIT_CONFIRMED or AWAITING_HANDOFF_CONFIRM)
      // SWAP requests and BORROW+in_person-deposit requests skip the in-app deposit step so they
      // may arrive here from ACCEPTED directly (legacy rows before auto-advance was introduced).
      const isSwapRequest = request.item_requests.requestType === "SWAP";
      const isInPersonBorrowDeposit =
        request.item_requests.requestType === "BORROW" &&
        request.item_requests.depositMethod === "in_person";
      const validStatuses = ["DEPOSIT_CONFIRMED", "AWAITING_HANDOFF_CONFIRM"];
      const acceptedStatusOk = (isSwapRequest || isInPersonBorrowDeposit) && request.item_requests.status === "ACCEPTED";
      if (!validStatuses.includes(request.item_requests.status) && !acceptedStatusOk) {
        return res.status(400).json({ error: "Request is not ready for handoff" });
      }

      const now = new Date();
      const CONFIRMATION_DEADLINE_HOURS = 24;
      const deadline = new Date(now.getTime() + CONFIRMATION_DEADLINE_HOURS * 60 * 60 * 1000);
      
      // Determine which party is confirming
      const ownerAlreadyConfirmed = request.item_requests.ownerConfirmedHandoff;
      const borrowerAlreadyConfirmed = request.item_requests.borrowerConfirmedHandoff;
      const ownerAlreadyDenied = (request.item_requests as any).ownerDeniedHandoff;
      const borrowerAlreadyDenied = (request.item_requests as any).borrowerDeniedHandoff;
      
      let updateData: any = {};
      let waitingMessage = "";
      let bothConfirmed = false;
      let disputeTriggered = false;

      if (isOwner && !ownerAlreadyConfirmed) {
        updateData.ownerConfirmedHandoff = true;
        updateData.ownerConfirmedHandoffAt = now;
        
        if (borrowerAlreadyDenied) {
          // Case 5: Owner confirms, borrower already denied → immediate dispute
          disputeTriggered = true;
          updateData.handoffDisputeTriggered = true;
          updateData.handoffDisputeAt = now;
          updateData.handoffProofDeadline = deadline;
          updateData.status = "HANDOFF_DISPUTED";
        } else if (borrowerAlreadyConfirmed) {
          bothConfirmed = true;
        } else {
          updateData.status = "AWAITING_HANDOFF_CONFIRM";
          updateData.handoffConfirmDeadline = deadline;
          updateData.handoffRemindersLevel = 0;
          waitingMessage = `You've confirmed handoff. Waiting for borrower to confirm (${CONFIRMATION_DEADLINE_HOURS}h deadline).`;
        }
      } else if (isRequester && !borrowerAlreadyConfirmed) {
        updateData.borrowerConfirmedHandoff = true;
        updateData.borrowerConfirmedHandoffAt = now;
        
        if (ownerAlreadyDenied) {
          // Case 5: Borrower confirms, owner already denied → immediate dispute
          disputeTriggered = true;
          updateData.handoffDisputeTriggered = true;
          updateData.handoffDisputeAt = now;
          updateData.handoffProofDeadline = deadline;
          updateData.status = "HANDOFF_DISPUTED";
        } else if (ownerAlreadyConfirmed) {
          bothConfirmed = true;
        } else {
          updateData.status = "AWAITING_HANDOFF_CONFIRM";
          updateData.handoffConfirmDeadline = deadline;
          updateData.handoffRemindersLevel = 0;
          waitingMessage = `You've confirmed received. Waiting for owner to confirm (${CONFIRMATION_DEADLINE_HOURS}h deadline).`;
        }
      } else {
        return res.status(400).json({ error: "You have already confirmed the handoff" });
      }

      // If both parties have now confirmed, complete the handoff
      if (bothConfirmed) {
        // Charge ShareCoins from borrower (only for BORROW type)
        // Use counter-proposed dates if present — they are the agreed-upon dates after negotiation
        const effectiveStart1 = request.item_requests.counterStartDate || request.item_requests.startDate;
        const effectiveEnd1   = request.item_requests.counterEndDate   || request.item_requests.endDate;
        // ShareCoin amount is always based on the original booked period — never adjusted for early/late handoff
        const shareCoinAmount = request.item_requests.requestType === "BORROW"
          ? calcBorrowShareCoinCost(
              parseFloat(request.items.shareCoinPrice || "0"),
              effectiveStart1,
              effectiveEnd1,
            )
          : parseFloat(request.item_requests.shareCoinAmount || request.items.shareCoinPrice || "0");
        
        if (shareCoinAmount > 0 && request.item_requests.requestType === "BORROW") {
          const [borrower] = await db
            .select({ shareCoins: users.shareCoins })
            .from(users)
            .where(eq(users.id, request.item_requests.requesterId))
            .limit(1);

          const currentBalance = Math.floor(parseFloat(borrower?.shareCoins || "0"));
          const charged = Math.min(shareCoinAmount, Math.max(currentBalance, 0));

          // Deduct ShareCoins from borrower (charge what they have, at most the full amount)
          await db
            .update(users)
            .set({ shareCoins: (currentBalance - charged).toString() })
            .where(eq(users.id, request.item_requests.requesterId));

          // Record the transaction
          await db.insert(shareCoinsTransactions).values({
            userId: request.item_requests.requesterId,
            amount: (-charged).toString(),
            description: `Borrowed: ${request.items.name}`,
            transactionType: "BORROW_CHARGE",
          });

          // Award ShareCoins to lender
          if (request.items.ownerId && charged > 0) {
            const [lender] = await db
              .select({ shareCoins: users.shareCoins })
              .from(users)
              .where(eq(users.id, request.items.ownerId))
              .limit(1);

            const lenderBalance = Math.floor(parseFloat(lender?.shareCoins || "0"));
            await db
              .update(users)
              .set({ shareCoins: (lenderBalance + charged).toString() })
              .where(eq(users.id, request.items.ownerId));

            await db.insert(shareCoinsTransactions).values({
              userId: request.items.ownerId,
              amount: charged.toString(),
              description: `Lent: ${request.items.name}`,
              transactionType: "LEND_REWARD",
            });

            // First-time lend bonus (only fires on their very first lend)
            await awardShareCoinsWithFirstTimeBonus(request.items.ownerId, 'LEND', request.items.name, 1);

            // Notify lender so their client refreshes balance and shows coin animation at handoff
            await db.insert(notifications).values({
              userId: request.items.ownerId,
              type: "sharecoin_earned",
              title: `+${charged} ShareCoin${charged !== 1 ? "s" : ""} Earned`,
              message: `+${charged} SC earned for lending "${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}".`,
              requestId,
              itemId: request.items.id,
              isRead: false,
            });
          }
        }

        // Complete the handoff (manual confirmation path)
        // SWAP transactions are fully complete at handoff (no return step), so mark COMPLETED
        updateData.status = isSwapRequest ? "COMPLETED" : "IN_PROGRESS";
        updateData.handoffConfirmedAt = now;
        updateData.borrowPeriodStartedAt = now;
        updateData.actualHandoffAt = now;
        updateData.shareCoinsCharged = true;
        updateData.shareCoinsChargedAt = now;
        updateData.depositStatus = "held";
        updateData.confirmationMethod = "manual";

        // Mark item as unavailable
        await db
          .update(items)
          .set({ isAvailable: false })
          .where(eq(items.id, request.items.id));

        // For swaps: also mark all offered/counter items from both sides as swapped + unavailable
        if (isSwapRequest) {
          // Mark the primary item as swapped too
          await db.update(items).set({ isSwapped: true }).where(eq(items.id, request.items.id));
          const offeredIds: number[] = [
            ...((request.item_requests.swapOfferedItemIds as number[] | null) ?? []),
            ...((request.item_requests.counterSwapOwnerItemIds as number[] | null) ?? []),
            ...((request.item_requests.counterSwapRequesterItemIds as number[] | null) ?? []),
          ].filter((id) => typeof id === "number");
          if (offeredIds.length > 0) {
            await db.update(items).set({ isAvailable: false, isSwapped: true }).where(inArray(items.id, offeredIds));
          }
        }

        // Award ShareCoins, trust points, referral bonuses, and achievements for SWAP
        // at handoff completion (deferred from acceptance to ensure the exchange actually happened)
        if (isSwapRequest) {
          try {
            const ownerId2 = request.items.ownerId!;
            const requesterId2 = request.item_requests.requesterId;
            const itemName2 = request.items.name;

            const ownerResult = await awardShareCoinsWithFirstTimeBonus(ownerId2, 'SWAP', itemName2, 1);
            const requesterResult = await awardShareCoinsWithFirstTimeBonus(requesterId2, 'SWAP', itemName2, 1);
            console.log(`✅ Awarded ShareCoins for swap at handoff: Owner=${ownerResult.totalAwarded}, Requester=${requesterResult.totalAwarded}`);

            // Apply tier-based coin offset between the two parties
            await applySwapCoinOffset(
              ownerId2, requesterId2, requestId,
              request.item_requests.itemId,
              request.item_requests.swapOfferedItemIds as number[] | null,
              request.item_requests.counterSwapOwnerItemIds as number[] | null,
              request.item_requests.counterSwapRequesterItemIds as number[] | null,
              itemName2,
            );

            await awardSwapCompletionPoints(ownerId2, requesterId2, requestId, request.items.id, request.items.id);
            console.log(`✅ Awarded trust points for swap handoff completion`);
            await db.insert(notifications).values([
              { userId: ownerId2, type: "trust_score_changed", title: "Trust Score +20", message: "Swap completed +20", itemId: request.items.id, requestId, isRead: false },
              { userId: requesterId2, type: "trust_score_changed", title: "Trust Score +20", message: "Swap completed +20", itemId: request.items.id, requestId, isRead: false },
            ]);

            await checkAndAwardReferralBonus(ownerId2, requestId, 'SWAP');
            await checkAndAwardReferralBonus(requesterId2, requestId, 'SWAP');
            await checkAndAwardAchievements(ownerId2);
            await checkAndAwardAchievements(requesterId2);
          } catch (swapRewardError) {
            console.error("Error awarding swap rewards at handoff:", swapRewardError);
          }
        }

        // For RENT: release rental earnings to owner at handoff (not at return)
        if (request.item_requests.requestType === 'RENT' && request.item_requests.rentalAmount) {
          try {
            const _rentAmt = parseFloat(request.item_requests.rentalAmount);
            const _processingFee = _rentAmt * 0.03;
            const _netAmt = _rentAmt - _processingFee;
            const _ownerId = request.items.ownerId!;
            const _sn = (s: string) => s.length > 20 ? s.slice(0, 20) + "…" : s;
            const [_existingPayout] = await db
              .select().from(rentalPayouts)
              .where(and(eq(rentalPayouts.requestId, requestId), eq(rentalPayouts.status, 'held')))
              .limit(1);
            if (_existingPayout) {
              await db.update(rentalPayouts).set({ status: 'released', releasedAt: new Date() }).where(eq(rentalPayouts.id, _existingPayout.id));
              const _en = parseFloat(_existingPayout.netAmount || "0");
              await db.update(users).set({
                pendingRentalBalance: sql`GREATEST(0, COALESCE(${users.pendingRentalBalance}, 0) - ${_en})`,
                rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${_en}`,
              }).where(eq(users.id, _ownerId));
              await db.insert(notifications).values({ userId: _ownerId, type: "payment_received", title: "Rental Payment Ready", message: `$${_en.toFixed(2)} earned from "${_sn(request.items.name)}" — ready to withdraw.`, itemId: request.items.id, requestId, isRead: false });
              console.log(`[Handoff] Released rental earnings $${_en.toFixed(2)} to owner ${_ownerId}`);
            } else {
              await db.insert(rentalPayouts).values({ userId: _ownerId, requestId, amount: _rentAmt.toString(), rentalAmount: _rentAmt.toString(), platformFee: "0", processingFee: _processingFee.toFixed(2), netAmount: _netAmt.toFixed(2), status: 'released', stripePaymentIntentId: request.item_requests.depositPaymentIntentId, releasedAt: new Date() });
              await db.update(users).set({ rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${_netAmt.toFixed(2)}` }).where(eq(users.id, _ownerId));
              await db.insert(notifications).values({ userId: _ownerId, type: "payment_received", title: "Rental Payment Ready", message: `$${_netAmt.toFixed(2)} earned from "${_sn(request.items.name)}" — ready to withdraw.`, itemId: request.items.id, requestId, isRead: false });
              console.log(`[Handoff] Released rental earnings $${_netAmt.toFixed(2)} to owner ${_ownerId} (fallback)`);
            }
          } catch (rentalPayoutErr) {
            console.error("Error releasing rental payment at handoff:", rentalPayoutErr);
          }
        }
      }

      // Update the request
      const [updated] = await db
        .update(itemRequests)
        .set(updateData)
        .where(eq(itemRequests.id, requestId))
        .returning();

      // Send notification to the other party
      const otherPartyId = isOwner ? request.item_requests.requesterId : request.items.ownerId;
      if (otherPartyId && !bothConfirmed) {
        await db.insert(notifications).values({
          userId: otherPartyId,
          type: "handoff_pending",
          title: "Handoff Confirmation Needed",
          message: isOwner 
            ? `Owner confirmed handoff for "${request.items.name}". Please confirm receipt.`
            : `Borrower confirmed receipt of "${request.items.name}". Please confirm.`,
          itemId: request.items.id,
          requestId: requestId,
        });
      }

      // Send chat system messages after handoff events
      const ownerId = request.items.ownerId!;
      const borrowerId = request.item_requests.requesterId;

      if (disputeTriggered) {
        // Case 5: One confirmed, other denied — lock it down, ask for proof
        await db.insert(messages).values({
          content: `⚠️ There's a disagreement about the handoff. We've paused this transaction while we review. Both parties have 24 hours to submit proof.`,
          senderId: ownerId,
          receiverId: borrowerId,
          messageType: "system",
          requestId,
        });
        // Notify both parties
        const _hdn = (s: string) => s.length > 20 ? s.slice(0, 20) + "…" : s;
        await db.insert(notifications).values([
          {
            userId: ownerId,
            type: "handoff_dispute",
            title: "Handoff Dispute Opened",
            message: `Handoff disagreement on "${_hdn(request.items.name)}". Submit proof within 24 hours.`,
            itemId: request.items.id,
            requestId,
          },
          {
            userId: borrowerId,
            type: "handoff_dispute",
            title: "Handoff Dispute Opened",
            message: `Handoff disagreement on "${_hdn(request.items.name)}". Submit proof within 24 hours.`,
            itemId: request.items.id,
            requestId,
          },
        ]);
      } else if (!bothConfirmed) {
        // Look up display names for both parties
        const [confirmerUser] = await db
          .select({ displayName: users.displayName, username: users.username })
          .from(users)
          .where(eq(users.id, req.user.id))
          .limit(1);
        let otherName = "the other party";
        if (otherPartyId) {
          const [otherUser] = await db
            .select({ displayName: users.displayName, username: users.username })
            .from(users)
            .where(eq(users.id, otherPartyId))
            .limit(1);
          otherName = otherUser?.displayName || otherUser?.username || "the other party";
        }
        const confirmerName = confirmerUser?.displayName || confirmerUser?.username || "One party";

        // One party confirmed — send role-specific confirmation + waiting messages
        await db.insert(messages).values([
          {
            content: `✅ You confirmed the handoff`,
            senderId: ownerId,
            receiverId: borrowerId,
            messageType: "system",
            requestId,
            metadata: { visibleToUserId: req.user.id },
          },
          {
            content: `✅ ${confirmerName} confirmed the handoff`,
            senderId: ownerId,
            receiverId: borrowerId,
            messageType: "system",
            requestId,
            metadata: { visibleToUserId: otherPartyId },
          },
          {
            content: `If only one person confirms, we'll complete this automatically in 24 hours.`,
            senderId: ownerId,
            receiverId: borrowerId,
            messageType: "system",
            requestId,
          },
        ]);
      } else {
        // Both confirmed — send type-appropriate post-handoff summary messages
        const reqType = request.item_requests.requestType;
        const isBorrow = reqType === "BORROW";
        const isRent   = reqType === "RENT";
        const isSwap   = reqType === "SWAP";
        const isGift   = reqType === "GIFT";

        let systemMsgs: string[] = [];

        if (isSwap) {
          systemMsgs = [`🔄 Swap complete! Both items have been exchanged. Enjoy!`];
        } else if (isGift) {
          systemMsgs = [`🎁 Gift successfully handed over! Generosity makes the neighbourhood stronger.`];
        } else {
          // BORROW or RENT
          // Use counter-proposed dates if present — they are the agreed-upon dates after negotiation
          const effectiveStart2 = request.item_requests.counterStartDate || request.item_requests.startDate;
          const effectiveEnd2   = request.item_requests.counterEndDate   || request.item_requests.endDate;
          const formatBookedCalendarDate = (value: Date | string | null | undefined, includeYear = false) => {
            if (!value) return null;
            const datePart = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
            return new Intl.DateTimeFormat("en-US", {
              timeZone: "UTC",
              month: "short",
              day: "numeric",
              ...(includeYear ? { year: "numeric" as const } : {}),
            }).format(new Date(`${datePart}T00:00:00.000Z`));
          };
          // ShareCoin amount is always based on the original booked period — never adjusted for early/late handoff
          const shareCoinAmount = isBorrow
            ? calcBorrowShareCoinCost(
                parseFloat(request.items.shareCoinPrice || "0"),
                effectiveStart2,
                effectiveEnd2,
              )
            : parseFloat(request.item_requests.shareCoinAmount || request.items.shareCoinPrice || "0");
          const startFmt = formatBookedCalendarDate(effectiveStart2);
          const endFmt = formatBookedCalendarDate(effectiveEnd2, true);
          const handoffFmt = now.toLocaleDateString("en-CA", { month: "short", day: "numeric" });

          systemMsgs = [
            `🤝 The ${isBorrow ? "borrow" : "rental"} period has officially started`,
            startFmt && endFmt ? `📅 Booked period: ${startFmt} – ${endFmt} | Handoff completed: ${handoffFmt}` : null,
          ].filter(Boolean) as string[];

          // Role-specific ShareCoin messages — each only visible to the relevant party
          if (isBorrow && shareCoinAmount > 0) {
            const coinLabel = `${shareCoinAmount} ShareCoin${shareCoinAmount !== 1 ? "s" : ""}`;
            await db.insert(messages).values({ content: `🪙 ${coinLabel} charged`, senderId: ownerId, receiverId: borrowerId, messageType: "system", requestId, metadata: { visibleToUserId: borrowerId } });
            if (ownerId) await db.insert(messages).values({ content: `🪙 ${coinLabel} earned`, senderId: ownerId, receiverId: borrowerId, messageType: "system", requestId, metadata: { visibleToUserId: ownerId } });
          }
        }

        for (const content of systemMsgs) {
          await db.insert(messages).values({
            content,
            senderId: ownerId,
            receiverId: borrowerId,
            messageType: "system",
            requestId,
          });
        }
      }

      res.json({
        success: true,
        request: updated,
        bothConfirmed,
        disputeTriggered,
        waitingMessage: bothConfirmed || disputeTriggered ? undefined : waitingMessage,
        message: bothConfirmed 
          ? "Handoff confirmed by both parties! Borrow period has started."
          : disputeTriggered
          ? "Dispute opened. Transaction is paused pending proof submission."
          : waitingMessage,
      });
    } catch (error: any) {
      console.error("Error confirming handoff:", error);
      res.status(500).json({ error: "Failed to confirm handoff" });
    }
  });

  // Owner fetches their handoff PIN (owner-only, never returned to borrower in regular request payload)
  app.get("/api/requests/:requestId/handoff-pin", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const requestId = parseInt(req.params.requestId);
      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) return res.status(404).json({ error: "Request not found" });
      if (request.items.ownerId !== req.user.id) return res.status(403).json({ error: "Only the owner can view the handoff PIN" });

      const pin = (request.item_requests as any).handoffPin;
      const pinExpiresAt = (request.item_requests as any).pinExpiresAt;
      const pinUsed = (request.item_requests as any).pinUsed;

      if (!pin) return res.status(404).json({ error: "No PIN generated for this request" });

      const expired = pinExpiresAt && new Date(pinExpiresAt) < new Date();
      return res.json({ pin: expired ? null : pin, pinExpiresAt, pinUsed, expired: !!expired });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch PIN" });
    }
  });

  // Borrower verifies handoff PIN — on success, completes the handoff immediately
  app.post("/api/requests/:requestId/verify-pin", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const requestId = parseInt(req.params.requestId);
      const { pin } = req.body;

      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) return res.status(404).json({ error: "Request not found" });

      const isBorrower = request.item_requests.requesterId === req.user.id;
      if (!isBorrower) return res.status(403).json({ error: "Only the borrower can submit the PIN" });

      const requestType = request.item_requests.requestType;
      const isNoDepositType = requestType === "GIFT" || requestType === "SWAP";
      const validStatuses = ["DEPOSIT_CONFIRMED", "AWAITING_HANDOFF_CONFIRM"];
      // GIFT and SWAP skip the deposit step — they stay at ACCEPTED until handoff
      if (!validStatuses.includes(request.item_requests.status) && !(isNoDepositType && request.item_requests.status === "ACCEPTED")) {
        return res.status(400).json({ error: "Handoff already completed or not ready" });
      }

      const storedPin = (request.item_requests as any).handoffPin;
      const pinExpiresAt = (request.item_requests as any).pinExpiresAt;
      const pinUsed = (request.item_requests as any).pinUsed;
      const pinAttempts = (request.item_requests as any).pinAttempts ?? 0;

      // Rate limit: max 5 attempts
      if (pinAttempts >= 5) {
        return res.status(429).json({ error: "Too many incorrect attempts. Please use the manual confirmation flow.", rateLimited: true });
      }

      // Check expiry
      if (!storedPin || (pinExpiresAt && new Date(pinExpiresAt) < new Date())) {
        return res.status(400).json({ error: "This code has expired", expired: true });
      }

      if (pinUsed) {
        return res.status(400).json({ error: "This code has already been used", alreadyUsed: true });
      }

      // Validate PIN
      if (pin !== storedPin) {
        await db.update(itemRequests).set({ pinAttempts: pinAttempts + 1 } as any).where(eq(itemRequests.id, requestId));
        const remaining = 5 - (pinAttempts + 1);
        return res.status(400).json({ error: "That code didn't match", incorrect: true, attemptsRemaining: remaining });
      }

      // ✅ Correct PIN — complete the handoff immediately
      const now = new Date();
      const ownerId = request.items.ownerId!;
      const borrowerId = request.item_requests.requesterId;
      const isGiftPin = requestType === "GIFT";
      const isSwapPin = requestType === "SWAP";
      const isGiftOrSwapPin = isGiftPin || isSwapPin;

      // For BORROW, charge/earn ShareCoins at handoff
      // Use counter-proposed dates if present — they are the agreed-upon dates after negotiation
      if (requestType === "BORROW") {
        const effectiveStart3 = request.item_requests.counterStartDate || request.item_requests.startDate;
        const effectiveEnd3   = request.item_requests.counterEndDate   || request.item_requests.endDate;
        // ShareCoin amount is always based on the original booked period — never adjusted for early/late handoff
        const shareCoinAmount = calcBorrowShareCoinCost(
          parseFloat(request.items.shareCoinPrice || "0"),
          effectiveStart3,
          effectiveEnd3,
        );
        if (shareCoinAmount > 0) {
          const [borrower] = await db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, borrowerId)).limit(1);
          const currentBalance = Math.floor(parseFloat(borrower?.shareCoins || "0"));
          const charged = Math.min(shareCoinAmount, Math.max(currentBalance, 0));
          await db.update(users).set({ shareCoins: (currentBalance - charged).toString() }).where(eq(users.id, borrowerId));
          await db.insert(shareCoinsTransactions).values({ userId: borrowerId, amount: (-charged).toString(), description: `Borrowed: ${request.items.name}`, transactionType: "BORROW_CHARGE" });
          if (ownerId && charged > 0) {
            const [lender] = await db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, ownerId)).limit(1);
            const lenderBalance = Math.floor(parseFloat(lender?.shareCoins || "0"));
            await db.update(users).set({ shareCoins: (lenderBalance + charged).toString() }).where(eq(users.id, ownerId));
            await db.insert(shareCoinsTransactions).values({ userId: ownerId, amount: charged.toString(), description: `Lent: ${request.items.name}`, transactionType: "LEND_REWARD" });

            // First-time lend bonus (only fires on their very first lend)
            await awardShareCoinsWithFirstTimeBonus(ownerId, 'LEND', request.items.name, 1);

            // Notify lender so their client refreshes balance and shows coin animation at handoff
            await db.insert(notifications).values({
              userId: ownerId,
              type: "sharecoin_earned",
              title: `+${charged} ShareCoin${charged !== 1 ? "s" : ""} Earned`,
              message: `+${charged} SC earned for lending "${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}".`,
              requestId,
              itemId: request.items.id,
              isRead: false,
            });
          }
          const coinLabel = `${shareCoinAmount} ShareCoin${shareCoinAmount !== 1 ? "s" : ""}`;
          await db.insert(messages).values({ content: `🪙 ${coinLabel} charged`, senderId: ownerId, receiverId: borrowerId, messageType: "system", requestId, metadata: { visibleToUserId: borrowerId } });
          if (ownerId) await db.insert(messages).values({ content: `🪙 ${coinLabel} earned`, senderId: ownerId, receiverId: borrowerId, messageType: "system", requestId, metadata: { visibleToUserId: ownerId } });
        }
      }

      // GIFT / SWAP → mark as COMPLETED immediately; BORROW/RENT → IN_PROGRESS (period begins)
      const newStatus = isGiftOrSwapPin ? "COMPLETED" : "IN_PROGRESS";

      await db.update(itemRequests).set({
        status: newStatus,
        handoffConfirmedAt: now,
        ...(isGiftOrSwapPin ? { completedAt: now } : { borrowPeriodStartedAt: now }),
        actualHandoffAt: now,
        shareCoinsCharged: !isGiftOrSwapPin,
        shareCoinsChargedAt: isGiftOrSwapPin ? null : now,
        depositStatus: isGiftOrSwapPin ? null : "held",
        ownerConfirmedHandoff: true,
        ownerConfirmedHandoffAt: now,
        borrowerConfirmedHandoff: true,
        borrowerConfirmedHandoffAt: now,
        pinUsed: true,
        confirmationMethod: "pin",
      } as any).where(eq(itemRequests.id, requestId));

      await db.update(items).set({ isAvailable: false }).where(eq(items.id, request.items.id));

      // For swaps via PIN: mark primary item and all offered/counter items as swapped + unavailable
      if (isSwapPin) {
        await db.update(items).set({ isSwapped: true }).where(eq(items.id, request.items.id));
        const swapOfferedIds: number[] = [
          ...((request.item_requests.swapOfferedItemIds as number[] | null) ?? []),
          ...((request.item_requests.counterSwapOwnerItemIds as number[] | null) ?? []),
          ...((request.item_requests.counterSwapRequesterItemIds as number[] | null) ?? []),
        ].filter((id) => typeof id === "number");
        if (swapOfferedIds.length > 0) {
          await db.update(items).set({ isAvailable: false, isSwapped: true }).where(inArray(items.id, swapOfferedIds));
        }
      }

      // System messages
      if (isGiftPin) {
        await db.insert(messages).values({
          content: `🎁 Gift confirmed via PIN — "${request.items.name}" successfully received!`,
          senderId: ownerId, receiverId: borrowerId, messageType: "system", requestId,
        });
      } else if (isSwapPin) {
        await db.insert(messages).values({
          content: `🔄 Swap confirmed via PIN — items successfully exchanged!`,
          senderId: ownerId, receiverId: borrowerId, messageType: "system", requestId,
        });

        // Award ShareCoins and apply tier-based offset for SWAP (PIN path)
        try {
          await awardShareCoinsWithFirstTimeBonus(ownerId, 'SWAP', request.items.name, 1);
          await awardShareCoinsWithFirstTimeBonus(borrowerId, 'SWAP', request.items.name, 1);
          await applySwapCoinOffset(
            ownerId, borrowerId, requestId,
            request.item_requests.itemId,
            request.item_requests.swapOfferedItemIds as number[] | null,
            request.item_requests.counterSwapOwnerItemIds as number[] | null,
            request.item_requests.counterSwapRequesterItemIds as number[] | null,
            request.items.name,
          );
          await awardSwapCompletionPoints(ownerId, borrowerId, requestId, request.items.id, request.items.id);
          await db.insert(notifications).values([
            { userId: ownerId, type: "trust_score_changed", title: "Trust Score +20", message: "Swap completed +20", itemId: request.items.id, requestId, isRead: false },
            { userId: borrowerId, type: "trust_score_changed", title: "Trust Score +20", message: "Swap completed +20", itemId: request.items.id, requestId, isRead: false },
          ]);
          await checkAndAwardReferralBonus(ownerId, requestId, 'SWAP');
          await checkAndAwardReferralBonus(borrowerId, requestId, 'SWAP');
          await checkAndAwardAchievements(ownerId);
          await checkAndAwardAchievements(borrowerId);
        } catch (swapPinRewardError) {
          console.error("Error awarding swap rewards at PIN handoff:", swapPinRewardError);
        }
      } else {
        const periodType = requestType === "RENT" ? "rental" : "borrow";
        await db.insert(messages).values({ content: `🤝 Handoff confirmed via PIN — ${periodType} period has started`, senderId: ownerId, receiverId: borrowerId, messageType: "system", requestId });
        // For RENT: release rental earnings to owner at handoff (not at return)
        if (requestType === 'RENT' && request.item_requests.rentalAmount) {
          try {
            const _rentAmt = parseFloat(request.item_requests.rentalAmount);
            const _processingFee = _rentAmt * 0.03;
            const _netAmt = _rentAmt - _processingFee;
            const _sn = (s: string) => s.length > 20 ? s.slice(0, 20) + "…" : s;
            const [_existingPayout] = await db
              .select().from(rentalPayouts)
              .where(and(eq(rentalPayouts.requestId, requestId), eq(rentalPayouts.status, 'held')))
              .limit(1);
            if (_existingPayout) {
              await db.update(rentalPayouts).set({ status: 'released', releasedAt: new Date() }).where(eq(rentalPayouts.id, _existingPayout.id));
              const _en = parseFloat(_existingPayout.netAmount || "0");
              await db.update(users).set({
                pendingRentalBalance: sql`GREATEST(0, COALESCE(${users.pendingRentalBalance}, 0) - ${_en})`,
                rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${_en}`,
              }).where(eq(users.id, ownerId));
              await db.insert(notifications).values({ userId: ownerId, type: "payment_received", title: "Rental Payment Ready", message: `$${_en.toFixed(2)} earned from "${_sn(request.items.name)}" — ready to withdraw.`, itemId: request.items.id, requestId, isRead: false });
              console.log(`[PIN Handoff] Released rental earnings $${_en.toFixed(2)} to owner ${ownerId}`);
            } else {
              await db.insert(rentalPayouts).values({ userId: ownerId, requestId, amount: _rentAmt.toString(), rentalAmount: _rentAmt.toString(), platformFee: "0", processingFee: _processingFee.toFixed(2), netAmount: _netAmt.toFixed(2), status: 'released', stripePaymentIntentId: request.item_requests.depositPaymentIntentId, releasedAt: new Date() });
              await db.update(users).set({ rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${_netAmt.toFixed(2)}` }).where(eq(users.id, ownerId));
              await db.insert(notifications).values({ userId: ownerId, type: "payment_received", title: "Rental Payment Ready", message: `$${_netAmt.toFixed(2)} earned from "${_sn(request.items.name)}" — ready to withdraw.`, itemId: request.items.id, requestId, isRead: false });
              console.log(`[PIN Handoff] Released rental earnings $${_netAmt.toFixed(2)} to owner ${ownerId} (fallback)`);
            }
          } catch (rentalPayoutErr) {
            console.error("Error releasing rental payment at PIN handoff:", rentalPayoutErr);
          }
        }
      }

      const _hn = (s: string) => s.length > 20 ? s.slice(0, 20) + "…" : s;
      const _handoffMsg = isGiftPin
        ? `Gifted "${_hn(request.items.name)}" — handoff confirmed via code.`
        : isSwapPin
        ? `Swapped "${_hn(request.items.name)}" — handoff confirmed via code.`
        : `Received "${_hn(request.items.name)}" via code. ${requestType === "RENT" ? "Rental" : "Borrow"} period started.`;
      await db.insert(notifications).values([
        { userId: ownerId, type: "handoff_confirmed", title: "Handoff Confirmed", message: _handoffMsg, itemId: request.items.id, requestId },
        { userId: borrowerId, type: "handoff_confirmed", title: "Handoff Confirmed", message: _handoffMsg, itemId: request.items.id, requestId },
      ]);

      res.json({ success: true, confirmed: true, message: isGiftPin ? "Gift confirmed via PIN!" : isSwapPin ? "Swap confirmed via PIN!" : "Handoff confirmed via PIN!" });
    } catch (error: any) {
      console.error("Error verifying handoff PIN:", error);
      res.status(500).json({ error: "Failed to verify PIN" });
    }
  });

  // Deny a handoff (Cases 2 and 5)
  app.post("/api/requests/:requestId/deny-handoff", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const requestId = parseInt(req.params.requestId);
      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) return res.status(404).json({ error: "Request not found" });

      const isOwner = request.items.ownerId === req.user.id;
      const isRequester = request.item_requests.requesterId === req.user.id;
      if (!isOwner && !isRequester) return res.status(403).json({ error: "Unauthorized" });

      const validStatuses = ["DEPOSIT_CONFIRMED", "AWAITING_HANDOFF_CONFIRM", "IN_PROGRESS"];
      if (!validStatuses.includes(request.item_requests.status)) {
        return res.status(400).json({ error: "Request is not in a handoff state" });
      }

      // Special path: post-auto-confirm dispute (status=IN_PROGRESS + handoffAutoAdvanced)
      if (request.item_requests.status === "IN_PROGRESS") {
        if (!(request.item_requests as any).handoffAutoAdvanced) {
          return res.status(400).json({ error: "This exchange was manually confirmed and cannot be disputed this way" });
        }
        const { description } = req.body;
        const now2 = new Date();
        const deadline24h2 = new Date(now2.getTime() + 24 * 60 * 60 * 1000);
        const proofField = isOwner ? { handoffProofOwner: description || "Disputed by owner after auto-confirm" } : { handoffProofBorrower: description || "Disputed by borrower after auto-confirm" };
        await db.update(itemRequests).set({
          status: "HANDOFF_DISPUTED",
          handoffDisputeTriggered: true,
          handoffDisputeAt: now2,
          handoffProofDeadline: deadline24h2,
          ...(isOwner ? { ownerDeniedHandoff: true } : { borrowerDeniedHandoff: true }),
          ...proofField,
        }).where(eq(itemRequests.id, requestId));

        const ownerId3 = request.items.ownerId!;
        const borrowerId3 = request.item_requests.requesterId;
        await db.insert(messages).values({ content: `🔴 A dispute has been opened on this exchange. Both parties have 24 hours to submit evidence.`, senderId: ownerId3, receiverId: borrowerId3, messageType: "system", requestId });
        await db.insert(notifications).values([
          { userId: ownerId3, type: "handoff_disputed", title: "Exchange Disputed", message: `Dispute opened on "${request.items.name.length > 22 ? request.items.name.slice(0, 22) + "…" : request.items.name}".`, itemId: request.items.id, requestId },
          { userId: borrowerId3, type: "handoff_disputed", title: "Exchange Disputed", message: `Dispute opened on "${request.items.name.length > 22 ? request.items.name.slice(0, 22) + "…" : request.items.name}".`, itemId: request.items.id, requestId },
        ]);
        return res.json({ success: true, disputeTriggered: true });
      }

      const ownerAlreadyConfirmed = request.item_requests.ownerConfirmedHandoff;
      const borrowerAlreadyConfirmed = request.item_requests.borrowerConfirmedHandoff;
      const now = new Date();
      const deadline24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      let updateData: any = {};
      let disputeTriggered = false;

      if (isOwner) {
        updateData.ownerDeniedHandoff = true;
        if (borrowerAlreadyConfirmed) {
          // Case 5: Borrower confirmed, owner denies → dispute
          disputeTriggered = true;
          updateData.handoffDisputeTriggered = true;
          updateData.handoffDisputeAt = now;
          updateData.handoffProofDeadline = deadline24h;
          updateData.status = "HANDOFF_DISPUTED";
        } else {
          // Case 2: nobody confirmed yet — give other party 24h to respond, then flag
          updateData.status = "AWAITING_HANDOFF_CONFIRM";
          updateData.handoffConfirmDeadline = deadline24h;
          updateData.handoffRemindersLevel = 0;
        }
      } else {
        updateData.borrowerDeniedHandoff = true;
        if (ownerAlreadyConfirmed) {
          // Case 5: Owner confirmed, borrower denies → dispute
          disputeTriggered = true;
          updateData.handoffDisputeTriggered = true;
          updateData.handoffDisputeAt = now;
          updateData.handoffProofDeadline = deadline24h;
          updateData.status = "HANDOFF_DISPUTED";
        } else {
          // Case 2: nobody confirmed yet — give other party 24h to respond, then flag
          updateData.status = "AWAITING_HANDOFF_CONFIRM";
          updateData.handoffConfirmDeadline = deadline24h;
          updateData.handoffRemindersLevel = 0;
        }
      }

      await db.update(itemRequests).set(updateData).where(eq(itemRequests.id, requestId));

      const ownerId = request.items.ownerId!;
      const borrowerId = request.item_requests.requesterId;

      if (disputeTriggered) {
        await db.insert(messages).values({
          content: `⚠️ There's a disagreement about the handoff. We've paused this transaction while we review. Both parties have 24 hours to submit proof.`,
          senderId: ownerId,
          receiverId: borrowerId,
          messageType: "system",
          requestId,
        });
        await db.insert(notifications).values([
          { userId: ownerId, type: "handoff_dispute", title: "Handoff Dispute", message: `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" — submit proof within 24 hrs.`, itemId: request.items.id, requestId },
          { userId: borrowerId, type: "handoff_dispute", title: "Handoff Dispute", message: `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" — submit proof within 24 hrs.`, itemId: request.items.id, requestId },
        ]);
      } else {
        // One denied, other hasn't acted yet — log it
        await db.insert(messages).values({
          content: `${isOwner ? "Owner" : "Borrower"} reported the item was not received/handed off. If no response from the other party within 24 hours, this will be flagged for review.`,
          senderId: ownerId,
          receiverId: borrowerId,
          messageType: "system",
          requestId,
        });
      }

      res.json({ success: true, disputeTriggered });
    } catch (error: any) {
      console.error("Error denying handoff:", error);
      res.status(500).json({ error: "Failed to deny handoff" });
    }
  });

  // Submit proof for a handoff dispute
  app.post("/api/requests/:requestId/handoff-dispute-proof", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const requestId = parseInt(req.params.requestId);
      const { note } = req.body;
      if (!note?.trim()) return res.status(400).json({ error: "Proof note is required" });

      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) return res.status(404).json({ error: "Request not found" });
      if (request.item_requests.status !== "HANDOFF_DISPUTED") {
        return res.status(400).json({ error: "This request is not in a dispute state" });
      }

      const isOwner = request.items.ownerId === req.user.id;
      const isRequester = request.item_requests.requesterId === req.user.id;
      if (!isOwner && !isRequester) return res.status(403).json({ error: "Unauthorized" });

      const updateData: any = isOwner
        ? { handoffProofOwner: note.trim() }
        : { handoffProofBorrower: note.trim() };

      await db.update(itemRequests).set(updateData).where(eq(itemRequests.id, requestId));

      const ownerId = request.items.ownerId!;
      const borrowerId = request.item_requests.requesterId;

      await db.insert(messages).values({
        content: `${isOwner ? "Owner" : "Borrower"} submitted proof for the handoff dispute.`,
        senderId: ownerId,
        receiverId: borrowerId,
        messageType: "system",
        requestId,
      });

      // Re-fetch to check if both have submitted
      const [updated] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId)).limit(1);
      const bothSubmitted = !!(updated as any).handoffProofOwner && !!(updated as any).handoffProofBorrower;

      if (bothSubmitted) {
        await db.insert(messages).values({
          content: `Both parties have submitted proof. An admin will review and resolve this dispute.`,
          senderId: ownerId,
          receiverId: borrowerId,
          messageType: "system",
          requestId,
        });
      }

      res.json({ success: true, bothSubmitted });
    } catch (error: any) {
      console.error("Error submitting dispute proof:", error);
      res.status(500).json({ error: "Failed to submit proof" });
    }
  });

  // Auto-advance handoffs that have passed their deadline (called by client-side polling)
  app.post("/api/requests/check-handoff-deadlines", csrfProtection, async (req, res) => {
    try {
      const now = new Date();

      // ── Smart reminders: find AWAITING requests that need a nudge ──
      const pendingHandoffs = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(
          and(
            eq(itemRequests.status, "AWAITING_HANDOFF_CONFIRM"),
            gte(itemRequests.handoffConfirmDeadline, now),
            lt(itemRequests.handoffRemindersLevel, 3)
          )
        );

      for (const req2 of pendingHandoffs) {
        const level = req2.item_requests.handoffRemindersLevel ?? 0;
        const ownerId2 = req2.items.ownerId!;
        const borrowerId2 = req2.item_requests.requesterId;

        // Determine who confirmed first and when
        const ownerConfirmed = req2.item_requests.ownerConfirmedHandoff;
        const firstConfirmedAt = ownerConfirmed
          ? req2.item_requests.ownerConfirmedHandoffAt
          : req2.item_requests.borrowerConfirmedHandoffAt;

        if (!firstConfirmedAt) continue;

        const elapsedMs = now.getTime() - new Date(firstConfirmedAt).getTime();
        const elapsedMin = elapsedMs / 60_000;
        const elapsedHrs = elapsedMs / 3_600_000;

        // Look up waiting party name
        const waitingPartyId = ownerConfirmed ? borrowerId2 : ownerId2;
        const [waitingUser] = await db
          .select({ displayName: users.displayName, username: users.username })
          .from(users)
          .where(eq(users.id, waitingPartyId))
          .limit(1);
        const waitingName = waitingUser?.displayName || waitingUser?.username || "the other party";

        let reminderContent: string | null = null;
        let newLevel = level;

        if (level === 0 && elapsedMin >= 10) {
          reminderContent = `⏰ Reminder — waiting for ${waitingName} to confirm the handoff.`;
          newLevel = 1;
        } else if (level === 1 && elapsedHrs >= 1) {
          reminderContent = `⚠️ It's been over an hour. ${waitingName} still needs to confirm the handoff — please check in with them.`;
          newLevel = 2;
        } else if (level === 2 && elapsedHrs >= 24) {
          reminderContent = `🚨 24 hours have passed with no response from ${waitingName}. The handoff will be auto-confirmed shortly.`;
          newLevel = 3;
        }

        if (reminderContent !== null && newLevel !== level) {
          await db.insert(messages).values({
            content: reminderContent,
            senderId: ownerId2,
            receiverId: borrowerId2,
            messageType: "system",
            requestId: req2.item_requests.id,
          });
          await db
            .update(itemRequests)
            .set({ handoffRemindersLevel: newLevel })
            .where(eq(itemRequests.id, req2.item_requests.id));
        }
      }

      // ── Auto-advance: find requests past their deadline ──
      // Find requests awaiting handoff confirmation with passed deadlines
      const expiredHandoffs = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(
          and(
            eq(itemRequests.status, "AWAITING_HANDOFF_CONFIRM"),
            lt(itemRequests.handoffConfirmDeadline, now)
          )
        );

      let autoAdvancedCount = 0;
      let flaggedCount = 0;

      for (const request of expiredHandoffs) {
        const ownerConfirmed = request.item_requests.ownerConfirmedHandoff;
        const borrowerConfirmed = request.item_requests.borrowerConfirmedHandoff;
        const ownerDenied = (request.item_requests as any).ownerDeniedHandoff;
        const borrowerDenied = (request.item_requests as any).borrowerDeniedHandoff;
        const ownerId2 = request.items.ownerId!;
        const borrowerId2 = request.item_requests.requesterId;
        const reqId = request.item_requests.id;

        // ── Case 2: One denied, other is silent → flag for review (DO NOT auto-confirm) ──
        if ((ownerDenied || borrowerDenied) && !ownerConfirmed && !borrowerConfirmed) {
          await db.update(itemRequests)
            .set({ status: "HANDOFF_FLAGGED" })
            .where(eq(itemRequests.id, reqId));

          await db.insert(messages).values({
            content: `🚩 This exchange has been flagged for review. One party reported the item was not handed off and no response was received in time.`,
            senderId: ownerId2,
            receiverId: borrowerId2,
            messageType: "system",
            requestId: reqId,
          });

          await db.insert(notifications).values([
            { userId: ownerId2, type: "handoff_flagged", title: "Exchange Flagged", message: `"${request.items.name.length > 22 ? request.items.name.slice(0, 22) + "…" : request.items.name}" flagged for admin review.`, itemId: request.items.id, requestId: reqId },
            { userId: borrowerId2, type: "handoff_flagged", title: "Exchange Flagged", message: `"${request.items.name.length > 22 ? request.items.name.slice(0, 22) + "…" : request.items.name}" flagged for admin review.`, itemId: request.items.id, requestId: reqId },
          ]);

          flaggedCount++;
          continue;
        }

        // ── Case 1: One confirmed, other is silent (no denial) → auto-confirm ──
        if ((ownerConfirmed || borrowerConfirmed) && !ownerDenied && !borrowerDenied) {
          // Use counter-proposed dates if present — they are the agreed-upon dates after negotiation
          const effectiveStart4 = request.item_requests.counterStartDate || request.item_requests.startDate;
          const effectiveEnd4   = request.item_requests.counterEndDate   || request.item_requests.endDate;
          // ShareCoin amount is always based on the original booked period — never adjusted for early/late handoff
          const shareCoinAmount = request.item_requests.requestType === "BORROW"
          ? calcBorrowShareCoinCost(
              parseFloat(request.items.shareCoinPrice || "0"),
              effectiveStart4,
              effectiveEnd4,
            )
          : parseFloat(request.item_requests.shareCoinAmount || request.items.shareCoinPrice || "0");

          if (shareCoinAmount > 0 && request.item_requests.requestType === "BORROW") {
            const [borrower] = await db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, borrowerId2)).limit(1);
            const currentBalance = Math.floor(parseFloat(borrower?.shareCoins || "0"));
            if (currentBalance >= shareCoinAmount) {
              await db.update(users).set({ shareCoins: (currentBalance - shareCoinAmount).toString() }).where(eq(users.id, borrowerId2));
              await db.insert(shareCoinsTransactions).values({ userId: borrowerId2, amount: (-shareCoinAmount).toString(), description: `Borrowed: ${request.items.name} (auto-confirmed)`, transactionType: "BORROW_CHARGE" });
              if (ownerId2) {
                const [lender] = await db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, ownerId2)).limit(1);
                const lenderBalance = Math.floor(parseFloat(lender?.shareCoins || "0"));
                await db.update(users).set({ shareCoins: (lenderBalance + shareCoinAmount).toString() }).where(eq(users.id, ownerId2));
                await db.insert(shareCoinsTransactions).values({ userId: ownerId2, amount: shareCoinAmount.toString(), description: `Lent: ${request.items.name} (auto-confirmed)`, transactionType: "LEND_REWARD" });
              }
            }
          }

          const isAutoSwap = request.item_requests.requestType === "SWAP";
          await db.update(itemRequests)
            .set({ status: isAutoSwap ? "COMPLETED" : "IN_PROGRESS", handoffConfirmedAt: now, borrowPeriodStartedAt: now, actualHandoffAt: now, shareCoinsCharged: true, shareCoinsChargedAt: now, depositStatus: "held", handoffAutoAdvanced: true })
            .where(eq(itemRequests.id, reqId));

          await db.update(items).set({ isAvailable: false }).where(eq(items.id, request.items.id));

          // For swaps: also mark offered/counter items from both sides as swapped + unavailable
          if (isAutoSwap) {
            await db.update(items).set({ isSwapped: true }).where(eq(items.id, request.items.id));
            const autoOfferedIds: number[] = [
              ...((request.item_requests.swapOfferedItemIds as number[] | null) ?? []),
              ...((request.item_requests.counterSwapOwnerItemIds as number[] | null) ?? []),
              ...((request.item_requests.counterSwapRequesterItemIds as number[] | null) ?? []),
            ].filter((id) => typeof id === "number");
            if (autoOfferedIds.length > 0) {
              await db.update(items).set({ isAvailable: false, isSwapped: true }).where(inArray(items.id, autoOfferedIds));
            }
          }

          // Award coins/milestones for SWAP at auto-confirmed handoff
          if (isAutoSwap && ownerId2) {
            try {
              await awardShareCoinsWithFirstTimeBonus(ownerId2, 'SWAP', request.items.name, 1);
              await awardShareCoinsWithFirstTimeBonus(borrowerId2, 'SWAP', request.items.name, 1);

              // Apply tier-based coin offset between the two parties
              await applySwapCoinOffset(
                ownerId2, borrowerId2, reqId,
                request.item_requests.itemId,
                request.item_requests.swapOfferedItemIds as number[] | null,
                request.item_requests.counterSwapOwnerItemIds as number[] | null,
                request.item_requests.counterSwapRequesterItemIds as number[] | null,
                request.items.name,
              );

              await awardSwapCompletionPoints(ownerId2, borrowerId2, reqId, request.items.id, request.items.id);
              await checkAndAwardReferralBonus(ownerId2, reqId, 'SWAP');
              await checkAndAwardReferralBonus(borrowerId2, reqId, 'SWAP');
              await checkAndAwardAchievements(ownerId2);
              await checkAndAwardAchievements(borrowerId2);
            } catch (swapAutoErr) {
              console.error("Error awarding swap rewards on auto-advance:", swapAutoErr);
            }
          }

          const confirmingParty = ownerConfirmed ? "owner" : "borrower";
          await db.insert(notifications).values([
            { userId: borrowerId2, type: "handoff_auto_advanced", title: "Exchange Auto-Confirmed", message: `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" auto-confirmed — no response received.`, itemId: request.items.id, requestId: reqId },
            ...(ownerId2 ? [{ userId: ownerId2, type: "handoff_auto_advanced", title: "Exchange Auto-Confirmed", message: `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" auto-confirmed — no response received.`, itemId: request.items.id, requestId: reqId }] : []),
          ]);

          autoAdvancedCount++;
        }
        // ── Case 3 / Other edge cases: both silent past deadline — skip (no deadline was set without first confirm) ──
      }

      // ── Deposit timeout: ACCEPTED requests where deposit not paid within 48hrs ──
      const depositDeadline = new Date(now.getTime() - 48 * 3_600_000);
      const depositExpired = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(
          and(
            eq(itemRequests.status, "ACCEPTED"),
            eq(itemRequests.depositMethod, "in_app"),
            inArray(itemRequests.requestType, ["RENT", "BORROW"]),
            lt(itemRequests.acceptedAt, depositDeadline)
          )
        );

      let depositExpiredCount = 0;
      for (const row of depositExpired) {
        const reqId = row.item_requests.id;
        const ownerId2 = row.items.ownerId!;
        const requesterId2 = row.item_requests.requesterId;

        await db.update(itemRequests)
          .set({ status: "CANCELLED", unarchivedAt: new Date() })
          .where(eq(itemRequests.id, reqId));

        await db.update(items)
          .set({ isAvailable: true, updatedAt: new Date() })
          .where(eq(items.id, row.items.id));

        await db.insert(messages).values({
          content: "⏰ Transaction expired. Deposit authorization was not completed in time.",
          senderId: ownerId2,
          receiverId: requesterId2,
          messageType: "system",
          requestId: reqId,
        });

        const itemShort = row.items.name.length > 22 ? row.items.name.slice(0, 22) + "…" : row.items.name;
        await db.insert(notifications).values([
          { userId: ownerId2, type: "request_expired", title: "Transaction Expired", message: `"${itemShort}" — deposit authorization was not completed in time.`, itemId: row.items.id, requestId: reqId },
          { userId: requesterId2, type: "request_expired", title: "Transaction Expired", message: `"${itemShort}" — deposit authorization was not completed in time.`, itemId: row.items.id, requestId: reqId },
        ]);

        depositExpiredCount++;
      }

      // ── Both-silent handoff timeout: AWAITING_HANDOFF_CONFIRM, neither confirmed, 48hrs past start date ──
      const handoffSilentDeadline = new Date(now.getTime() - 48 * 3_600_000);
      const bothSilent = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(
          and(
            eq(itemRequests.status, "AWAITING_HANDOFF_CONFIRM"),
            eq(itemRequests.ownerConfirmedHandoff, false),
            eq(itemRequests.borrowerConfirmedHandoff, false),
            lt(itemRequests.startDate, handoffSilentDeadline)
          )
        );

      let bothSilentCount = 0;
      for (const row of bothSilent) {
        const reqId = row.item_requests.id;
        const ownerId2 = row.items.ownerId!;
        const requesterId2 = row.item_requests.requesterId;

        // Release any Stripe deposit hold
        if (row.item_requests.depositPaymentIntentId) {
          try {
            await stripe.paymentIntents.cancel(row.item_requests.depositPaymentIntentId);
          } catch (_) {}
        }

        await db.update(itemRequests)
          .set({
            status: "CANCELLED",
            unarchivedAt: new Date(),
            depositStatus: row.item_requests.depositPaymentIntentId ? "released" : null,
            depositReleasedAt: row.item_requests.depositPaymentIntentId ? now : null,
          })
          .where(eq(itemRequests.id, reqId));

        await db.update(items)
          .set({ isAvailable: true, updatedAt: new Date() })
          .where(eq(items.id, row.items.id));

        // Void any held rental payout
        if (row.item_requests.requestType === "RENT") {
          const [heldPayout] = await db
            .select({ id: rentalPayouts.id, netAmount: rentalPayouts.netAmount, userId: rentalPayouts.userId })
            .from(rentalPayouts)
            .where(and(eq(rentalPayouts.requestId, reqId), eq(rentalPayouts.status, "held")))
            .limit(1);
          if (heldPayout) {
            await db.update(rentalPayouts).set({ status: "cancelled" }).where(eq(rentalPayouts.id, heldPayout.id));
            const reverseAmount = parseFloat(heldPayout.netAmount || "0");
            if (reverseAmount > 0) {
              await db.update(users)
                .set({ pendingRentalBalance: sql`GREATEST(0, COALESCE(${users.pendingRentalBalance}, 0) - ${reverseAmount})` })
                .where(eq(users.id, heldPayout.userId));
            }
          }
        }

        await db.insert(messages).values({
          content: "⏰ Transaction expired due to no handoff confirmation.",
          senderId: ownerId2,
          receiverId: requesterId2,
          messageType: "system",
          requestId: reqId,
        });

        if (row.item_requests.depositPaymentIntentId && row.item_requests.depositMethod !== "in_person") {
          await db.insert(messages).values({
            content: "🔒 Security deposit hold has been lifted — nothing was charged.",
            senderId: ownerId2,
            receiverId: requesterId2,
            messageType: "system",
            requestId: reqId,
          });
        }

        const itemShort = row.items.name.length > 22 ? row.items.name.slice(0, 22) + "…" : row.items.name;
        await db.insert(notifications).values([
          { userId: ownerId2, type: "request_expired", title: "Transaction Expired", message: `"${itemShort}" — no handoff confirmed.`, itemId: row.items.id, requestId: reqId },
          { userId: requesterId2, type: "request_expired", title: "Transaction Expired", message: `"${itemShort}" — no handoff confirmed.`, itemId: row.items.id, requestId: reqId },
        ]);

        bothSilentCount++;
      }

      res.json({ success: true, autoAdvancedCount, flaggedCount, depositExpiredCount, bothSilentCount });
    } catch (error: any) {
      console.error("Error checking handoff deadlines:", error);
      res.status(500).json({ error: "Failed to check handoff deadlines" });
    }
  });

  // Borrower follows up after an accepted extension when the revised due date
  // may still be missed. The extension itself records the one trust-score
  // communication credit; this endpoint only keeps the owner informed.
  app.post("/api/requests/:requestId/notify-delay", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      if (isNaN(requestId)) return res.status(400).json({ error: "Invalid id" });

      const result = await db.transaction(async (tx) => {
        // Lock the request for the full check-and-create sequence so parallel
        // taps cannot create duplicate follow-up notifications or messages.
        await tx.execute(sql`
          SELECT 1 FROM ${itemRequests}
          WHERE ${itemRequests.id} = ${requestId}
          FOR UPDATE
        `);
        const [request] = await tx
          .select()
          .from(itemRequests)
          .where(eq(itemRequests.id, requestId))
          .limit(1);
        if (!request) return { status: 404, error: "Request not found" };
        if (request.requesterId !== req.user.id) {
          return { status: 403, error: "Only the borrower can notify about delays" };
        }
        if (request.status !== "IN_PROGRESS") {
          return { status: 400, error: "Cannot notify delay in current status" };
        }

        const [requestItem] = await tx
          .select({ ownerId: items.ownerId })
          .from(items)
          .where(eq(items.id, request.itemId))
          .limit(1);
        if (!requestItem?.ownerId) return { status: 404, error: "Item owner not found" };

        const [acceptedExtension] = await tx
          .select({ id: extensionRequests.id })
          .from(extensionRequests)
          .where(
            and(
              eq(extensionRequests.requestId, requestId),
              eq(extensionRequests.status, "accepted"),
            ),
          )
          .limit(1);
        if (!acceptedExtension) {
          return {
            status: 400,
            error: "Request a short extension first. A follow-up notice is available only after the owner accepts it.",
          };
        }

        const now = new Date();

        const [existingFollowUp] = await tx
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.requestId, requestId),
              eq(notifications.userId, requestItem.ownerId),
              eq(notifications.type, "return_delay_follow_up"),
            ),
          )
          .limit(1);
        if (existingFollowUp) {
          return {
            status: 409,
            error: "The owner has already been updated about this extended return date.",
          };
        }

        // Preserve an earlier extension credit. This only repairs older
        // in-progress extensions that predate the new request-time credit.
        const [updated] = await tx
          .update(itemRequests)
          .set({
            returnDelayNotifiedAt: request.returnDelayNotifiedAt ?? now,
            returnDelayReason: request.returnDelayReason ?? "Borrower requested an extension in advance",
          })
          .where(eq(itemRequests.id, requestId))
          .returning();

        const dueStr = request.endDate
          ? new Date(request.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : "the due date";
        const borrowerName = (req.user as any).displayName || req.user.username || "The borrower";
        const notificationTitle = "Return may still be late";
        const notificationMessage = `${borrowerName} let you know they may miss the extended return date of ${dueStr}.`;
        const [delayNotification] = await tx.insert(notifications).values({
          userId: requestItem.ownerId,
          type: "return_delay_follow_up",
          title: notificationTitle,
          message: notificationMessage,
          itemId: request.itemId,
          requestId,
          isRead: false,
        }).returning();
        const [delayMessage] = await tx.insert(messages).values({
          content: `⏰ I may still be running late after the extension ending ${dueStr}. I'll return this as soon as possible — thanks for your understanding!`,
          senderId: request.requesterId,
          receiverId: requestItem.ownerId,
          requestId,
          messageType: "text",
        }).returning();

        return {
          updated,
          request,
          ownerId: requestItem.ownerId,
          delayNotification,
          delayMessage,
          notificationTitle,
          notificationMessage,
        };
      });

      if ("error" in result) return res.status(result.status).json({ error: result.error });

      const ownerWs = connectedClients.get(result.ownerId);
      if (ownerWs?.readyState === WebSocket.OPEN) {
        ownerWs.send(JSON.stringify({ type: "new_message", message: result.delayMessage }));
        ownerWs.send(JSON.stringify({ type: "new_notification", notification: result.delayNotification }));
      }
      sendPushToUser(
        result.ownerId,
        {
          title: result.notificationTitle,
          body: result.notificationMessage,
          data: {
            screen: "chat",
            chatUserId: result.request.requesterId,
            requestId,
            itemId: result.request.itemId,
          },
        },
        "requests",
      ).catch(() => {});

      res.json({
        success: true,
        request: result.updated,
        message: "The owner has been updated. Your original extension request already counts as advance notice.",
      });
    } catch (error: any) {
      console.error("Error recording delay notification:", error);
      res.status(500).json({ error: "Failed to record delay notification" });
    }
  });

  // Borrower initiates return
  app.post("/api/requests/:requestId/return", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      if (isNaN(requestId)) return res.status(400).json({ error: "Invalid id" });

      const result = await db.transaction(async (tx) => {
        // Return initiation shares the request-row lock with extension and
        // follow-up mutations. Whichever lifecycle action obtains it first
        // establishes the definitive order of events.
        await tx.execute(sql`
          SELECT 1 FROM ${itemRequests}
          WHERE ${itemRequests.id} = ${requestId}
          FOR UPDATE
        `);
        const [request] = await tx
          .select()
          .from(itemRequests)
          .innerJoin(items, eq(items.id, itemRequests.itemId))
          .where(eq(itemRequests.id, requestId))
          .limit(1);
        if (!request) return { status: 404, error: "Request not found" };
        if (request.item_requests.requesterId !== req.user.id) {
          return { status: 403, error: "Unauthorized" };
        }
        if (request.item_requests.status !== "IN_PROGRESS") {
          return { status: 400, error: "Request is not in progress" };
        }

        const endDate = request.item_requests.endDate ? new Date(request.item_requests.endDate) : null;
        const isEarlyReturn = endDate ? new Date() < endDate : false;

        // Returning takes precedence over any unanswered extension, and both
        // the cancellation and status transition commit together.
        await tx
          .update(extensionRequests)
          .set({ status: "declined", respondedAt: new Date() })
          .where(
            and(
              eq(extensionRequests.requestId, requestId),
              eq(extensionRequests.status, "pending"),
            ),
          );

        const [updated] = await tx
          .update(itemRequests)
          .set({
            status: "RETURN_REQUESTED",
            returnRequestedAt: new Date(),
            isEarlyReturn,
          })
          .where(and(eq(itemRequests.id, requestId), eq(itemRequests.status, "IN_PROGRESS")))
          .returning();
        if (!updated) {
          throw Object.assign(new Error("Request is no longer in progress."), { status: 409 });
        }

        const ownerId = request.items.ownerId!;
        await tx.insert(notifications).values({
          userId: ownerId,
          type: "return_initiated",
          title: isEarlyReturn ? "EARLY RETURN INITIATED" : "Return initiated",
          message: isEarlyReturn
            ? `"${request.items.name}" is being returned early. Confirm receipt in chat.`
            : `"${request.items.name}" has been returned. Confirm receipt in chat.`,
          itemId: request.items.id,
          requestId,
          isRead: false,
        });

        const [returnMsg] = await tx.insert(messages).values({
          content: isEarlyReturn
            ? `📦 EARLY RETURN INITIATED — awaiting owner's confirmation.`
            : `📦 Return initiated — awaiting owner's confirmation.`,
          senderId: request.item_requests.requesterId,
          receiverId: ownerId,
          messageType: "system",
          requestId,
        }).returning();

        return { updated, isEarlyReturn, ownerId, returnMsg };
      });

      if ("error" in result) return res.status(result.status).json({ error: result.error });

      // Push via WebSocket so the owner's client immediately invalidates /api/requests
      // and shows the Confirm Return button without waiting for the 20s poll cycle.
      const ownerWs = connectedClients.get(result.ownerId);
      if (ownerWs?.readyState === WebSocket.OPEN) {
        ownerWs.send(JSON.stringify({ type: "new_message", message: result.returnMsg }));
      }

      res.json({
        success: true,
        request: result.updated,
        isEarlyReturn: result.isEarlyReturn,
        message: result.isEarlyReturn
          ? "EARLY RETURN INITIATED. Waiting for lender confirmation."
          : "Return initiated. Waiting for lender confirmation.",
      });
    } catch (error: any) {
      console.error("Error initiating return:", error);
      res.status(error.status || 500).json({ error: error.message || "Failed to initiate return" });
    }
  });

  // Lender confirms return (releases deposit, updates trust score)
  // Upload a dispute evidence photo
  app.post("/api/uploads/dispute-photo", csrfProtection, upload.single("photo"), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (!req.file) return res.status(400).json({ error: "No photo provided" });
    try {
      const url = await uploadToStorage(req.file.buffer, req.file.originalname);
      res.json({ url });
    } catch (err) {
      console.error("Dispute photo upload error:", err);
      res.status(500).json({ error: "Failed to upload photo" });
    }
  });

  app.post("/api/requests/:requestId/confirm-return", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      const { conditionRating, conditionNotes, sameCondition, triggerDispute, disputePhotoUrl } = req.body;
      
      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      // Must be the owner
      if (request.items.ownerId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Must be return requested
      if (request.item_requests.status !== "RETURN_REQUESTED") {
        return res.status(400).json({ error: "No return pending" });
      }

      // Handle dispute if owner reports damage
      if (triggerDispute) {
        // Update request to DISPUTED status, hold deposit
        const [disputed] = await db
          .update(itemRequests)
          .set({
            status: "DISPUTED",
            returnConfirmedAt: new Date(),
            returnConditionRating: conditionRating || 1,
            returnConditionNotes: conditionNotes,
            returnDisputeTriggered: true,
            returnDisputeReason: conditionNotes || "Item returned in damaged condition",
            returnDisputePhotoUrl: disputePhotoUrl || null,
            depositStatus: "disputed",
          })
          .where(eq(itemRequests.id, requestId))
          .returning();

        // Mark item as unavailable until dispute resolved
        await db
          .update(items)
          .set({ isAvailable: false })
          .where(eq(items.id, request.items.id));

        // Create notification for borrower about the dispute
        await db.insert(notifications).values({
          userId: request.item_requests.requesterId,
          type: "dispute_opened",
          title: "Dispute Opened",
          message: `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" — deposit held pending dispute review.`,
          link: `/requests`,
        });

        // System message scoped to the request thread
        const ownerId_disp = request.items.ownerId!;
        const borrowerId_disp = request.item_requests.requesterId;
        await db.insert(messages).values({
          content: `🔴 Dispute opened — security deposit is on hold pending review. Our team will contact both parties within 24 hours.`,
          senderId: ownerId_disp,
          receiverId: borrowerId_disp,
          messageType: "system",
          requestId,
        });

        return res.json({
          success: true,
          request: disputed,
          disputeOpened: true,
          message: "Dispute opened. Deposit held pending review.",
        });
      }

      // Release the deposit via Stripe
      if (request.item_requests.depositPaymentIntentId) {
        try {
          await stripe.paymentIntents.cancel(request.item_requests.depositPaymentIntentId);
          // Notify borrower their deposit hold has been lifted
          await db.insert(notifications).values({
            userId: request.item_requests.requesterId,
            type: "security_deposit_released",
            title: "Deposit Hold Lifted",
            message: `Authorization hold for "${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" has been removed — nothing was charged.`,
            itemId: request.items.id,
            requestId,
            isRead: false,
          });
        } catch (stripeError: any) {
          console.error("Error releasing deposit:", stripeError);
          // Continue even if Stripe fails - we don't want to block the return
        }
      }

      const isEarlyReturn = request.item_requests.isEarlyReturn || false;
      const isRental = request.item_requests.requestType === 'RENT';

      // Update request to completed (early returns get "COMPLETED_EARLY" status)
      const returnNow = new Date();
      const [updated] = await db
        .update(itemRequests)
        .set({
          status: isEarlyReturn ? "COMPLETED_EARLY" : "COMPLETED",
          returnConfirmedAt: returnNow,
          actualReturnAt: returnNow,
          returnConditionRating: conditionRating || 5,
          returnConditionNotes: conditionNotes,
          depositStatus: "released",
          depositReleasedAt: returnNow,
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      // Mark item as available again
      await db
        .update(items)
        .set({ isAvailable: true, updatedAt: new Date() })
        .where(eq(items.id, request.items.id));
      notifyAvailabilitySubscribers(request.items.id, request.items.name).catch(() => {});

      // Notify borrower that return has been confirmed and deposit released
      await db.insert(notifications).values({
        userId: request.item_requests.requesterId,
        type: "return_confirmed",
        title: "Return Confirmed",
        message: request.item_requests.depositMethod === "in_person"
          ? `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" returned to owner.`
          : `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" returned to owner. Deposit hold lifted.`,
        itemId: request.items.id,
        requestId,
        isRead: false,
      });

      // System message scoped to the request thread
      const ownerId_conf = request.items.ownerId!;
      const borrowerId_conf = request.item_requests.requesterId;
      await db.insert(messages).values({
        content: request.item_requests.depositMethod === "in_person"
          ? `✅ Return confirmed — item received in good condition.`
          : `✅ Return confirmed — item received in good condition. Deposit hold is lifted.`,
        senderId: ownerId_conf,
        receiverId: borrowerId_conf,
        messageType: "system",
        requestId,
      });

      // Award trust points using the new tiered system
      const endDate = request.item_requests.endDate ? new Date(request.item_requests.endDate) : null;
      const now = new Date();
      // Calculate lateness from the active due date. An accepted extension
      // replaces endDate, so it is always accounted for here.
      const daysLate = daysLateAgainstDueDate(now, endDate);
      
      try {
        const hadCommunication = !!request.item_requests.returnDelayNotifiedAt;
        const returnResult = await awardBorrowReturnPoints(
          request.item_requests.requesterId,
          request.items.ownerId!,
          requestId,
          request.items.id,
          conditionRating || 5,
          daysLate,
          hadCommunication
        );

        // Build notification message from the unified result
        const borrowerPts = returnResult.borrowerPoints;
        let borrowerMsg: string;
        if (returnResult.penaltyAlreadyApplied) {
          borrowerMsg = "Serious overdue penalty was already applied when this item reached 15 days overdue.";
        } else {
          switch (returnResult.activityType) {
            case "borrow_return_perfect":    borrowerMsg = "On-time return, great condition +40"; break;
            case "borrow_return_good":       borrowerMsg = "On-time return +25"; break;
            case "borrow_return_late_minor": borrowerMsg = daysLate <= 2 ? "1-2 day late return +5" : "Late return +5"; break;
            case "borrow_return_late_moderate": borrowerMsg = "Late return −20"; break;
            case "borrow_return_late_severe":   borrowerMsg = "Late return −40"; break;
            case "borrow_return_late_critical": borrowerMsg = "Late return −60"; break;
            case "borrow_return_damaged":    borrowerMsg = "Damage confirmed −45"; break;
            default:                         borrowerMsg = "Return processed";
          }
        }
        const lenderPts = 20;
        await db.insert(notifications).values([
          {
            userId: request.item_requests.requesterId,
            type: "trust_score_changed",
            title: returnResult.penaltyAlreadyApplied
              ? "Trust score already updated"
              : borrowerPts > 0
                ? `Trust score +${borrowerPts}`
                : `Trust score −${Math.abs(borrowerPts)}`,
            message: borrowerMsg,
            itemId: request.items.id,
            requestId,
            isRead: false,
          },
          {
            userId: request.items.ownerId!,
            type: "trust_score_changed",
            title: `Trust score +${lenderPts}`,
            message: `Lending completed +${lenderPts}`,
            itemId: request.items.id,
            requestId,
            isRead: false,
          },
        ]);
      } catch (trustError) {
        console.error("Error awarding trust points:", trustError);
        // Don't fail the return if trust scoring fails
      }

      // Award ShareCoins to borrower on return (lender already received coins at handoff)
      try {
        const borrowerCoins = await awardShareCoinsWithFirstTimeBonus(
          request.item_requests.requesterId,
          'BORROW',
          request.items.name,
          1
        );
        console.log(`✅ ShareCoins awarded on confirm-return: borrower=${borrowerCoins.totalAwarded}`);
      } catch (coinError) {
        console.error("Error awarding ShareCoins on return:", coinError);
        // Don't fail the return if coin award fails
      }

      // Check and award referral bonus for both users (first transaction completion)
      const transactionType = request.item_requests.requestType === 'RENT' ? 'RENT' : 'BORROW';
      await checkAndAwardReferralBonus(request.item_requests.requesterId, requestId, transactionType);
      await checkAndAwardReferralBonus(request.items.ownerId!, requestId, transactionType === 'RENT' ? 'RENT' : 'LEND');
      // Check and award any newly unlocked badges for both parties
      await checkAndAwardAchievements(request.item_requests.requesterId);
      if (request.items.ownerId) await checkAndAwardAchievements(request.items.ownerId);

      const inPerson = request.item_requests.depositMethod === "in_person";
      const returnMessage = isEarlyReturn
        ? (inPerson ? "Item returned early." : "Item returned early. Deposit hold lifted.")
        : (inPerson ? "Return confirmed!" : "Return confirmed! Deposit hold lifted.");

      res.json({
        success: true,
        request: updated,
        depositReleased: true,
        isEarlyReturn,
        message: returnMessage,
      });
    } catch (error: any) {
      console.error("Error confirming return:", error);
      res.status(500).json({ error: "Failed to confirm return" });
    }
  });

  // ── Uber Direct routes ──────────────────────────────────────────────────────

  // Check if Uber Direct is configured
  app.get("/api/uber/status", (req, res) => {
    res.json({ configured: uberDirect.isConfigured() });
  });

  // Get a real-time delivery quote
  app.post("/api/uber/quote", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    if (!uberDirect.isConfigured()) {
      return res.status(503).json({ error: "Uber Direct is not configured" });
    }

    const { pickupAddress, dropoffAddress, pickupPhone, dropoffPhone, manifestValueCents } = req.body;

    if (!pickupAddress || !dropoffAddress) {
      return res.status(400).json({ error: "pickupAddress and dropoffAddress are required" });
    }

    try {
      const quote = await uberDirect.getDeliveryQuote({
        pickupAddress,
        dropoffAddress,
        pickupPhone,
        dropoffPhone,
        manifestValueCents,
      });
      res.json(quote);
    } catch (err: any) {
      console.error("[Uber Direct] Quote error:", err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // Create a delivery (called after acceptance + deposit payment)
  app.post("/api/uber/create-delivery", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    if (!uberDirect.isConfigured()) {
      return res.status(503).json({ error: "Uber Direct is not configured" });
    }

    const {
      quoteId,
      pickupName, pickupAddress, pickupPhone,
      dropoffName, dropoffAddress, dropoffPhone,
      itemDescription, itemReference,
      requestId,
    } = req.body;

    try {
      const delivery = await uberDirect.createDelivery({
        quoteId, pickupName, pickupAddress, pickupPhone,
        dropoffName, dropoffAddress, dropoffPhone,
        itemDescription, itemReference,
      });

      // Persist the delivery ID + tracking URL on the arrangement
      if (requestId) {
        await db
          .update(deliveryArrangements)
          .set({
            uberDeliveryId: delivery.id,
            uberTrackingUrl: delivery.trackingUrl,
            status: "CONFIRMED",
          })
          .where(eq(deliveryArrangements.requestId, requestId));
      }

      res.json(delivery);
    } catch (err: any) {
      console.error("[Uber Direct] Create delivery error:", err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // Handoff-time delivery quote (sender-only, no transaction status change)
  // Helper: compute platform delivery fee for the user ($1.50 or $0 if Pro with quota remaining)
  async function getDeliveryPlatformFee(userId: number): Promise<{ platformFee: number; proDeliveriesUsed: number; proDeliveriesLimit: number; isPro: boolean }> {
    const PRO_LIMIT = 5;
    const [userRow] = await db
      .select({ subscriptionTier: users.subscriptionTier, proDeliveryCount: users.proDeliveryCount, proDeliveryResetAt: users.proDeliveryResetAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const isPro = userRow?.subscriptionTier === "pro";
    if (!isPro) return { platformFee: 1.50, proDeliveriesUsed: 0, proDeliveriesLimit: PRO_LIMIT, isPro: false };

    // Reset monthly count if a new calendar month has started
    const now = new Date();
    const resetAt = userRow.proDeliveryResetAt ? new Date(userRow.proDeliveryResetAt) : new Date(0);
    const isNewMonth = now.getFullYear() !== resetAt.getFullYear() || now.getMonth() !== resetAt.getMonth();
    let usedCount = Number(userRow.proDeliveryCount || 0);
    if (isNewMonth) {
      usedCount = 0;
      await db.update(users).set({ proDeliveryCount: 0, proDeliveryResetAt: now }).where(eq(users.id, userId));
    }

    const platformFee = usedCount < PRO_LIMIT ? 0 : 1.50;
    return { platformFee, proDeliveriesUsed: usedCount, proDeliveriesLimit: PRO_LIMIT, isPro: true };
  }

  app.post("/api/uber/handoff-quote", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const { requestId, pickupAddress, dropoffAddress } = req.body;
    if (!requestId || !pickupAddress || !dropoffAddress) {
      return res.status(400).json({ error: "requestId, pickupAddress and dropoffAddress are required" });
    }
    const userId = (req.user as any).id;
    const [request] = await db
      .select({ requesterId: itemRequests.requesterId })
      .from(itemRequests)
      .where(eq(itemRequests.id, requestId))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (request.requesterId !== userId) return res.status(403).json({ error: "Only the borrower can book a delivery" });

    const { platformFee, proDeliveriesUsed, proDeliveriesLimit, isPro } = await getDeliveryPlatformFee(userId);

    if (!uberDirect.isConfigured()) {
      return res.json({ uberFee: 12.00, platformFee, totalFee: 12.00 + platformFee, eta: "~30 min", quoteId: `sim_${Date.now()}`, proDeliveriesUsed, proDeliveriesLimit, isPro });
    }
    try {
      const quote = await uberDirect.getDeliveryQuote({ pickupAddress, dropoffAddress });
      const uberFee = quote.fee || 10;
      res.json({ uberFee, platformFee, totalFee: uberFee + platformFee, eta: "~30 min", quoteId: quote.id || `q_${Date.now()}`, proDeliveriesUsed, proDeliveriesLimit, isPro });
    } catch (err: any) {
      console.error("[Uber Direct] Handoff quote error:", err.message, "— falling back to simulated quote");
      res.json({ uberFee: 12.00, platformFee, totalFee: 12.00 + platformFee, eta: "~30 min", quoteId: `sim_${Date.now()}`, proDeliveriesUsed, proDeliveriesLimit, isPro });
    }
  });

  // Book handoff delivery (sender-only, charges Stripe saved card, no status change)
  app.post("/api/uber/book-handoff-delivery", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const { requestId, pickupAddress, dropoffAddress, quoteId } = req.body;
    if (!requestId || !pickupAddress || !dropoffAddress) {
      return res.status(400).json({ error: "requestId, pickupAddress and dropoffAddress are required" });
    }
    const userId = (req.user as any).id;

    // Verify caller is the borrower/requester for this request
    const [reqRow] = await db
      .select({ ownerId: items.ownerId, itemName: items.name, requesterId: itemRequests.requesterId })
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(eq(itemRequests.id, requestId))
      .limit(1);
    if (!reqRow) return res.status(404).json({ error: "Request not found" });
    if (reqRow.requesterId !== userId) return res.status(403).json({ error: "Only the borrower can book a delivery" });

    const { platformFee, proDeliveriesUsed, proDeliveriesLimit, isPro } = await getDeliveryPlatformFee(userId);

    if (!uberDirect.isConfigured()) {
      const trackingUrl = `https://track.uber.com/sim/${Date.now()}`;
      await db.insert(deliveryArrangements).values({
        requestId,
        deliveryType: "uber_direct",
        status: "CONFIRMED",
        uberTrackingUrl: trackingUrl,
        deliveryMargin: platformFee.toFixed(2),
      }).onConflictDoUpdate({
        target: deliveryArrangements.requestId,
        set: { uberTrackingUrl: trackingUrl, status: "CONFIRMED", deliveryMargin: platformFee.toFixed(2) },
      });
      // Increment Pro delivery count even in sim mode
      if (isPro && platformFee === 0 && proDeliveriesUsed < proDeliveriesLimit) {
        await db.update(users).set({ proDeliveryCount: proDeliveriesUsed + 1 }).where(eq(users.id, userId));
      }
      return res.json({ trackingUrl, platformFee, proDeliveriesUsed: isPro ? proDeliveriesUsed + (platformFee === 0 ? 1 : 0) : 0, proDeliveriesLimit });
    }

    try {
      const [requesterProfile] = await db
        .select({ stripeCustomerId: users.stripeCustomerId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      let trackingUrl: string;
      try {
        const delivery = await uberDirect.createDelivery({
          quoteId,
          pickupAddress,
          dropoffAddress,
          itemDescription: reqRow.itemName,
          itemReference: `req-${requestId}`,
        });
        trackingUrl = delivery.trackingUrl;

        // Charge platform fee via Stripe if applicable
        if (platformFee > 0 && requesterProfile?.stripeCustomerId) {
          const stripe = (await import("stripe")).default(process.env.STRIPE_SECRET_KEY!);
          const paymentMethods = await stripe.paymentMethods.list({ customer: requesterProfile.stripeCustomerId, type: "card" });
          if (paymentMethods.data.length > 0) {
            await stripe.paymentIntents.create({
              amount: Math.round(platformFee * 100),
              currency: "cad",
              customer: requesterProfile.stripeCustomerId,
              payment_method: paymentMethods.data[0].id,
              confirm: true,
              off_session: true,
              description: `ShareSwap private courier fee — request #${requestId}`,
            });
          }
        }

        // Increment Pro delivery count if this was a free delivery
        if (isPro && platformFee === 0 && proDeliveriesUsed < proDeliveriesLimit) {
          await db.update(users).set({ proDeliveryCount: proDeliveriesUsed + 1 }).where(eq(users.id, userId));
        }

        await db.insert(deliveryArrangements).values({
          requestId,
          deliveryType: "uber_direct",
          uberDeliveryId: delivery.id,
          uberTrackingUrl: trackingUrl,
          status: "CONFIRMED",
          deliveryMargin: platformFee.toFixed(2),
        }).onConflictDoUpdate({
          target: deliveryArrangements.requestId,
          set: { uberDeliveryId: delivery.id, uberTrackingUrl: trackingUrl, status: "CONFIRMED", deliveryMargin: platformFee.toFixed(2) },
        });
      } catch (apiErr: any) {
        console.error("[Uber Direct] Book handoff delivery error:", apiErr.message, "— falling back to simulated booking");
        trackingUrl = `https://track.uber.com/sim/${Date.now()}`;
        await db.insert(deliveryArrangements).values({
          requestId,
          deliveryType: "uber_direct",
          uberTrackingUrl: trackingUrl,
          status: "CONFIRMED",
          deliveryMargin: platformFee.toFixed(2),
        }).onConflictDoUpdate({
          target: deliveryArrangements.requestId,
          set: { uberTrackingUrl: trackingUrl, status: "CONFIRMED", deliveryMargin: platformFee.toFixed(2) },
        });
      }

      res.json({ trackingUrl });
    } catch (err: any) {
      console.error("[Uber Direct] Book handoff delivery unexpected error:", err.message);
      res.status(500).json({ error: "Failed to book delivery" });
    }
  });

  // Get live delivery status
  app.get("/api/uber/delivery/:deliveryId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    if (!uberDirect.isConfigured()) {
      return res.status(503).json({ error: "Uber Direct is not configured" });
    }

    try {
      const status = await uberDirect.getDeliveryStatus(req.params.deliveryId);
      res.json(status);
    } catch (err: any) {
      console.error("[Uber Direct] Status error:", err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // ── Delivery arrangements ────────────────────────────────────────────────────

  // Create or update delivery arrangement with delivery/deposit method choices
  app.post("/api/delivery-arrangements", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const {
        requestId,
        deliveryMethod,
        depositMethod,
        uberQuoteFee,
        uberQuoteId,
        pickupAddress,
        dropoffAddress,
        depositAmount,
        depositProcessingFee,
        stripePaymentIntentId,
      } = req.body;

      // Verify the request belongs to the user
      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      // Check if user is either owner or requester
      const isOwner = request.items.ownerId === req.user.id;
      const isRequester = request.item_requests.requesterId === req.user.id;

      if (!isOwner && !isRequester) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Calculate fees (frontend already calculated depositProcessingFee, so we use it directly)
      const deliveryMargin = deliveryMethod === 'shareswap_delivery' && uberQuoteFee ? 2.00 : null;
      const totalDeliveryFee = uberQuoteFee && deliveryMargin ? uberQuoteFee + deliveryMargin : null;
      const finalDepositProcessingFee = depositProcessingFee || (depositMethod === 'shareswap_deposit' && depositAmount ? depositAmount * 0.05 : null);

      // Check if arrangement already exists
      const [existingArrangement] = await db
        .select()
        .from(deliveryArrangements)
        .where(eq(deliveryArrangements.requestId, requestId))
        .limit(1);

      if (existingArrangement) {
        // Update existing arrangement
        const [updated] = await db
          .update(deliveryArrangements)
          .set({
            deliveryMethod,
            depositMethod,
            deliveryMargin: deliveryMargin?.toString(),
            totalDeliveryFee: totalDeliveryFee?.toString(),
            uberDeliveryFee: uberQuoteFee?.toString(),
            uberQuoteId: uberQuoteId || null,
            pickupAddress: pickupAddress || null,
            deliveryAddress: dropoffAddress || null,
            depositProcessingFee: finalDepositProcessingFee?.toString(),
            securityDeposit: depositAmount?.toString(),
            stripePaymentIntentId,
            stripeDepositStatus: stripePaymentIntentId ? 'authorized' : null,
          })
          .where(eq(deliveryArrangements.id, existingArrangement.id))
          .returning();

        res.json(updated);
      } else {
        // Create new arrangement
        const [newArrangement] = await db
          .insert(deliveryArrangements)
          .values({
            requestId,
            deliveryType: deliveryMethod === 'shareswap_delivery' ? 'UBER_DIRECT' : 'SELF_ARRANGE',
            deliveryMethod,
            depositMethod,
            deliveryMargin: deliveryMargin?.toString(),
            totalDeliveryFee: totalDeliveryFee?.toString(),
            uberDeliveryFee: uberQuoteFee?.toString(),
            uberQuoteId: uberQuoteId || null,
            pickupAddress: pickupAddress || null,
            deliveryAddress: dropoffAddress || null,
            depositProcessingFee: finalDepositProcessingFee?.toString(),
            securityDeposit: depositAmount?.toString(),
            stripePaymentIntentId,
            stripeDepositStatus: stripePaymentIntentId ? 'authorized' : null,
            status: "PENDING",
          })
          .returning();

        res.json(newArrangement);
      }
    } catch (error: any) {
      console.error("Error creating delivery arrangement:", error);
      res.status(500).json({ error: "Failed to create delivery arrangement: " + error.message });
    }
  });

  // Get user notifications
  app.get("/api/notifications", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const userNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, req.user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(20);

      res.json(userNotifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // Transaction detail page — full request with joined item and users
  app.get("/api/item-requests/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const requestId = parseInt(req.params.id);
    if (isNaN(requestId)) return res.status(400).json({ error: "Invalid id" });

    try {
      const ownerAlias = alias(users, "owner");
      const requesterAlias = alias(users, "requester");

      const [row] = await db
        .select({
          // Core request fields
          id: itemRequests.id,
          requestType: itemRequests.requestType,
          status: itemRequests.status,
          message: itemRequests.message,
          startDate: itemRequests.startDate,
          endDate: itemRequests.endDate,
          createdAt: itemRequests.createdAt,
          deliveryMethod: itemRequests.deliveryMethod,
          depositMethod: itemRequests.depositMethod,
          negotiationStatus: itemRequests.negotiationStatus,
          termsAcceptedAt: itemRequests.termsAcceptedAt,
          termsDeclinedAt: itemRequests.termsDeclinedAt,
          counterProposedAt: itemRequests.counterProposedAt,
          // Deposit
          trustDepositAmount: itemRequests.trustDepositAmount,
          trustDepositBaseAmount: itemRequests.trustDepositBaseAmount,
          trustDiscountPercentage: itemRequests.trustDiscountPercentage,
          depositStatus: itemRequests.depositStatus,
          depositAuthorizedAt: itemRequests.depositAuthorizedAt,
          depositReleasedAt: itemRequests.depositReleasedAt,
          // Rental
          rentalAmount: itemRequests.rentalAmount,
          rentalProcessingFee: itemRequests.rentalProcessingFee,
          // Handoff
          confirmationMethod: itemRequests.confirmationMethod,
          handoffConfirmedAt: itemRequests.handoffConfirmedAt,
          borrowPeriodStartedAt: itemRequests.borrowPeriodStartedAt,
          actualHandoffAt: itemRequests.actualHandoffAt,
          actualReturnAt: itemRequests.actualReturnAt,
          handoffDisputeTriggered: itemRequests.handoffDisputeTriggered,
          handoffDisputeAt: itemRequests.handoffDisputeAt,
          handoffProofOwner: itemRequests.handoffProofOwner,
          handoffProofBorrower: itemRequests.handoffProofBorrower,
          // Return
          returnRequestedAt: itemRequests.returnRequestedAt,
          returnConfirmedAt: itemRequests.returnConfirmedAt,
          returnConditionOk: itemRequests.returnConditionOk,
          returnConditionNotes: itemRequests.returnConditionNotes,
          returnConditionRating: itemRequests.returnConditionRating,
          returnDisputeTriggered: itemRequests.returnDisputeTriggered,
          returnDisputeReason: itemRequests.returnDisputeReason,
          // Item
          itemId: items.id,
          itemName: items.name,
          itemDescription: items.description,
          itemPhotos: items.photos,
          itemCategory: items.category,
          itemReplacementValue: items.replacementValue,
          itemTier: items.tier,
          // Owner user
          ownerId: ownerAlias.id,
          ownerUsername: ownerAlias.username,
          ownerHandle: ownerAlias.handle,
          ownerDisplayName: ownerAlias.displayName,
          ownerIsVerified: ownerAlias.isVerified,
          ownerReputationLevel: ownerAlias.reputationLevel,
          ownerTrustScore: ownerAlias.trustScore,
          ownerAvatar: ownerAlias.avatarUrl,
          // Requester user
          requesterId: requesterAlias.id,
          requesterUsername: requesterAlias.username,
          requesterHandle: requesterAlias.handle,
          requesterDisplayName: requesterAlias.displayName,
          requesterIsVerified: requesterAlias.isVerified,
          requesterReputationLevel: requesterAlias.reputationLevel,
          requesterTrustScore: requesterAlias.trustScore,
          requesterAvatar: requesterAlias.avatarUrl,
        })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .innerJoin(ownerAlias, eq(ownerAlias.id, items.ownerId))
        .innerJoin(requesterAlias, eq(requesterAlias.id, itemRequests.requesterId))
        .where(
          and(
            eq(itemRequests.id, requestId),
            or(
              eq(items.ownerId, req.user.id),
              eq(itemRequests.requesterId, req.user.id)
            )
          )
        )
        .limit(1);

      if (!row) return res.status(404).json({ error: "Transaction not found" });
      res.json(row);
    } catch (error) {
      console.error("Error fetching item request detail:", error);
      res.status(500).json({ error: "Failed to fetch transaction" });
    }
  });

  // ── Extension Requests ──────────────────────────────────────────────────────

  // GET pending extension for a request
  app.get("/api/requests/:id/extension", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const requestId = parseInt(req.params.id);
    if (isNaN(requestId)) return res.status(400).json({ error: "Invalid id" });
    try {
      const [ext] = await db
        .select()
        .from(extensionRequests)
        .where(
          and(
            eq(extensionRequests.requestId, requestId),
            eq(extensionRequests.status, "pending")
          )
        )
        .orderBy(desc(extensionRequests.createdAt))
        .limit(1);
      res.json(ext || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch extension request" });
    }
  });

  // POST borrower requests an extension
  app.post("/api/requests/:id/extension", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const requestId = parseInt(req.params.id);
    if (isNaN(requestId)) return res.status(400).json({ error: "Invalid id" });
    const { days } = req.body;
    const addDays = parseInt(days);
    if (![1, 2, 3].includes(addDays)) return res.status(400).json({ error: "days must be 1, 2, or 3" });

    try {
      const result = await db.transaction(async (tx) => {
        // Serialize extension state transitions with return initiation and
        // concurrent requests for this borrow.
        await tx.execute(sql`
          SELECT 1 FROM ${itemRequests}
          WHERE ${itemRequests.id} = ${requestId}
          FOR UPDATE
        `);

        const [borrow] = await tx
          .select({
            requesterId: itemRequests.requesterId,
            ownerId: items.ownerId,
            itemId: itemRequests.itemId,
            status: itemRequests.status,
            endDate: itemRequests.endDate,
            itemName: items.name,
          })
          .from(itemRequests)
          .innerJoin(items, eq(items.id, itemRequests.itemId))
          .where(eq(itemRequests.id, requestId))
          .limit(1);

        if (!borrow) return { status: 404, error: "Request not found" };
        if (borrow.requesterId !== req.user.id) return { status: 403, error: "Not your borrow" };
        if (borrow.status !== "IN_PROGRESS") return { status: 400, error: "Can only extend in-progress borrows" };
        if (borrow.endDate && new Date() > borrow.endDate) {
          return { status: 400, error: "Item is overdue — extensions no longer available" };
        }

        const [alreadyUsed] = await tx
          .select({ id: extensionRequests.id })
          .from(extensionRequests)
          .where(and(eq(extensionRequests.requestId, requestId), eq(extensionRequests.status, "accepted")))
          .limit(1);
        if (alreadyUsed) return { status: 400, error: "Extension already used for this transaction" };
        if (!borrow.endDate) return { status: 400, error: "Borrow has no end date" };

        const newEnd = new Date(borrow.endDate);
        newEnd.setDate(newEnd.getDate() + addDays);

        // A new request replaces an unanswered request; the row lock ensures
        // that the owner cannot accept the replaced request concurrently.
        await tx
          .update(extensionRequests)
          .set({ status: "declined", respondedAt: new Date() })
          .where(and(eq(extensionRequests.requestId, requestId), eq(extensionRequests.status, "pending")));

        const [ext] = await tx
          .insert(extensionRequests)
          .values({
            requestId,
            borrowerId: req.user.id,
            ownerId: borrow.ownerId,
            requestedEndDate: newEnd,
            status: "pending",
            message: `+${addDays} day${addDays > 1 ? "s" : ""}`,
          })
          .returning();

        // Asking for more time records the one communication credit. Preserve
        // it when a borrower changes an unanswered extension request.
        await tx
          .update(itemRequests)
          .set({
            returnDelayNotifiedAt: sql`COALESCE(${itemRequests.returnDelayNotifiedAt}, NOW())`,
            returnDelayReason: sql`COALESCE(${itemRequests.returnDelayReason}, 'Borrower requested an extension in advance')`,
          })
          .where(eq(itemRequests.id, requestId));

        const borrowerName = (req.user as any).displayName || req.user.username || "The borrower";
        const [extensionNotification] = await tx.insert(notifications).values({
          userId: borrow.ownerId,
          type: "extension_requested",
          title: "Short Extension Requested",
          message: `${borrowerName.slice(0, 15)} wants +${addDays}d for "${borrow.itemName.length > 18 ? borrow.itemName.slice(0, 18) + "…" : borrow.itemName}" (due ${newEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}).`,
          itemId: borrow.itemId,
          requestId,
          isRead: false,
        }).returning();

        const [extensionMessage] = await tx.insert(messages).values({
          content: `⏳ Extension requested: +${addDays} day${addDays > 1 ? "s" : ""} (new return date: ${newEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`,
          senderId: req.user.id,
          receiverId: borrow.ownerId,
          requestId,
          messageType: "event",
          metadata: {
            eventType: "extension_requested",
            days: addDays,
            requestedEndDate: newEnd.toISOString(),
            extensionId: ext.id,
          },
        }).returning();

        return { ext, borrow, extensionNotification, extensionMessage };
      });

      if ("error" in result) return res.status(result.status).json({ error: result.error });

      const ownerWs = connectedClients.get(result.borrow.ownerId);
      if (ownerWs?.readyState === WebSocket.OPEN) {
        ownerWs.send(JSON.stringify({ type: "new_message", message: result.extensionMessage }));
        ownerWs.send(JSON.stringify({ type: "new_notification", notification: result.extensionNotification }));
      }
      sendPushToUser(
        result.borrow.ownerId,
        {
          title: result.extensionNotification.title,
          body: result.extensionNotification.message,
          data: {
            screen: "chat",
            chatUserId: req.user.id,
            requestId,
            itemId: result.borrow.itemId,
          },
        },
        "requests",
      ).catch(() => {});

      res.json(result.ext);
    } catch (error) {
      console.error("Extension request error:", error);
      res.status(500).json({ error: "Failed to create extension request" });
    }
  });

  // POST owner responds to extension (accept / decline)
  app.post("/api/requests/:id/extension/respond", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const requestId = parseInt(req.params.id);
    if (isNaN(requestId)) return res.status(400).json({ error: "Invalid id" });
    const { action } = req.body; // "accept" | "decline"
    if (!["accept", "decline"].includes(action)) return res.status(400).json({ error: "action must be accept or decline" });

    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT 1 FROM ${itemRequests}
          WHERE ${itemRequests.id} = ${requestId}
          FOR UPDATE
        `);

        const [pending] = await tx
          .select()
          .from(extensionRequests)
          .where(and(eq(extensionRequests.requestId, requestId), eq(extensionRequests.status, "pending")))
          .orderBy(desc(extensionRequests.createdAt))
          .limit(1);
        if (!pending) return { status: 404, error: "No pending extension request" };
        if (pending.ownerId !== req.user.id) return { status: 403, error: "Not your item" };

        const [requestRow] = await tx
          .select({ status: itemRequests.status })
          .from(itemRequests)
          .where(eq(itemRequests.id, requestId))
          .limit(1);
        if (requestRow?.status !== "IN_PROGRESS") {
          return {
            status: 400,
            error: "This item is being returned, so the extension can no longer be approved.",
          };
        }

        if (action === "accept") {
          const [alreadyAccepted] = await tx
            .select({ id: extensionRequests.id })
            .from(extensionRequests)
            .where(and(eq(extensionRequests.requestId, requestId), eq(extensionRequests.status, "accepted")))
            .limit(1);
          if (alreadyAccepted) {
            return { status: 400, error: "An extension has already been used for this transaction." };
          }
        }

        if (action === "accept") {
          const [updatedRequest] = await tx
            .update(itemRequests)
            .set({ endDate: pending.requestedEndDate })
            .where(and(eq(itemRequests.id, requestId), eq(itemRequests.status, "IN_PROGRESS")))
            .returning({ id: itemRequests.id });
          if (!updatedRequest) {
            throw Object.assign(
              new Error("The item is already being returned, so the extension cannot be approved."),
              { status: 409 },
            );
          }
        }

        const newStatus = action === "accept" ? "accepted" : "declined";
        const [updatedExtension] = await tx
          .update(extensionRequests)
          .set({ status: newStatus, respondedAt: new Date() })
          .where(and(eq(extensionRequests.id, pending.id), eq(extensionRequests.status, "pending")))
          .returning({ id: extensionRequests.id });
        if (!updatedExtension) {
          throw Object.assign(new Error("This extension request was already handled."), { status: 409 });
        }

        const [borrowRow] = await tx
          .select({ itemName: items.name })
          .from(itemRequests)
          .innerJoin(items, eq(items.id, itemRequests.itemId))
          .where(eq(itemRequests.id, requestId))
          .limit(1);

        await tx.insert(notifications).values({
          userId: pending.borrowerId,
          type: action === "accept" ? "extension_accepted" : "extension_declined",
          title: action === "accept" ? "Extension accepted!" : "Extension declined",
          message: action === "accept"
            ? `Your return date for "${borrowRow?.itemName}" has been extended to ${pending.requestedEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`
            : `Your extension request for "${borrowRow?.itemName}" was declined.`,
          requestId,
          isRead: false,
        });

        const newDateStr = pending.requestedEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        await tx.insert(messages).values({
          content: action === "accept"
            ? `✅ Extension accepted — new return date: ${newDateStr}`
            : `❌ Extension declined`,
          senderId: req.user.id,
          receiverId: pending.borrowerId,
          requestId,
          messageType: "event",
          metadata: {
            eventType: action === "accept" ? "extension_accepted" : "extension_declined",
            requestedEndDate: pending.requestedEndDate.toISOString(),
          },
        });

        return { status: 200, newStatus };
      });

      if ("error" in result) return res.status(result.status).json({ error: result.error });
      res.json({ success: true, status: result.newStatus });
    } catch (error: any) {
      console.error("Extension respond error:", error);
      res.status(error.status || 500).json({ error: error.message || "Failed to respond to extension" });
    }
  });

  // GET all active extensions (pending + accepted) involving the current user
  app.get("/api/extensions/active", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const exts = await db
        .select()
        .from(extensionRequests)
        .where(
          and(
            or(
              eq(extensionRequests.status, "pending"),
              eq(extensionRequests.status, "accepted")
            ),
            or(
              eq(extensionRequests.borrowerId, req.user.id),
              eq(extensionRequests.ownerId, req.user.id)
            )
          )
        );
      res.json(exts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch extensions" });
    }
  });

  // Mark notification as read
  app.patch("/api/notifications/:id/read", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const notificationId = parseInt(req.params.id);

    try {
      const [updated] = await db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.userId, req.user.id)
          )
        )
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Notification not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ error: "Failed to update notification" });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/read-all", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.userId, req.user.id),
            eq(notifications.isRead, false)
          )
        );

      res.json({ success: true });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ error: "Failed to update notifications" });
    }
  });

  // Get unread notification count
  app.get("/api/notifications/unread-count", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, req.user.id),
            eq(notifications.isRead, false)
          )
        );

      res.json({ count: result.count });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  // Check and generate return reminders for active borrows/rentals.
  // Supplying a user ID scopes the work to their items/borrows; the server-side
  // sweep deliberately evaluates every active transaction.
  async function processReturnReminders(userId?: number): Promise<{ remindersCreated: number }> {
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const twoDaysFromNow = new Date(now);
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
      const userScope = userId === undefined
        ? sql`TRUE`
        : or(
            eq(itemRequests.requesterId, userId),
            eq(items.ownerId, userId),
          );

      const activeRequests = await db
        .select({
          request: itemRequests,
          item: items,
          owner: users,
        })
        .from(itemRequests)
        .innerJoin(items, eq(itemRequests.itemId, items.id))
        .innerJoin(users, eq(items.ownerId, users.id))
        .where(
          and(
            userScope,
            or(
              and(
                eq(itemRequests.requestType, "BORROW"),
                inArray(itemRequests.status, ACTIVE_OVERDUE_BORROW_STATUSES),
              ),
              and(
                eq(itemRequests.requestType, "RENT"),
                eq(itemRequests.status, "IN_PROGRESS"),
              ),
            ),
            sql`${itemRequests.endDate} IS NOT NULL AND ${itemRequests.endDate} <= ${twoDaysFromNow}`,
          ),
        );

      let remindersCreated = 0;

      const createReminder = async (
        recipientId: number,
        requestId: number,
        itemId: number,
        type: string,
        title: string,
        message: string,
      ) => {
        const existingNotification = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, recipientId),
              eq(notifications.requestId, requestId),
              eq(notifications.type, type),
              gte(notifications.createdAt, todayStart),
            ),
          )
          .limit(1);

        if (existingNotification.length > 0) return;

        await db.insert(notifications).values({
          userId: recipientId,
          type,
          title,
          message,
          itemId,
          requestId,
          isRead: false,
        });
        remindersCreated++;

        sendPushToUser(recipientId, {
          title,
          body: message,
          data: { screen: "notifications", requestId, itemId },
        }, "requests").catch((err) =>
          console.error("[push] return-reminder push failed:", err),
        );
      };

      for (const { request, item, owner } of activeRequests) {
        if (!request.endDate) continue;

        const daysOverdue = daysOverdueAgainstDueDate(now, request.endDate);
        const daysUntilReturn = daysOverdue > 0
          ? -daysOverdue
          : Math.ceil((new Date(request.endDate).getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));

        if (
          request.requestType === "BORROW" &&
          isBorrowingRestricted(daysOverdue)
        ) {
          const [borrower] = await db
            .select({ displayName: users.displayName, username: users.username })
            .from(users)
            .where(eq(users.id, request.requesterId))
            .limit(1);
          const borrowerName = borrower?.displayName || borrower?.username || "the borrower";
          const serious = isSeriousOverdue(daysOverdue);
          const reminderType = serious
            ? "return_reminder_serious_overdue"
            : "return_reminder_overdue_restricted";
          const title = serious
            ? `Serious overdue: ${daysOverdue}d`
            : `Return overdue by ${daysOverdue}d`;

          if (serious) {
            const penalty = await applySeriousOverduePenalty(
              request.requesterId,
              owner.id,
              request.id,
              item.id,
              daysOverdue,
            );
            if (penalty.pointsAwarded !== 0) {
              const penaltyTitle = `Trust score −${Math.abs(penalty.pointsAwarded)}`;
              const penaltyMessage = `"${item.name}" is ${daysOverdue} days overdue. A serious overdue penalty was applied.`;
              await db.insert(notifications).values({
                userId: request.requesterId,
                type: "trust_score_changed",
                title: penaltyTitle,
                message: penaltyMessage,
                itemId: item.id,
                requestId: request.id,
                isRead: false,
              });
              sendPushToUser(request.requesterId, {
                title: penaltyTitle,
                body: penaltyMessage,
                data: { screen: "notifications", requestId: request.id, itemId: item.id },
              }, "requests").catch(() => {});
            }
          }

          await Promise.all([
            createReminder(
              request.requesterId,
              request.id,
              item.id,
              reminderType,
              title,
              serious
                ? `"${item.name}" is seriously overdue. Return it to ${owner.displayName || owner.username} immediately.`
                : `"${item.name}" is ${daysOverdue} days overdue. Return it now before starting another borrow.`,
            ),
            createReminder(
              owner.id,
              request.id,
              item.id,
              reminderType,
              title,
              serious
                ? `"${item.name}" is seriously overdue with ${borrowerName}. Please coordinate an immediate return.`
                : `"${item.name}" is ${daysOverdue} days overdue with ${borrowerName}. Please arrange its return.`,
            ),
          ]);
          continue;
        }

        // Keep the existing due-tomorrow, due-today, and ordinary overdue
        // reminders for the borrower. Owners receive the new two-party
        // escalation only after the 7-day threshold.
        if (userId !== undefined && request.requesterId !== userId) continue;

        if (daysUntilReturn === 1) {
          await createReminder(
            request.requesterId,
            request.id,
            item.id,
            "return_reminder_tomorrow",
            "Return due tomorrow",
            `"${item.name}" is due back to ${owner.displayName || owner.username} tomorrow.`,
          );
        } else if (daysUntilReturn === 0) {
          await createReminder(
            request.requesterId,
            request.id,
            item.id,
            "return_reminder_today",
            "Return due today",
            `"${item.name}" must be returned to ${owner.displayName || owner.username} today.`,
          );
        } else if (daysOverdue > 0) {
          await createReminder(
            request.requesterId,
            request.id,
            item.id,
            "return_reminder_overdue",
            `Return overdue by ${daysOverdue}d`,
            `"${item.name}" is ${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue. Return to ${owner.displayName || owner.username} now.`,
          );
        }
      }

      return { remindersCreated };
  }

  // At 7+ days overdue, BORROW reminders escalate to both parties; at 15+
  // they are treated as serious overdue and apply the one-time penalty.
  app.post("/api/notifications/check-return-reminders", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      res.json(await processReturnReminders(req.user.id));
    } catch (error) {
      console.error("Error checking return reminders:", error);
      res.status(500).json({ error: "Failed to check return reminders" });
    }
  });

  // Native clients check on launch, resume, and while active. This sweep also
  // enforces overdue escalation when neither borrower nor owner opens the app.
  const runOverdueReminderSweep = () => {
    processReturnReminders().catch((error) =>
      console.error("Error running overdue reminder sweep:", error),
    );
  };
  setTimeout(() => {
    runOverdueReminderSweep();
    setInterval(runOverdueReminderSweep, 6 * 60 * 60 * 1000);
  }, 30 * 1000);

  // Get statistics for public display
  app.get("/api/stats", async (req, res) => {
    try {
      // Get total count of shared items
      const [itemsCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(items);

      // Get total users count
      const [usersCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users);

      // Get total successful transactions (accepted requests)
      const [transactionsCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .where(eq(itemRequests.status, "ACCEPTED"));

      res.json({
        itemsShared: itemsCount.count,
        totalUsers: usersCount.count,
        successfulTransactions: transactionsCount.count,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).send("Error fetching platform statistics");
    }
  });

  // Fee waiver status: first 3 completed transactions are free, then standard fees apply
  app.get("/api/user/fee-waiver-status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(itemRequests)
        .where(
          and(
            eq(itemRequests.requesterId, req.user.id),
            inArray(itemRequests.status, ["ACTIVE", "RETURNED", "COMPLETED"]),
          ),
        );
      const completedCount = Number(count);
      const FREE_TRANSACTIONS = 3;
      const feeWaived = completedCount < FREE_TRANSACTIONS;
      res.json({
        completedCount,
        feeWaived,
        remainingFree: Math.max(0, FREE_TRANSACTIONS - completedCount),
        totalFree: FREE_TRANSACTIONS,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch fee waiver status" });
    }
  });

  // Get user stats for achievements page
  app.get("/api/user-stats", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const userId = req.user.id;

      const completedStatuses = or(eq(itemRequests.status, "COMPLETED"), eq(itemRequests.status, "COMPLETED_EARLY"));

      // Count items borrowed (as requester with BORROW type and COMPLETED status)
      const [borrowedCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .where(and(
          eq(itemRequests.requesterId, userId),
          eq(itemRequests.requestType, "BORROW"),
          completedStatuses
        ));

      // Count items lent (as owner with COMPLETED status)
      const [lentCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(and(
          eq(items.ownerId, userId),
          completedStatuses
        ));

      // Count swaps completed
      const [swapCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .where(and(
          or(
            eq(itemRequests.requesterId, userId),
            sql`${itemRequests.itemId} IN (SELECT id FROM items WHERE owner_id = ${userId})`
          ),
          eq(itemRequests.requestType, "SWAP"),
          completedStatuses
        ));

      // Count gifts given (as owner with GIFT type)
      const [giftCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(and(
          eq(items.ownerId, userId),
          eq(itemRequests.requestType, "GIFT"),
          completedStatuses
        ));

      // Count successful handoffs (only COMPLETED transactions)
      const [handoffCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .where(and(
          or(
            eq(itemRequests.requesterId, userId),
            sql`${itemRequests.itemId} IN (SELECT id FROM items WHERE owner_id = ${userId})`
          ),
          completedStatuses
        ));

      // Fast Responder: 5+ completed requests (as owner) resolved within 48 hours
      const [fastResponderCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(and(
          eq(items.ownerId, userId),
          or(eq(itemRequests.status, "COMPLETED"), eq(itemRequests.status, "COMPLETED_EARLY")),
          sql`item_requests.accepted_at < item_requests.created_at + interval '48 hours'`
        ));

      // Five-Star Neighbour: 5+ reviews received with avg rating >= 4.8
      const [ratingRow] = await db
        .select({
          cnt: sql<number>`count(*)`,
          avg: sql<number>`avg(${userReviews.rating})`
        })
        .from(userReviews)
        .where(eq(userReviews.reviewedUserId, userId));

      // Count successful referrals (friend completed first transaction)
      const [referralCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(and(eq(referrals.referrerId, userId), eq(referrals.isRewardClaimed, true)));

      // Count urgent requests helped (responded to high urgency wishlists within 24 hours)
      // For now, count if user has lent to requests that came from wishlists
      const [urgentCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .innerJoin(wishlists, sql`${wishlists.itemName} ILIKE '%' || ${items.name} || '%'`)
        .where(and(
          eq(items.ownerId, userId),
          or(eq(itemRequests.status, "COMPLETED"), eq(itemRequests.status, "COMPLETED_EARLY")),
          eq(wishlists.urgency, "urgent")
        ));

      // Count reviews left by this user for others
      const [reviewsLeftCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(userReviews)
        .where(eq(userReviews.reviewerId, userId));

      // Count reviews received by this user
      const [reviewsReceivedCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(userReviews)
        .where(eq(userReviews.reviewedUserId, userId));

      // Count items listed by user
      const [itemsListedCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(items)
        .where(eq(items.ownerId, userId));

      // Count completed transactions in past 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [weeklyActivityCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .where(and(
          or(
            eq(itemRequests.requesterId, userId),
            sql`${itemRequests.itemId} IN (SELECT id FROM items WHERE owner_id = ${userId})`
          ),
          or(eq(itemRequests.status, "COMPLETED"), eq(itemRequests.status, "COMPLETED_EARLY")),
          sql`item_requests.created_at >= ${sevenDaysAgo}`,
        ));

      // Count courier deliveries (any side)
      const [courierCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .where(and(
          or(
            eq(itemRequests.requesterId, userId),
            sql`${itemRequests.itemId} IN (SELECT id FROM items WHERE owner_id = ${userId})`
          ),
          or(eq(itemRequests.status, "COMPLETED"), eq(itemRequests.status, "COMPLETED_EARLY")),
          eq(itemRequests.deliveryMethod, "courier"),
        ));

      // Photo Pro: any item owned by user with 5+ photos
      const [photoProRow] = await db
        .select({ cnt: sql<number>`count(*)` })
        .from(items)
        .where(and(eq(items.ownerId, userId), sql`array_length(items.photos, 1) >= 5`));

      // Good Neighbour: same item lent to 3+ distinct borrowers
      const gnResult = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM (
          SELECT item_requests.item_id FROM item_requests
          INNER JOIN items ON items.id = item_requests.item_id
          WHERE items.owner_id = ${userId}
          AND item_requests.status IN ('COMPLETED','COMPLETED_EARLY')
          GROUP BY item_requests.item_id
          HAVING COUNT(DISTINCT item_requests.requester_id) >= 3
        ) AS subq
      `);
      const goodNeighbourCount = Number((gnResult.rows?.[0] as any)?.cnt || 0);

      // Welcome Wagon: completed txn with a user who joined within 30 days before the transaction
      const wwResult = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM item_requests ir
        INNER JOIN items i ON i.id = ir.item_id
        WHERE ir.status IN ('COMPLETED','COMPLETED_EARLY')
        AND (
          (i.owner_id = ${userId} AND EXISTS (
            SELECT 1 FROM users u WHERE u.id = ir.requester_id
            AND ir.created_at >= u.created_at
            AND ir.created_at - u.created_at < INTERVAL '30 days'
          ))
          OR
          (ir.requester_id = ${userId} AND EXISTS (
            SELECT 1 FROM users u WHERE u.id = i.owner_id
            AND ir.created_at >= u.created_at
            AND ir.created_at - u.created_at < INTERVAL '30 days'
          ))
        )
      `);
      const welcomeWagonCount = Number((wwResult.rows?.[0] as any)?.cnt || 0);

      // Wishlist item count
      const [wishlistRow] = await db
        .select({ cnt: sql<number>`count(*)` })
        .from(wishlists)
        .where(eq(wishlists.userId, userId));

      // Total ShareCoins ever earned (sum of positive transactions — unaffected by spending)
      const [earnedCoinsRow] = await db
        .select({ total: sql<number>`coalesce(sum(amount), 0)` })
        .from(shareCoinsTransactions)
        .where(and(eq(shareCoinsTransactions.userId, userId), sql`amount > 0`));

      res.json({
        totalBorrowed: Number(borrowedCount?.count || 0),
        totalLent: Number(lentCount?.count || 0),
        totalSwaps: Number(swapCount?.count || 0),
        totalGifts: Number(giftCount?.count || 0),
        successfulHandoffs: Number(handoffCount?.count || 0),
        referrals: Number(referralCount?.count || 0),
        helpedUrgent: Math.min(Number(urgentCount?.count || 0), 1),
        reviewsLeft: Number(reviewsLeftCount?.count || 0),
        reviewsReceived: Number(reviewsReceivedCount?.count || 0),
        itemsListed: Number(itemsListedCount?.count || 0),
        weeklyActivity: Number(weeklyActivityCount?.count || 0),
        fastResponder: Number(fastResponderCount?.count || 0) >= 5,
        fiveStarNeighbour: Number(ratingRow?.cnt || 0) >= 5 && Number(ratingRow?.avg || 0) >= 4.8,
        earlyMember: !!(req.user.createdAt && new Date(req.user.createdAt) < new Date('2026-09-01')),
        courierDeliveries: Number(courierCount?.count || 0),
        totalShareCoinsEarned: Number(earnedCoinsRow?.total || 0),
        wishlistCount: Number(wishlistRow?.cnt || 0),
        goodNeighbour: goodNeighbourCount >= 1,
        photoPro: Number(photoProRow?.cnt || 0) >= 1,
        welcomeWagon: welcomeWagonCount >= 1,
      });
    } catch (error) {
      console.error("Error fetching user stats:", error);
      res.status(500).json({ error: "Failed to fetch user stats" });
    }
  });

  // Pro analytics dashboard
  app.get("/api/analytics/dashboard", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = req.user.id;
    const completedStatuses = or(eq(itemRequests.status, "COMPLETED"), eq(itemRequests.status, "COMPLETED_EARLY"));

    try {
      const now = new Date();
      // Build last 6 calendar months
      const months: { year: number; month: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
      }
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Monthly completed transactions (as requester OR as owner)
      const activityRows = await db
        .select({
          year: sql<number>`EXTRACT(YEAR FROM ${itemRequests.createdAt})::int`,
          month: sql<number>`EXTRACT(MONTH FROM ${itemRequests.createdAt})::int`,
          count: sql<number>`count(*)`,
        })
        .from(itemRequests)
        .leftJoin(items, eq(items.id, itemRequests.itemId))
        .where(and(
          or(eq(itemRequests.requesterId, userId), eq(items.ownerId, userId)),
          completedStatuses,
          sql`${itemRequests.createdAt} >= ${sixMonthsAgo}`
        ))
        .groupBy(
          sql`EXTRACT(YEAR FROM ${itemRequests.createdAt})`,
          sql`EXTRACT(MONTH FROM ${itemRequests.createdAt})`
        );

      // ShareCoin flow by month
      const coinRows = await db
        .select({
          year: sql<number>`EXTRACT(YEAR FROM ${shareCoinsTransactions.createdAt})::int`,
          month: sql<number>`EXTRACT(MONTH FROM ${shareCoinsTransactions.createdAt})::int`,
          type: shareCoinsTransactions.transactionType,
          total: sql<number>`SUM(ABS(${shareCoinsTransactions.amount}::numeric))`,
        })
        .from(shareCoinsTransactions)
        .where(and(
          eq(shareCoinsTransactions.userId, userId),
          sql`${shareCoinsTransactions.createdAt} >= ${sixMonthsAgo}`
        ))
        .groupBy(
          sql`EXTRACT(YEAR FROM ${shareCoinsTransactions.createdAt})`,
          sql`EXTRACT(MONTH FROM ${shareCoinsTransactions.createdAt})`,
          shareCoinsTransactions.transactionType
        );

      // Rental earnings all time
      const [rentalAll] = await db
        .select({ total: sql<string>`COALESCE(SUM(${itemRequests.rentalAmount}::numeric), 0)` })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(and(eq(items.ownerId, userId), eq(itemRequests.requestType, "RENT"), completedStatuses));

      // Rental earnings this month
      const [rentalMonth] = await db
        .select({ total: sql<string>`COALESCE(SUM(${itemRequests.rentalAmount}::numeric), 0)` })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(and(
          eq(items.ownerId, userId),
          eq(itemRequests.requestType, "RENT"),
          completedStatuses,
          sql`${itemRequests.createdAt} >= ${startOfMonth}`
        ));

      // Top 3 most requested items owned by user
      const topItems = await db
        .select({
          name: items.name,
          requests: sql<number>`count(*)`,
        })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(items.ownerId, userId))
        .groupBy(items.name)
        .orderBy(desc(sql`count(*)`))
        .limit(3);

      // Lifetime counts
      const [lifetimeBorrows] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .where(and(eq(itemRequests.requesterId, userId), eq(itemRequests.requestType, "BORROW"), completedStatuses));

      const [lifetimeLends] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(and(eq(items.ownerId, userId), completedStatuses));

      const [lifetimeRentals] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(and(eq(items.ownerId, userId), eq(itemRequests.requestType, "RENT"), completedStatuses));

      // Build month labels
      const monthLabels = months.map(({ year, month }) =>
        new Date(year, month - 1).toLocaleString("en-US", { month: "short" })
      );

      const activityByMonth = months.map(({ year, month }) =>
        Number(activityRows.find(r => r.year === year && r.month === month)?.count || 0)
      );

      const coinsEarnedByMonth = months.map(({ year, month }) =>
        Number(coinRows.find(r => r.year === year && r.month === month && r.type === "EARNED")?.total || 0)
      );
      const coinsSpentByMonth = months.map(({ year, month }) =>
        Number(coinRows.find(r => r.year === year && r.month === month && r.type === "SPENT")?.total || 0)
      );

      res.json({
        monthLabels,
        activityByMonth,
        coinsEarnedByMonth,
        coinsSpentByMonth,
        rentalEarningsAllTime: parseFloat(rentalAll?.total || "0"),
        rentalEarningsThisMonth: parseFloat(rentalMonth?.total || "0"),
        lifetimeBorrows: Number(lifetimeBorrows?.count || 0),
        lifetimeLends: Number(lifetimeLends?.count || 0),
        lifetimeRentals: Number(lifetimeRentals?.count || 0),
        topItems: topItems.map(r => ({ name: r.name, requests: Number(r.requests) })),
      });
    } catch (error) {
      console.error("Analytics dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  // Get user profile
  app.get("/api/user-profile", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          displayNameChangedAt: users.displayNameChangedAt,
          fullName: users.fullName,
          bio: users.bio,
          location: users.location,
          phone: users.phone,
          profilePhoto: users.profilePhoto,
          isVerified: users.isVerified,
          shareCoins: users.shareCoins,
          reputationScore: users.reputationScore,
          reputationLevel: users.reputationLevel,
          isPremium: users.isPremium,
          createdAt: users.createdAt,
          phoneVerified: users.phoneVerified,
          googleId: users.googleId,
          authProvider: users.authProvider,
          emailVerified: users.emailVerified,
          stripePaymentMethodId: users.stripePaymentMethodId,
          paymentMethodLast4: users.paymentMethodLast4,
          paymentMethodBrand: users.paymentMethodBrand,
          lastActiveAt: users.lastActiveAt,
        })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check ID verification status from verifications table
      const [idVerification] = await db
        .select({ status: verifications.status })
        .from(verifications)
        .where(and(
          eq(verifications.userId, req.user.id),
          eq(verifications.status, "approved")
        ))
        .limit(1);

      const idVerified = !!idVerification;
      const paymentVerified = !!user.stripePaymentMethodId;
      const isVerified = idVerified && paymentVerified;

      const uid = req.user.id;
      const [
        completedSharesResult,
        completedBorrows,
        uniqueSenders,
        uniqueRecipients,
        issuesResult,
        activeStatus,
        responseTime,
        reviewStats,
      ] = await Promise.all([
        db.select({ count: sql<number>`count(*)` })
          .from(itemRequests).innerJoin(items, eq(itemRequests.itemId, items.id))
          .where(and(
            or(eq(itemRequests.requesterId, uid), sql`${items.ownerId} = ${uid}`),
            or(eq(itemRequests.status, 'COMPLETED'), eq(itemRequests.status, 'COMPLETED_EARLY'))
          )),
        db.select({ returnConfirmedAt: itemRequests.returnConfirmedAt, endDate: itemRequests.endDate })
          .from(itemRequests)
          .where(and(
            eq(itemRequests.requesterId, uid),
            or(eq(itemRequests.status, 'COMPLETED'), eq(itemRequests.status, 'COMPLETED_EARLY')),
            isNotNull(itemRequests.endDate),
            isNotNull(itemRequests.returnConfirmedAt),
          )),
        db.selectDistinct({ senderId: messages.senderId }).from(messages).where(eq(messages.receiverId, uid)),
        db.selectDistinct({ receiverId: messages.receiverId }).from(messages).where(eq(messages.senderId, uid)),
        db.select({ count: sql<number>`count(*)` })
          .from(rentalReturns)
          .where(and(
            or(eq(rentalReturns.renterId, uid), eq(rentalReturns.ownerId, uid)),
            or(eq(rentalReturns.status, 'DAMAGED'), eq(rentalReturns.status, 'LOST'))
          )),
        Promise.resolve(computeActiveStatus(user.lastActiveAt ?? null)),
        computeResponseTime(uid),
        db.select({ avg: sql<number>`avg(${userReviews.rating})`, cnt: sql<number>`count(*)` })
          .from(userReviews)
          .where(eq(userReviews.reviewedUserId, uid)),
      ]);

      const completedShares = Number(completedSharesResult[0]?.count ?? 0);
      let onTimeReturnRate: number | null = null;
      if (completedBorrows.length > 0) {
        const onTime = completedBorrows.filter(r => r.returnConfirmedAt! <= r.endDate!).length;
        onTimeReturnRate = Math.round((onTime / completedBorrows.length) * 100);
      }
      const senderSet = new Set(uniqueSenders.map(s => s.senderId));
      const recipientSet = new Set(uniqueRecipients.map(r => r.receiverId));
      const repliedCount = [...senderSet].filter(id => recipientSet.has(id)).length;
      const replyRate = senderSet.size > 0 ? Math.round((repliedCount / senderSet.size) * 100) : null;
      const issuesCount = Number(issuesResult[0]?.count ?? 0);
      const trustScore = Math.min(100, user.reputationScore ?? 0);

      const reviewCount = Number(reviewStats[0]?.cnt ?? 0);
      const averageRating = reviewCount > 0 && reviewStats[0]?.avg != null
        ? Math.round(Number(reviewStats[0].avg) * 10) / 10
        : null;

      res.json({
        ...user,
        isVerified,
        emailVerified: user.emailVerified || !!user.googleId || user.authProvider === 'google',
        paymentVerified,
        idVerified,
        completedShares,
        onTimeReturnRate,
        replyRate,
        issuesCount,
        trustScore,
        activeStatus,
        responseTime,
        averageRating,
        reviewCount,
      });
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ error: "Failed to fetch user profile" });
    }
  });

  // Update user profile
  app.patch("/api/user-profile", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const { fullName, bio, location, phone, displayName, defaultPostalCode } = req.body;

    // Enforce 30-day cooldown on display name changes
    if (displayName !== undefined) {
      const [currentUser] = await db
        .select({ displayName: users.displayName, displayNameChangedAt: users.displayNameChangedAt })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (currentUser?.displayNameChangedAt) {
        const daysSinceChange = (Date.now() - new Date(currentUser.displayNameChangedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceChange < 30) {
          const nextAllowed = new Date(new Date(currentUser.displayNameChangedAt).getTime() + 30 * 24 * 60 * 60 * 1000);
          return res.status(429).json({
            error: "Display name can only be changed once every 30 days.",
            nextAllowedAt: nextAllowed.toISOString(),
          });
        }
      }
    }

    // Build update object with only provided fields
    const updateData: Partial<{ fullName: string; bio: string; location: string; phone: string; displayName: string; defaultPostalCode: string; displayNameChangedAt: Date }> = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (bio !== undefined) updateData.bio = bio;
    if (location !== undefined) updateData.location = location;
    if (phone !== undefined) updateData.phone = phone;
    if (displayName !== undefined) {
      updateData.displayName = displayName;
      updateData.displayNameChangedAt = new Date();
    }
    if (defaultPostalCode !== undefined) updateData.defaultPostalCode = defaultPostalCode;

    // If no fields to update, just return current profile
    if (Object.keys(updateData).length === 0) {
      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
          handle: users.handle,
          displayName: users.displayName,
          fullName: users.fullName,
          bio: users.bio,
          location: users.location,
          phone: users.phone,
          profilePhoto: users.profilePhoto,
          isVerified: users.isVerified,
          shareCoins: users.shareCoins,
          reputationScore: users.reputationScore,
          reputationLevel: users.reputationLevel,
          isPremium: users.isPremium,
          defaultPostalCode: users.defaultPostalCode,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);
      return res.json(user);
    }

    try {
      const [updatedUser] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, req.user.id))
        .returning({
          id: users.id,
          username: users.username,
          handle: users.handle,
          displayName: users.displayName,
          displayNameChangedAt: users.displayNameChangedAt,
          fullName: users.fullName,
          bio: users.bio,
          location: users.location,
          phone: users.phone,
          profilePhoto: users.profilePhoto,
          isVerified: users.isVerified,
          shareCoins: users.shareCoins,
          reputationScore: users.reputationScore,
          reputationLevel: users.reputationLevel,
          isPremium: users.isPremium,
          defaultPostalCode: users.defaultPostalCode,
          createdAt: users.createdAt,
        });

      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ error: "Failed to update user profile" });
    }
  });

  // Get verification nudge status
  app.get("/api/verification-nudge-status", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const [user] = await db
        .select({
          hasSeenNudge: users.hasSeenVerificationNudge,
          stripePaymentMethodId: users.stripePaymentMethodId,
        })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const [approvedId] = await db
        .select({ id: verifications.id })
        .from(verifications)
        .where(and(
          eq(verifications.userId, req.user.id),
          eq(verifications.status, "approved")
        ))
        .limit(1);

      const isVerified = !!approvedId && !!user.stripePaymentMethodId;

      res.json({
        hasSeenNudge: user.hasSeenNudge || false,
        isVerified,
      });
    } catch (error) {
      console.error("Error fetching verification nudge status:", error);
      res.status(500).json({ error: "Failed to fetch verification nudge status" });
    }
  });

  // Dismiss verification nudge
  app.post("/api/verification-nudge-dismiss", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      await db
        .update(users)
        .set({ hasSeenVerificationNudge: true })
        .where(eq(users.id, req.user.id));

      res.json({ success: true });
    } catch (error) {
      console.error("Error dismissing verification nudge:", error);
      res.status(500).json({ error: "Failed to dismiss verification nudge" });
    }
  });

  // Get user's payment method
  app.get("/api/payment-method", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const [user] = await db
        .select({
          stripeCustomerId: users.stripeCustomerId,
          stripePaymentMethodId: users.stripePaymentMethodId,
          last4: users.paymentMethodLast4,
          brand: users.paymentMethodBrand,
          expMonth: users.paymentMethodExpMonth,
          expYear: users.paymentMethodExpYear,
          addedAt: users.paymentMethodAddedAt,
        })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if payment method exists
      const hasPaymentMethod = !!user.stripePaymentMethodId;
      
      // Check if card is expired
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const isExpired = user.expYear && user.expMonth && 
        (user.expYear < currentYear || (user.expYear === currentYear && user.expMonth < currentMonth));

      res.json({
        hasPaymentMethod,
        status: !hasPaymentMethod ? 'missing' : isExpired ? 'expired' : 'verified',
        paymentMethod: hasPaymentMethod ? {
          last4: user.last4,
          brand: user.brand,
          expMonth: user.expMonth,
          expYear: user.expYear,
          addedAt: user.addedAt,
        } : null,
      });
    } catch (error) {
      console.error("Error fetching payment method:", error);
      res.status(500).json({ error: "Failed to fetch payment method" });
    }
  });

  // Create Stripe SetupIntent for adding a new payment method
  app.post("/api/payment-method/setup-intent", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const [user] = await db
        .select({
          id: users.id,
          stripeCustomerId: users.stripeCustomerId,
          username: users.username,
        })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      let customerId = user.stripeCustomerId;
      const stripeInstance = await getStripe();

      const ensureValidCustomer = async (): Promise<string> => {
        if (customerId) {
          try {
            await stripeInstance.customers.retrieve(customerId);
            return customerId!;
          } catch (err: any) {
            if (err?.statusCode === 404 || err?.code === 'resource_missing') {
              console.log(`Stripe customer ${customerId} not found, creating new one for user ${user.id}`);
            } else {
              throw err;
            }
          }
        }
        const customer = await stripeInstance.customers.create({
          metadata: {
            userId: user.id.toString(),
            username: user.username,
          },
        });
        await db
          .update(users)
          .set({ stripeCustomerId: customer.id })
          .where(eq(users.id, req.user.id));
        return customer.id;
      };

      customerId = await ensureValidCustomer();

      const setupIntent = await stripeInstance.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
        metadata: {
          userId: user.id.toString(),
        },
      });

      res.json({
        clientSecret: setupIntent.client_secret,
      });
    } catch (error) {
      console.error("Error creating setup intent:", error);
      res.status(500).json({ error: "Failed to create setup intent" });
    }
  });

  // Create Stripe Checkout Session for adding payment method (hosted page)
  app.post("/api/payment-method/create-checkout-session", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const [user] = await db
        .select({
          id: users.id,
          stripeCustomerId: users.stripeCustomerId,
          username: users.username,
        })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      let customerId = user.stripeCustomerId;

      const stripeInstance = await getStripe();

      const ensureValidCustomer = async (): Promise<string> => {
        if (customerId) {
          try {
            await stripeInstance.customers.retrieve(customerId);
            return customerId!;
          } catch (err: any) {
            if (err?.statusCode === 404 || err?.code === 'resource_missing') {
              console.log(`Stripe customer ${customerId} not found, creating new one for user ${user.id}`);
            } else {
              throw err;
            }
          }
        }
        const customer = await stripeInstance.customers.create({
          metadata: {
            userId: user.id.toString(),
            username: user.username,
          },
        });
        await db
          .update(users)
          .set({ stripeCustomerId: customer.id })
          .where(eq(users.id, req.user.id));
        return customer.id;
      };

      customerId = await ensureValidCustomer();

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const baseUrl = `${protocol}://${host}`;

      const session = await stripeInstance.checkout.sessions.create({
        mode: 'setup',
        customer: customerId,
        payment_method_types: ['card'],
        success_url: `${baseUrl}/payment-methods?setup_success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/payment-methods?setup_success=false`,
        metadata: {
          userId: user.id.toString(),
        },
      });

      res.json({
        url: session.url,
        sessionId: session.id,
      });
    } catch (error: any) {
      console.error("Error creating checkout session:", error);
      const errorMessage = error?.message || error?.raw?.message || "Failed to create checkout session";
      console.error("Stripe error details:", JSON.stringify(error, null, 2));
      res.status(500).json({ error: "Failed to create checkout session", details: errorMessage });
    }
  });

  // Complete payment method setup after Checkout Session
  app.post("/api/payment-method/complete-setup", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    try {
      // Retrieve the checkout session
      const stripeInstance = await getStripe();
      const session = await stripeInstance.checkout.sessions.retrieve(sessionId, {
        expand: ['setup_intent', 'setup_intent.payment_method'],
      });

      if (!session.setup_intent || typeof session.setup_intent === 'string') {
        return res.status(400).json({ error: "Invalid session" });
      }

      const setupIntent = session.setup_intent;
      const paymentMethod = setupIntent.payment_method;

      if (!paymentMethod || typeof paymentMethod === 'string') {
        return res.status(400).json({ error: "No payment method found" });
      }

      if (!paymentMethod.card) {
        return res.status(400).json({ error: "Invalid payment method type" });
      }

      // Get user's existing payment method
      const [user] = await db
        .select({
          existingPaymentMethodId: users.stripePaymentMethodId,
        })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      // Detach the previous payment method if one exists
      if (user?.existingPaymentMethodId && user.existingPaymentMethodId !== paymentMethod.id) {
        try {
          await stripeInstance.paymentMethods.detach(user.existingPaymentMethodId);
        } catch (detachError) {
          console.error("Error detaching previous payment method:", detachError);
        }
      }

      // Check if user has approved ID verification
      const [idVerification] = await db
        .select({ status: verifications.status })
        .from(verifications)
        .where(eq(verifications.userId, req.user.id))
        .orderBy(desc(verifications.createdAt))
        .limit(1);
      
      const hasApprovedId = idVerification?.status === 'approved';
      
      // Update user with payment method details and potentially verify
      await db
        .update(users)
        .set({
          stripePaymentMethodId: paymentMethod.id,
          paymentMethodLast4: paymentMethod.card.last4,
          paymentMethodBrand: paymentMethod.card.brand,
          paymentMethodExpMonth: paymentMethod.card.exp_month,
          paymentMethodExpYear: paymentMethod.card.exp_year,
          paymentMethodAddedAt: new Date(),
          // Set verified if both ID and payment method are now satisfied
          ...(hasApprovedId && { isVerified: true, verifiedAt: new Date() }),
        })
        .where(eq(users.id, req.user.id));

      res.json({
        success: true,
        paymentMethod: {
          last4: paymentMethod.card.last4,
          brand: paymentMethod.card.brand,
          expMonth: paymentMethod.card.exp_month,
          expYear: paymentMethod.card.exp_year,
        },
      });
    } catch (error) {
      console.error("Error completing setup:", error);
      res.status(500).json({ error: "Failed to complete setup" });
    }
  });

  // Save payment method after successful setup
  app.post("/api/payment-method/save", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const { paymentMethodId } = req.body;

    if (!paymentMethodId) {
      return res.status(400).json({ error: "Payment method ID is required" });
    }

    try {
      // Get user's Stripe customer ID and existing payment method
      const [user] = await db
        .select({
          stripeCustomerId: users.stripeCustomerId,
          existingPaymentMethodId: users.stripePaymentMethodId,
        })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!user?.stripeCustomerId) {
        return res.status(400).json({ error: "No Stripe customer found. Please try again." });
      }

      const stripeInstance = await getStripe();

      // Retrieve payment method details from Stripe
      const paymentMethod = await stripeInstance.paymentMethods.retrieve(paymentMethodId);

      if (!paymentMethod.card) {
        return res.status(400).json({ error: "Invalid payment method" });
      }

      // Verify the payment method belongs to this user's Stripe customer
      if (paymentMethod.customer !== user.stripeCustomerId) {
        // If not attached, attach it to the customer
        if (!paymentMethod.customer) {
          await stripeInstance.paymentMethods.attach(paymentMethodId, {
            customer: user.stripeCustomerId,
          });
        } else {
          return res.status(400).json({ error: "This payment method does not belong to your account" });
        }
      }

      // Detach the previous payment method if one exists
      if (user.existingPaymentMethodId && user.existingPaymentMethodId !== paymentMethodId) {
        try {
          await stripeInstance.paymentMethods.detach(user.existingPaymentMethodId);
        } catch (detachError) {
          console.error("Error detaching previous payment method:", detachError);
        }
      }

      // Check if user has approved ID verification
      const [idVerification] = await db
        .select({ status: verifications.status })
        .from(verifications)
        .where(eq(verifications.userId, req.user.id))
        .orderBy(desc(verifications.createdAt))
        .limit(1);
      
      const hasApprovedId = idVerification?.status === 'approved';
      
      // Update user with payment method details and potentially verify
      await db
        .update(users)
        .set({
          stripePaymentMethodId: paymentMethodId,
          paymentMethodLast4: paymentMethod.card.last4,
          paymentMethodBrand: paymentMethod.card.brand,
          paymentMethodExpMonth: paymentMethod.card.exp_month,
          paymentMethodExpYear: paymentMethod.card.exp_year,
          paymentMethodAddedAt: new Date(),
          // Set verified if both ID and payment method are now satisfied
          ...(hasApprovedId && { isVerified: true, verifiedAt: new Date() }),
        })
        .where(eq(users.id, req.user.id));

      res.json({
        success: true,
        paymentMethod: {
          last4: paymentMethod.card.last4,
          brand: paymentMethod.card.brand,
          expMonth: paymentMethod.card.exp_month,
          expYear: paymentMethod.card.exp_year,
        },
      });
    } catch (error) {
      console.error("Error saving payment method:", error);
      res.status(500).json({ error: "Failed to save payment method" });
    }
  });

  // Remove payment method
  app.delete("/api/payment-method", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const userId = req.user.id;

      // Check 1: Active borrow or rent (any in-flight transaction)
      const [activeBorrowRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(
          and(
            or(
              eq(itemRequests.requesterId, userId),
              eq(items.ownerId, userId)
            ),
            sql`${itemRequests.status} IN (
              'ACCEPTED','DEPOSIT_PENDING','DEPOSIT_CONFIRMED',
              'HANDOFF_CONFIRMED','IN_PROGRESS'
            )`
          )
        );

      if (Number(activeBorrowRow?.count) > 0) {
        return res.status(400).json({
          error: "You have an active borrow or rental. Complete or cancel it before removing your payment method.",
          code: "ACTIVE_BORROW",
        });
      }

      // Check 2: Pending return
      const [pendingReturnRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(
          and(
            or(
              eq(itemRequests.requesterId, userId),
              eq(items.ownerId, userId)
            ),
            sql`${itemRequests.status} IN ('RETURN_REQUESTED','RETURN_CONFIRMED')`
          )
        );

      if (Number(pendingReturnRow?.count) > 0) {
        return res.status(400).json({
          error: "You have a pending return in progress. Complete the return before removing your payment method.",
          code: "PENDING_RETURN",
        });
      }

      // Check 3: Damage claim (rental return marked as DAMAGED or LOST)
      const [damageRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(rentalReturns)
        .innerJoin(itemRequests, eq(itemRequests.id, rentalReturns.requestId))
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(
          and(
            or(
              eq(itemRequests.requesterId, userId),
              eq(items.ownerId, userId)
            ),
            sql`${rentalReturns.status} IN ('DAMAGED','LOST')`
          )
        );

      if (Number(damageRow?.count) > 0) {
        return res.status(400).json({
          error: "You have an outstanding damage or loss claim. Resolve it before removing your payment method.",
          code: "DAMAGE_CLAIM",
        });
      }

      // Check 4: Unpaid platform commissions
      const [unpaidRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(platformCommissions)
        .where(
          and(
            or(
              eq(platformCommissions.payerId, userId),
              eq(platformCommissions.receiverId, userId)
            ),
            sql`${platformCommissions.status} = 'PENDING'`
          )
        );

      if (Number(unpaidRow?.count) > 0) {
        return res.status(400).json({
          error: "You have an unpaid balance outstanding. Clear it before removing your payment method.",
          code: "UNPAID_BALANCE",
        });
      }

      const [user] = await db
        .select({ stripePaymentMethodId: users.stripePaymentMethodId })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      // Detach from Stripe if exists
      if (user?.stripePaymentMethodId) {
        try {
          const stripeInstance = await getStripe();
          await stripeInstance.paymentMethods.detach(user.stripePaymentMethodId);
        } catch (stripeError) {
          console.error("Error detaching payment method from Stripe:", stripeError);
        }
      }

      // Clear payment method from user record and quietly downgrade verification
      await db
        .update(users)
        .set({
          stripePaymentMethodId: null,
          paymentMethodLast4: null,
          paymentMethodBrand: null,
          paymentMethodExpMonth: null,
          paymentMethodExpYear: null,
          paymentMethodAddedAt: null,
          isVerified: false, // Payment method required for verification
        })
        .where(eq(users.id, req.user.id));

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing payment method:", error);
      res.status(500).json({ error: "Failed to remove payment method" });
    }
  });

  // Get current platform commission settings
  app.get("/api/platform/commission-config", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }
    
    res.json({
      current: {
        rentalCommissionRate: platformConfig.rentalCommissionRate,
        minimumCommission: platformConfig.minimumCommission,
        flatFeesEnabled: platformConfig.flatFees.enabled,
        commissionSplit: platformConfig.commissionSplit,
      },
      options: platformConfig.commissionStructures,
      messaging: platformConfig.messaging,
      description: "Platform commission configuration options"
    });
  });

  // Mark rental as returned and award ShareCoins
  app.post("/api/rentals/:requestId/return", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);
    const { status = "RETURNED", notes = "" } = req.body;

    try {
      // Get rental request details
      const [rental] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(
          and(
            eq(itemRequests.id, requestId),
            eq(itemRequests.requestType, "RENT"),
            eq(itemRequests.status, "ACCEPTED")
          )
        )
        .limit(1);

      if (!rental) {
        return res.status(404).json({ error: "Rental not found or not in progress" });
      }

      // Only owner or renter can mark as returned
      const isOwner = rental.items.ownerId === req.user.id;
      const isRenter = rental.item_requests.requesterId === req.user.id;

      if (!isOwner && !isRenter) {
        return res.status(403).json({ error: "Not authorized to mark this rental as returned" });
      }

      // Check if already returned
      const existingReturn = await db
        .select()
        .from(rentalReturns)
        .where(eq(rentalReturns.requestId, requestId))
        .limit(1);

      if (existingReturn.length > 0) {
        return res.status(400).json({ error: "Rental already marked as returned" });
      }

      // Platform commission is FREE for first 3 transactions; standard rates apply after that.
      // Use $0 commission for the free period so no charges are recorded or deducted.
      const rentalPrice = parseFloat(rental.items.dollarsPrice || "0");
      const [{ count: returnTxCount }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(itemRequests)
        .where(and(
          eq(itemRequests.requesterId, rental.item_requests.requesterId),
          inArray(itemRequests.status, ["ACTIVE", "RETURNED", "COMPLETED"]),
        ));
      // Check renter's subscription tier — Pro pays reduced 2% platform commission
      const [returnRenterSub] = await db
        .select({ subscriptionTier: users.subscriptionTier })
        .from(users)
        .where(eq(users.id, rental.item_requests.requesterId))
        .limit(1);
      const returnRenterTier = (returnRenterSub as any)?.subscriptionTier || 'free';
      const returnCommissionRate = returnRenterTier === 'pro' ? 0.04 : 0.05;

      const freeCommissionPeriod = Number(returnTxCount) < 3;
      const rawCommissionDetails = calculateCommission(rentalPrice, 'RENTAL', false);
      const proAdjustedCommission = returnRenterTier === 'pro'
        ? { ...rawCommissionDetails, commissionAmount: parseFloat((rentalPrice * 0.04).toFixed(2)), platformAmount: parseFloat((rentalPrice * 0.04).toFixed(2)) }
        : rawCommissionDetails;
      const commissionDetails = freeCommissionPeriod
        ? { ...rawCommissionDetails, commissionAmount: 0, platformAmount: 0, shareCoinsFromReward: rawCommissionDetails.shareCoinsFromReward }
        : proAdjustedCommission;
      if (freeCommissionPeriod) {
        console.log(`🎉 Platform commission waived at return — first 3 transactions free`);
      } else if (returnRenterTier === 'pro') {
        console.log(`💎 Pro rate applied at return — ${(returnCommissionRate * 100).toFixed(0)}% commission`);
      }

      // Award ShareCoins to both users for successful rental completion
      const shareCoinsReward = platformConfig.shareCoinsRewards.successfulRental;
      const renterId = rental.item_requests.requesterId;
      const ownerId = rental.items.ownerId;

      let renterShareCoins = 0;
      let ownerShareCoins = 0;

      if (shareCoinsReward > 0) {
        // Award to renter with first-time bonus
        const renterResult = await awardShareCoinsWithFirstTimeBonus(
          renterId,
          'RENT',
          rental.items.name,
          shareCoinsReward
        );
        renterShareCoins = renterResult.totalAwarded;

        // Award to owner (lender) with first-time bonus
        if (ownerId) {
          const ownerResult = await awardShareCoinsWithFirstTimeBonus(
            ownerId,
            'LEND',
            rental.items.name,
            shareCoinsReward
          );
          ownerShareCoins = ownerResult.totalAwarded;

          console.log(`✅ ${platformConfig.messaging.shareCoinsReward}`);
          console.log(`Rental completion: Renter=${renterResult.totalAwarded} (first-time: ${renterResult.isFirstTime}), Owner/Lender=${ownerResult.totalAwarded} (first-time: ${ownerResult.isFirstTime})`);
        }
      }

      // Record rental return with actual ShareCoins awarded (after calculation)
      await db.insert(rentalReturns).values({
        requestId,
        itemId: rental.items.id,
        renterId,
        ownerId,
        commissionCharged: commissionDetails.commissionAmount.toString(),
        shareCoinsAwarded: renterShareCoins + ownerShareCoins,
        status,
        notes,
      });

      // Award additional ShareCoins from user reward fund
      if (commissionDetails.shareCoinsFromReward > 0) {
        const rewardPerUser = Math.floor(commissionDetails.shareCoinsFromReward / 2);
        
        if (rewardPerUser > 0) {
          // Award community reward ShareCoins to both users
          await db.insert(shareCoinsTransactions).values({
            userId: renterId,
            amount: rewardPerUser.toString(),
            description: `Community reward: ${rewardPerUser} ShareCoins from user reward fund`,
            transactionType: "EARNED",
          });

          await db
            .update(users)
            .set({
              shareCoins: sql`share_coins + ${rewardPerUser}`,
            })
            .where(sql`${users.id} = ${renterId}`);

          await db.insert(shareCoinsTransactions).values({
            userId: ownerId,
            amount: rewardPerUser.toString(),
            description: `Community reward: ${rewardPerUser} ShareCoins from user reward fund`,
            transactionType: "EARNED",
          });

          await db
            .update(users)
            .set({
              shareCoins: sql`share_coins + ${rewardPerUser}`,
            })
            .where(sql`${users.id} = ${ownerId}`);

          console.log(`Awarded ${rewardPerUser} bonus ShareCoins to each user from community reward fund`);
        }
      }

      // Update request status
      await db
        .update(itemRequests)
        .set({ status: "COMPLETED" })
        .where(eq(itemRequests.id, requestId));

      // Award trust points for rental completion (no disputes means it completed smoothly)
      try {
        await awardRentalCompletionPoints(
          renterId,
          ownerId!,
          requestId,
          rental.items.id,
          false // hadDispute - completed rentals are dispute-free
        );
        await db.insert(notifications).values([
          { userId: renterId, type: "trust_score_changed", title: "Trust Score +20", message: "Rental completed +20", itemId: rental.items.id, requestId, isRead: false },
          ...(ownerId ? [{ userId: ownerId, type: "trust_score_changed", title: "Trust Score +20", message: "Rental completed +20", itemId: rental.items.id, requestId, isRead: false }] : []),
        ]);
      } catch (trustError) {
        console.error("Error awarding rental trust points:", trustError);
      }

      // Check and award referral bonus for both users (first transaction completion)
      await checkAndAwardReferralBonus(renterId, requestId, 'RENT');
      if (ownerId) await checkAndAwardReferralBonus(ownerId, requestId, 'RENT');

      res.json({
        success: true,
        message: "Rental marked as returned successfully",
        renterShareCoins,
        ownerShareCoins,
        communityBonusAwarded: Math.floor(commissionDetails.shareCoinsFromReward / 2),
      });

    } catch (error) {
      console.error("Error processing rental return:", error);
      res.status(500).json({ error: "Failed to process rental return" });
    }
  });

  // Mark borrow as returned and award ShareCoins
  app.post("/api/borrows/:requestId/return", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);

    try {
      // Get borrow request details
      const [borrow] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(
          and(
            eq(itemRequests.id, requestId),
            eq(itemRequests.requestType, "BORROW"),
            eq(itemRequests.status, "ACCEPTED")
          )
        )
        .limit(1);

      if (!borrow) {
        return res.status(404).json({ error: "Borrow not found or not in progress" });
      }

      // Only owner or borrower can mark as returned
      const isOwner = borrow.items.ownerId === req.user.id;
      const isBorrower = borrow.item_requests.requesterId === req.user.id;

      if (!isOwner && !isBorrower) {
        return res.status(403).json({ error: "Not authorized to mark this borrow as returned" });
      }

      const borrowerId = borrow.item_requests.requesterId;
      const ownerId = borrow.items.ownerId;

      // Award ShareCoins to borrower with first-time bonus
      const borrowerResult = await awardShareCoinsWithFirstTimeBonus(
        borrowerId,
        'BORROW',
        borrow.items.name,
        1
      );

      // Award ShareCoins to owner (lender) with first-time bonus
      let ownerResult = { totalAwarded: 0, isFirstTime: false };
      if (ownerId) {
        ownerResult = await awardShareCoinsWithFirstTimeBonus(
          ownerId,
          'LEND',
          borrow.items.name,
          1
        );
      }

      console.log(`✅ Borrow completion: Borrower=${borrowerResult.totalAwarded} (first-time: ${borrowerResult.isFirstTime}), Lender=${ownerResult.totalAwarded} (first-time: ${ownerResult.isFirstTime})`);

      // Update request status to COMPLETED
      await db
        .update(itemRequests)
        .set({ status: "COMPLETED" })
        .where(eq(itemRequests.id, requestId));

      // Check and award referral bonus for both users (first transaction completion)
      await checkAndAwardReferralBonus(borrowerId, requestId, 'BORROW');
      if (ownerId) await checkAndAwardReferralBonus(ownerId, requestId, 'LEND');

      res.json({
        success: true,
        message: "Borrow marked as returned successfully",
        borrowerShareCoins: borrowerResult.totalAwarded,
        lenderShareCoins: ownerResult.totalAwarded,
      });

    } catch (error) {
      console.error("Error processing borrow return:", error);
      res.status(500).json({ error: "Failed to process borrow return" });
    }
  });

  // ── Admin: Shared auth guard ──
  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (!(req.user as any).isAdmin) return res.status(403).json({ message: "Admin access required" });
    next();
  }

  // ── Admin: Dashboard stats ──
  app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
    try {
      const [[{ totalUsers }], [{ totalItems }], [{ totalTransactions }], [{ openDisputes }], [{ bannedUsers }]] = await Promise.all([
        db.select({ totalUsers: sql<number>`count(*)::int` }).from(users),
        db.select({ totalItems: sql<number>`count(*)::int` }).from(items),
        db.select({ totalTransactions: sql<number>`count(*)::int` }).from(itemRequests),
        db.select({ openDisputes: sql<number>`count(*)::int` }).from(itemRequests).where(eq(itemRequests.status, "DISPUTED")),
        db.select({ bannedUsers: sql<number>`count(*)::int` }).from(users).where(eq(users.accountStatus, "banned")),
      ]);
      res.json({ totalUsers, totalItems, totalTransactions, openDisputes, bannedUsers });
    } catch (err) {
      console.error("Admin stats error:", err);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // ── Admin: List users (search by email / username / handle) ──
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const search = (req.query.search as string || "").trim();
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = 30;
      const offset = (page - 1) * limit;

      const where = search
        ? or(
            ilike(users.username, `%${search}%`),
            ilike(users.email, `%${search}%`),
            ilike(users.handle, `%${search}%`),
            ilike(users.displayName, `%${search}%`),
          )
        : undefined;

      const [rows, [{ total }]] = await Promise.all([
        db.select({
          id: users.id,
          username: users.username,
          handle: users.handle,
          displayName: users.displayName,
          email: users.email,
          accountStatus: users.accountStatus,
          isAdmin: users.isAdmin,
          isVerified: users.isVerified,
          isPremium: users.isPremium,
          shareCoins: users.shareCoins,
          reputationScore: users.reputationScore,
          bannedAt: users.bannedAt,
          banReason: users.banReason,
          createdAt: users.createdAt,
          lastActiveAt: users.lastActiveAt,
        }).from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
        db.select({ total: sql<number>`count(*)::int` }).from(users).where(where),
      ]);

      res.json({ users: rows, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
      console.error("Admin users error:", err);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // ── Admin: Ban user ──
  app.post("/api/admin/users/:id/ban", requireAdmin, csrfProtection, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const { reason } = req.body as { reason?: string };
      await db.update(users).set({
        accountStatus: "banned",
        bannedAt: new Date(),
        banReason: reason || "Banned by admin",
      }).where(eq(users.id, userId));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to ban user" });
    }
  });

  // ── Admin: Unban user ──
  app.post("/api/admin/users/:id/unban", requireAdmin, csrfProtection, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      await db.update(users).set({
        accountStatus: "active",
        bannedAt: null,
        banReason: null,
      }).where(eq(users.id, userId));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to unban user" });
    }
  });

  // ── Admin: List items (search by name) ──
  app.get("/api/admin/items", requireAdmin, async (req, res) => {
    try {
      const search = (req.query.search as string || "").trim();
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = 30;
      const offset = (page - 1) * limit;

      const where = search ? ilike(items.name, `%${search}%`) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        db.select({
          id: items.id,
          name: items.name,
          category: items.category,
          conditionRating: items.conditionRating,
          isAvailable: items.isAvailable,
          isLendable: items.isLendable,
          isRentable: items.isRentable,
          isGift: items.isGift,
          securityDeposit: items.securityDeposit,
          photos: items.photos,
          createdAt: items.createdAt,
          ownerId: items.ownerId,
          ownerUsername: users.username,
          ownerHandle: users.handle,
          ownerDisplayName: users.displayName,
        }).from(items)
          .leftJoin(users, eq(users.id, items.ownerId))
          .where(where)
          .orderBy(desc(items.createdAt))
          .limit(limit).offset(offset),
        db.select({ total: sql<number>`count(*)::int` }).from(items).where(where),
      ]);

      res.json({ items: rows, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
      console.error("Admin items error:", err);
      res.status(500).json({ message: "Failed to fetch items" });
    }
  });

  // ── Admin: Remove item (soft delete) ──
  app.post("/api/admin/items/:id/remove", requireAdmin, csrfProtection, async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      await db.update(items).set({ isAvailable: false }).where(eq(items.id, itemId));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to remove item" });
    }
  });

  // ── Admin: List transactions (search by ID, user email/username, item name) ──
  app.get("/api/admin/transactions", requireAdmin, async (req, res) => {
    try {
      const search = (req.query.search as string || "").trim();
      const status = (req.query.status as string || "").trim();
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = 30;
      const offset = (page - 1) * limit;

      const requester = alias(users, "requester");
      const owner = alias(users, "owner");

      const conditions: any[] = [];
      if (status) conditions.push(eq(itemRequests.status, status));
      if (search) {
        const searchNum = parseInt(search);
        const searchConditions: any[] = [ilike(items.name, `%${search}%`), ilike(requester.username, `%${search}%`), ilike(requester.email, `%${search}%`)];
        if (!isNaN(searchNum)) searchConditions.push(eq(itemRequests.id, searchNum));
        conditions.push(or(...searchConditions));
      }
      const where = conditions.length ? and(...conditions) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        db.select({
          id: itemRequests.id,
          status: itemRequests.status,
          requestType: itemRequests.requestType,
          depositStatus: itemRequests.depositStatus,
          trustDepositAmount: itemRequests.trustDepositAmount,
          depositPaymentIntentId: itemRequests.depositPaymentIntentId,
          startDate: itemRequests.startDate,
          endDate: itemRequests.endDate,
          createdAt: itemRequests.createdAt,
          itemId: itemRequests.itemId,
          itemName: items.name,
          requesterId: itemRequests.requesterId,
          requesterUsername: requester.username,
          requesterEmail: requester.email,
          ownerId: items.ownerId,
          ownerUsername: owner.username,
        }).from(itemRequests)
          .innerJoin(items, eq(items.id, itemRequests.itemId))
          .leftJoin(requester, eq(requester.id, itemRequests.requesterId))
          .leftJoin(owner, eq(owner.id, items.ownerId))
          .where(where)
          .orderBy(desc(itemRequests.createdAt))
          .limit(limit).offset(offset),
        db.select({ total: sql<number>`count(*)::int` })
          .from(itemRequests)
          .innerJoin(items, eq(items.id, itemRequests.itemId))
          .leftJoin(requester, eq(requester.id, itemRequests.requesterId))
          .where(where),
      ]);

      res.json({ transactions: rows, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
      console.error("Admin transactions error:", err);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  // ── Admin: Transaction manual override ──
  app.post("/api/admin/transactions/:id/override", requireAdmin, csrfProtection, async (req, res) => {
    try {
      const requestId = parseInt(req.params.id);
      const { action } = req.body as { action: "complete" | "release_deposit" | "cancel" };

      const [request] = await db.select().from(itemRequests).innerJoin(items, eq(items.id, itemRequests.itemId)).where(eq(itemRequests.id, requestId)).limit(1);
      if (!request) return res.status(404).json({ message: "Transaction not found" });

      if (action === "complete") {
        await db.update(itemRequests).set({ status: "COMPLETED" }).where(eq(itemRequests.id, requestId));
        await db.update(items).set({ isAvailable: true }).where(eq(items.id, request.item_requests.itemId));
        notifyAvailabilitySubscribers(request.item_requests.itemId, request.items.name).catch(() => {});
      } else if (action === "release_deposit") {
        const pi = request.item_requests.depositPaymentIntentId;
        if (pi) { try { await stripe.paymentIntents.cancel(pi); } catch (_) {} }
        await db.update(itemRequests).set({ depositStatus: "released", depositReleasedAt: new Date() }).where(eq(itemRequests.id, requestId));
      } else if (action === "cancel") {
        const pi = request.item_requests.depositPaymentIntentId;
        if (pi) { try { await stripe.paymentIntents.cancel(pi); } catch (_) {} }
        await db.update(itemRequests).set({ status: "DECLINED", depositStatus: request.item_requests.depositStatus === "held" ? "released" : request.item_requests.depositStatus ?? undefined }).where(eq(itemRequests.id, requestId));
        await db.update(items).set({ isAvailable: true }).where(eq(items.id, request.item_requests.itemId));
        notifyAvailabilitySubscribers(request.item_requests.itemId, request.items.name).catch(() => {});
      } else {
        return res.status(400).json({ message: "Unknown action" });
      }

      res.json({ success: true, action });
    } catch (err) {
      console.error("Admin override error:", err);
      res.status(500).json({ message: "Failed to override transaction" });
    }
  });

  // ── Admin: List all return disputes ──
  app.get("/api/admin/disputes", requireAdmin, async (_req, res) => {
    try {
      const disputes = await db
        .select({
          id: itemRequests.id,
          status: itemRequests.status,
          requestType: itemRequests.requestType,
          returnDisputeReason: itemRequests.returnDisputeReason,
          returnDisputePhotoUrl: itemRequests.returnDisputePhotoUrl,
          returnConditionNotes: itemRequests.returnConditionNotes,
          returnConditionRating: itemRequests.returnConditionRating,
          returnConditionOk: itemRequests.returnConditionOk,
          trustDepositAmount: itemRequests.trustDepositAmount,
          depositPaymentIntentId: itemRequests.depositPaymentIntentId,
          depositStatus: itemRequests.depositStatus,
          returnRequestedAt: itemRequests.returnRequestedAt,
          returnConfirmedAt: itemRequests.returnConfirmedAt,
          createdAt: itemRequests.createdAt,
          itemId: itemRequests.itemId,
          requesterId: itemRequests.requesterId,
          itemName: items.name,
          itemImage: items.photos,
          ownerId: items.ownerId,
        })
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.status, "DISPUTED"))
        .orderBy(desc(itemRequests.returnConfirmedAt));

      // Fetch owner + borrower display names
      const userIds = [...new Set(disputes.flatMap(d => [d.ownerId, d.requesterId].filter(Boolean) as number[]))];
      const userRows = userIds.length
        ? await db.select({ id: users.id, displayName: users.displayName, username: users.username }).from(users).where(inArray(users.id, userIds))
        : [];
      const userMap = Object.fromEntries(userRows.map(u => [u.id, u.displayName || u.username || `User ${u.id}`]));

      const result = disputes.map(d => ({
        ...d,
        ownerName: d.ownerId ? userMap[d.ownerId] ?? `User ${d.ownerId}` : "Unknown",
        borrowerName: userMap[d.requesterId] ?? `User ${d.requesterId}`,
        itemImage: Array.isArray(d.itemImage) ? d.itemImage[0] : null,
      }));

      res.json(result);
    } catch (err) {
      console.error("Error fetching disputes:", err);
      res.status(500).json({ error: "Failed to fetch disputes" });
    }
  });

  // ── Admin: Resolve a return dispute ──
  app.post("/api/admin/disputes/:requestId/resolve", requireAdmin, csrfProtection, async (req, res) => {
    const requestId = parseInt(req.params.requestId);
    const { decision, adminNote } = req.body as { decision: "owner" | "borrower"; adminNote?: string };
    if (!decision || !["owner", "borrower"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'owner' or 'borrower'" });
    }
    try {
      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);
      if (!request) return res.status(404).json({ error: "Request not found" });
      if (request.item_requests.status !== "DISPUTED") {
        return res.status(400).json({ error: "Request is not in DISPUTED status" });
      }

      const ownerId = request.items.ownerId!;
      const borrowerId = request.item_requests.requesterId;
      const paymentIntentId = request.item_requests.depositPaymentIntentId;

      if (decision === "borrower") {
        // Release deposit back to borrower
        if (paymentIntentId) {
          try { await stripe.paymentIntents.cancel(paymentIntentId); } catch (_) {}
        }
        await db.update(itemRequests).set({
          status: "COMPLETED",
          depositStatus: "released",
          depositReleasedAt: new Date(),
        }).where(eq(itemRequests.id, requestId));
        await db.update(items).set({ isAvailable: true }).where(eq(items.id, request.items.id));
        notifyAvailabilitySubscribers(request.items.id, request.items.name).catch(() => {});
        // Notify both parties
        await db.insert(notifications).values([
          { userId: borrowerId, type: "dispute_resolved", title: "Dispute Resolved", message: `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" return reviewed. Deposit released to you.`, itemId: request.items.id, requestId },
          { userId: ownerId, type: "dispute_resolved", title: "Dispute Resolved", message: `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" return reviewed. Deposit released to borrower.`, itemId: request.items.id, requestId },
        ]);
      } else {
        // Capture deposit in favour of owner (damage confirmed)
        if (paymentIntentId) {
          try { await stripe.paymentIntents.capture(paymentIntentId); } catch (_) {}
        }
        await db.update(itemRequests).set({
          status: "COMPLETED",
          depositStatus: "captured",
        }).where(eq(itemRequests.id, requestId));
        await db.update(items).set({ isAvailable: true }).where(eq(items.id, request.items.id));
        notifyAvailabilitySubscribers(request.items.id, request.items.name).catch(() => {});

        // Credit the captured deposit into the owner's balance
        const depositAmt = parseFloat(request.item_requests.trustDepositAmount || "0");
        if (depositAmt > 0) {
          await db.update(users)
            .set({ rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${depositAmt.toFixed(2)}` })
            .where(eq(users.id, ownerId));

          // Log a payout record so it appears in their balance history
          await db.insert(rentalPayouts).values({
            userId: ownerId,
            requestId,
            amount: depositAmt.toFixed(2),
            rentalAmount: depositAmt.toFixed(2),
            platformFee: "0.00",
            processingFee: "0.00",
            netAmount: depositAmt.toFixed(2),
            status: "released",
            disputeStatus: "captured",
            stripePaymentIntentId: paymentIntentId || null,
            releasedAt: new Date(),
          });
        }

        await db.insert(notifications).values([
          { userId: ownerId, type: "dispute_resolved", title: "Dispute Resolved In Your Favour", message: `Damage confirmed for "${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}". Deposit added to your balance.`, itemId: request.items.id, requestId },
          { userId: borrowerId, type: "dispute_resolved", title: "Dispute Resolved", message: `Damage confirmed for "${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}". Your deposit has been charged.`, itemId: request.items.id, requestId },
        ]);
      }

      res.json({ success: true, decision });
    } catch (err) {
      console.error("Error resolving dispute:", err);
      res.status(500).json({ error: "Failed to resolve dispute" });
    }
  });

  // Get farming detection stats (admin endpoint)
  app.get("/api/admin/farming-stats", requireAdmin, async (req, res) => {
    
    try {
      // Get recent farming detections
      const detections = await db
        .select()
        .from(farmingDetections)
        .orderBy(desc(farmingDetections.createdAt))
        .limit(50);
      
      // Get active cooldowns
      const activeCooldowns = await db
        .select()
        .from(swapCooldowns)
        .where(gte(swapCooldowns.cooldownUntil, new Date()))
        .orderBy(desc(swapCooldowns.cooldownUntil));
      
      // Statistics
      const riskLevelCounts = detections.reduce((acc, detection) => {
        acc[detection.riskLevel] = (acc[detection.riskLevel] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      res.json({
        recentDetections: detections,
        activeCooldowns: activeCooldowns,
        statistics: {
          totalDetections: detections.length,
          riskLevelBreakdown: riskLevelCounts,
          activeCooldownCount: activeCooldowns.length
        }
      });
    } catch (error) {
      console.error("Error fetching farming stats:", error);
      res.status(500).json({ error: "Failed to fetch farming statistics" });
    }
  });

  // Confirm item delivery (recipient confirms they received the item)
  app.post("/api/requests/:requestId/confirm-delivery", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);

    // Get the request
    const [request] = await db
      .select()
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(eq(itemRequests.id, requestId))
      .limit(1);

    if (!request) {
      return res.status(404).send("Request not found");
    }

    // Only the recipient (requester) can confirm delivery
    if (request.item_requests.requesterId !== req.user.id) {
      return res.status(403).send("Only the recipient can confirm delivery");
    }

    // Only accepted requests can have delivery confirmed
    if (request.item_requests.status !== "ACCEPTED") {
      return res.status(400).send("Request must be accepted to confirm delivery");
    }

    // For in-person, delivery confirmation is automatic at handoff (no-op if already confirmed)
    if (request.item_requests.deliveryMethod === "in_person") {
      if (request.item_requests.deliveryConfirmed) {
        return res.json({ 
          success: true, 
          message: "Delivery already confirmed for in-person handoff.",
          request: request.item_requests 
        });
      }
    }

    // Prevent duplicate confirmations
    if (request.item_requests.deliveryConfirmed) {
      return res.status(400).send("Delivery has already been confirmed");
    }

    // Update delivery confirmation
    const [updated] = await db
      .update(itemRequests)
      .set({ 
        deliveryConfirmed: true,
        deliveryConfirmedAt: new Date()
      })
      .where(eq(itemRequests.id, requestId))
      .returning();

    // Create notification for item owner
    await db.insert(notifications).values({
      userId: request.items.ownerId!,
      type: "delivery_confirmed",
      title: "Delivery Confirmed",
      message: `"${request.items.name.length > 20 ? request.items.name.slice(0, 20) + "…" : request.items.name}" delivered successfully.`,
      itemId: request.items.id,
      requestId: requestId,
      isRead: false,
    });

    const depositMessage = "Handoff confirmed. Trust-deposit is active.";

    res.json({ 
      success: true, 
      message: depositMessage,
      request: updated 
    });
  });

  // Create delivery arrangement
  app.post("/api/requests/:requestId/delivery", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);
    const { deliveryType, deliveryAddress, deliveryDate, securityDeposit } =
      req.body;

    const deliveryFee = "0.00";

    const [arrangement] = await db
      .insert(deliveryArrangements)
      .values({
        requestId,
        deliveryType,
        deliveryFee,
        deliveryAddress,
        deliveryDate: new Date(deliveryDate),
        securityDeposit,
        depositPaid: false,
        status: "PENDING",
      })
      .returning();

    res.status(201).json(arrangement);
  });

  // Get user reputation
  app.get("/api/users/:userId/reputation", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const userId = parseInt(req.params.userId);
    const [user] = await db
      .select({
        reputationScore: users.reputationScore,
        reputationLevel: users.reputationLevel,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).send("User not found");
    }

    // Get recent reputation activities
    const activities = await db
      .select()
      .from(reputationActivities)
      .where(eq(reputationActivities.userId, userId))
      .orderBy(desc(reputationActivities.createdAt))
      .limit(10);

    // Get user reviews
    const reviews = await db
      .select({
        id: userReviews.id,
        rating: userReviews.rating,
        comment: userReviews.comment,
        createdAt: userReviews.createdAt,
        reviewer: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          profilePhoto: users.profilePhoto,
        },
      })
      .from(userReviews)
      .innerJoin(users, eq(users.id, userReviews.reviewerId))
      .where(eq(userReviews.reviewedUserId, userId))
      .orderBy(desc(userReviews.createdAt))
      .limit(5);

    res.json({
      ...user,
      recentActivities: activities,
      reviews,
    });
  });

  // Submit a review for a user
  app.post("/api/users/:userId/reviews", requireEmailVerified, async (req: any, res) => {
    const reviewedUserId = parseInt(req.params.userId);
    const { rating, comment, transactionId, feedbackTags } = req.body;

    // Verify the transaction exists and involves both users
    const [transaction] = await db
      .select()
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(
        and(
          eq(itemRequests.id, transactionId),
          or(
            and(
              eq(itemRequests.requesterId, req.user.id),
              eq(items.ownerId, reviewedUserId),
            ),
            and(
              eq(itemRequests.requesterId, reviewedUserId),
              eq(items.ownerId, req.user.id),
            ),
          ),
        ),
      )
      .limit(1);

    if (!transaction) {
      return res.status(400).send("Invalid transaction");
    }

    // Check if user has already reviewed this transaction
    const [existingReview] = await db
      .select()
      .from(userReviews)
      .where(
        and(
          eq(userReviews.reviewerId, req.user.id),
          eq(userReviews.transactionId, transactionId),
        ),
      )
      .limit(1);

    if (existingReview) {
      return res.status(400).send("You have already reviewed this transaction");
    }

    // Validate feedback tags — all recognized tag types
    const validTags = [
      "reliable", "on_time", "as_described", "great_communication", "well_cared",
      "late_return", "issue_reported", "no_show", "item_not_described",
      "generous_giver", "picked_up_promptly", "item_as_described", "fair_exchange",
    ];
    const cleanedTags = feedbackTags?.filter((tag: string) => validTags.includes(tag)) || [];

    // Create the review
    const [review] = await db
      .insert(userReviews)
      .values({
        reviewerId: req.user.id,
        reviewedUserId,
        rating,
        comment,
        feedbackTags: cleanedTags.length > 0 ? cleanedTags : null,
        transactionId,
      })
      .returning();

    // --- Compute ALL points upfront so the notification and level-up check are accurate ---

    // Base points from star rating: 3★=0, 4★=+3, 5★=+5
    const reviewPoints = rating === 5 ? 5 : rating === 4 ? 3 : 0;

    // Positive feedback tag points (+1 each for reliable / on_time / as_described)
    const POSITIVE_TAG_POINTS: Record<string, number> = { reliable: 1, on_time: 1, as_described: 1 };
    const positiveTagsAwarded = cleanedTags.filter(t => t in POSITIVE_TAG_POINTS);
    const feedbackTagPoints = positiveTagsAwarded.reduce((sum, t) => sum + POSITIVE_TAG_POINTS[t], 0);

    // Negative tag deduction: -1 per negative tag selected
    const NEGATIVE_TAG_KEYS = ["late_return", "issue_reported", "no_show", "item_not_described"];
    const negativeTagsSelected = cleanedTags.filter(t => NEGATIVE_TAG_KEYS.includes(t));
    const negativeTagDeduction = negativeTagsSelected.length * -1;

    const totalPoints = reviewPoints + feedbackTagPoints + negativeTagDeduction;

    // Read current score/level BEFORE any update
    const [reviewedUserBefore] = await db
      .select({ reputationScore: users.reputationScore, reputationLevel: users.reputationLevel })
      .from(users)
      .where(eq(users.id, reviewedUserId))
      .limit(1);

    const oldScore = reviewedUserBefore?.reputationScore ?? 0;

    // Anti-farming: trust points from reviews are awarded at most once per reviewer→reviewed
    // pair per 90-day rolling window. The review itself is still saved and visible.
    const positiveTotal = reviewPoints + feedbackTagPoints;
    let pairCapHit = false;
    if (positiveTotal > 0) {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const [priorPairReview] = await db
        .select({ id: userReviews.id })
        .from(userReviews)
        .where(
          and(
            eq(userReviews.reviewerId, req.user.id),
            eq(userReviews.reviewedUserId, reviewedUserId),
            gte(userReviews.createdAt, ninetyDaysAgo),
            ne(userReviews.id, review.id),
          ),
        )
        .limit(1);
      if (priorPairReview) {
        console.log(`⚠️ Review trust points skipped — reviewer ${req.user.id} already awarded points to ${reviewedUserId} within 90 days (pair cap).`);
        pairCapHit = true;
      }
    }

    if (totalPoints !== 0 && !pairCapHit) {
      if (reviewPoints > 0) {
        await db.insert(reputationActivities).values({
          userId: reviewedUserId,
          activityType: "RECEIVE_REVIEW",
          points: reviewPoints,
          itemId: transaction.items.id,
          description: `Received a ${rating}-star review`,
        });
      }
      if (feedbackTagPoints > 0) {
        await db.insert(reputationActivities).values({
          userId: reviewedUserId,
          activityType: "positive_feedback" as any,
          points: feedbackTagPoints,
          description: `Positive feedback tags: ${positiveTagsAwarded.join(", ")}`,
        });
      }
      if (negativeTagDeduction < 0) {
        await db.insert(reputationActivities).values({
          userId: reviewedUserId,
          activityType: "low_review_two_star" as any,
          points: negativeTagDeduction,
          description: `Negative feedback tags: ${negativeTagsSelected.join(", ")}`,
        });
      }

      await db
        .update(users)
        .set({
          reputationScore: sql`LEAST(500, GREATEST(0, reputation_score + ${totalPoints}))`,
          reputationLevel: sql`CASE
            WHEN LEAST(500, GREATEST(0, reputation_score + ${totalPoints})) >= 500 THEN 'ShareSwap Champion'
            WHEN LEAST(500, GREATEST(0, reputation_score + ${totalPoints})) >= 300 THEN 'Community Pillar'
            WHEN LEAST(500, GREATEST(0, reputation_score + ${totalPoints})) >= 150 THEN 'Trusted Member'
            WHEN LEAST(500, GREATEST(0, reputation_score + ${totalPoints})) >= 50  THEN 'Neighbour'
            ELSE 'Newcomer'
          END`,
        })
        .where(eq(users.id, reviewedUserId));

      const LEVEL_THRESHOLDS = [
        { name: 'Newcomer',           minScore: 0,   coinsReward: 0 },
        { name: 'Neighbour',          minScore: 50,  coinsReward: 5 },
        { name: 'Trusted Member',     minScore: 150, coinsReward: 5 },
        { name: 'Community Pillar',   minScore: 300, coinsReward: 5 },
        { name: 'ShareSwap Champion', minScore: 500, coinsReward: 5 },
      ];
      const getLevelForScore = (s: number) =>
        [...LEVEL_THRESHOLDS].reverse().find(l => s >= l.minScore) ?? LEVEL_THRESHOLDS[0];
      const oldLevelDef = getLevelForScore(oldScore);
      const newLevelDef = getLevelForScore(Math.max(0, oldScore + totalPoints));
      if (newLevelDef.name !== oldLevelDef.name) {
        if (newLevelDef.coinsReward > 0) {
          await db.update(users)
            .set({ shareCoins: sql`share_coins + ${newLevelDef.coinsReward}` })
            .where(eq(users.id, reviewedUserId));
          await db.insert(shareCoinsTransactions).values({
            userId: reviewedUserId,
            amount: newLevelDef.coinsReward.toString(),
            description: `Level Up Bonus — ${newLevelDef.name}`,
            transactionType: "EARNED",
          });
          await db.insert(notifications).values({
            userId: reviewedUserId,
            type: "sharecoin_earned",
            title: `+${newLevelDef.coinsReward} ShareCoins earned`,
            message: `You earned ${newLevelDef.coinsReward} ShareCoins for reaching ${newLevelDef.name}!`,
            link: "/achievements",
            isRead: false,
          });
        }
        await db.insert(notifications).values({
          userId: reviewedUserId,
          type: "level_up",
          title: `Level up — ${newLevelDef.name}! 🎉`,
          message: `You've reached ${newLevelDef.name}. Keep sharing to unlock more perks!`,
          link: "/achievements",
          isRead: false,
        });
        console.log(`🎉 Level up: user ${reviewedUserId} reached ${newLevelDef.name} (score ${oldScore} → ${Math.max(0, oldScore + totalPoints)})`);
      }
    }

    // Build single combined notification: review + trust score impact
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    const breakdownParts: string[] = [];
    if (reviewPoints > 0) breakdownParts.push(`${rating}★ review +${reviewPoints}`);
    positiveTagsAwarded.forEach(t => breakdownParts.push(`${t.replace(/_/g, ' ')} +1`));
    negativeTagsSelected.forEach(t => breakdownParts.push(`${t.replace(/_/g, ' ')} −1`));

    const effectivePoints = pairCapHit ? 0 : totalPoints;
    const trustTitle = effectivePoints > 0
      ? `New ${rating}-star review (+${effectivePoints} trust)`
      : effectivePoints < 0
        ? `New ${rating}-star review (${effectivePoints} trust)`
        : `New ${rating}-star review`;

    const reviewerName = req.user.displayName || req.user.username;
    const reviewLine = comment
      ? `${reviewerName} ${stars}: "${comment.slice(0, 60)}${comment.length > 60 ? '…' : ''}"`
      : `${reviewerName} left you a ${rating}-star review ${stars}`;
    const breakdownLine = !pairCapHit && breakdownParts.length > 0 ? `\n${breakdownParts.join(', ')}` : '';

    const [reviewNotif] = await db.insert(notifications).values({
      userId: reviewedUserId,
      type: "new_review_received",
      title: trustTitle,
      message: `${reviewLine}${breakdownLine}`,
      isRead: false,
    }).returning();
    const reviewedUserWs = connectedClients.get(reviewedUserId);
    if (reviewedUserWs?.readyState === WebSocket.OPEN) {
      reviewedUserWs.send(JSON.stringify({ type: "new_notification", notification: reviewNotif }));
    }

    // --- Low-review trust penalty (1 or 2 stars + negative tags required) ---
    const selectedNegativeTags = cleanedTags.filter((t: string) => ["late_return", "issue_reported"].includes(t));
    if ((rating === 1 || rating === 2) && selectedNegativeTags.length > 0) {
      try {
        const penaltyResult = await applyLowReviewPenalty(
          reviewedUserId,
          review.id,
          rating as 1 | 2,
          selectedNegativeTags,
        );
        if (penaltyResult.wasGracePass) {
          console.log(`⚠️ Grace pass issued to user ${reviewedUserId} for ${rating}-star review with tags: ${selectedNegativeTags.join(", ")}`);
        } else if (penaltyResult.applied) {
          const deduction = rating === 1 ? 10 : 5;
          console.log(`🚨 Low-review penalty applied to user ${reviewedUserId}: ${rating}-star, tags: ${selectedNegativeTags.join(", ")}, deduction: -${deduction}`);
        }
      } catch (penaltyErr) {
        console.error("Error applying low-review trust penalty:", penaltyErr);
      }
    }

    console.log(`✅ Review processed: ${reviewPoints} stars + ${feedbackTagPoints} pos tags + ${negativeTagDeduction} neg tags = ${totalPoints} total for user ${reviewedUserId}`);

    res.status(201).json(review);
  });

  // Get public user profile by username
  app.get("/api/users/username/:username", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const username = req.params.username;
    // Look up by username (email) first, then fall back to handle
    let [user] = await db
      .select({
        id: users.id,
        username: users.username,
        handle: users.handle,
        displayName: users.displayName,
        isVerified: users.isVerified,
        reputationScore: users.reputationScore,
        reputationLevel: users.reputationLevel,
        isPremium: users.isPremium,
        profilePhoto: users.profilePhoto,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    // Fall back to handle lookup (for clean URLs like /profile/T3H3R5)
    if (!user) {
      [user] = await db
        .select({
          id: users.id,
          username: users.username,
          handle: users.handle,
          displayName: users.displayName,
          isVerified: users.isVerified,
          reputationScore: users.reputationScore,
          reputationLevel: users.reputationLevel,
          isPremium: users.isPremium,
          profilePhoto: users.profilePhoto,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.handle, username))
        .limit(1);
    }

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Add lastActiveAt to username lookup
    let userWithActive: typeof user & { lastActiveAt?: Date | null } = user as any;
    const [activeRow] = await db
      .select({ lastActiveAt: users.lastActiveAt })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    userWithActive = { ...user, lastActiveAt: activeRow?.lastActiveAt ?? null };

    // Get review statistics
    const reviews = await db
      .select({
        rating: userReviews.rating,
      })
      .from(userReviews)
      .where(eq(userReviews.reviewedUserId, user.id));

    const averageRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length
      : 0;

    const reviewCount = reviews.length;

    const [activeStatus, responseTime, completedSharesResult] = await Promise.all([
      computeActiveStatusFromDb(user.id, userWithActive.lastActiveAt ?? null),
      computeResponseTime(user.id),
      db.select({ count: sql<number>`count(*)` })
        .from(itemRequests)
        .innerJoin(items, eq(itemRequests.itemId, items.id))
        .where(and(
          or(eq(itemRequests.requesterId, user.id), sql`${items.ownerId} = ${user.id}`),
          or(eq(itemRequests.status, 'COMPLETED'), eq(itemRequests.status, 'COMPLETED_EARLY'))
        )),
    ]);

    const completedShares = Number(completedSharesResult[0]?.count ?? 0);

    res.json({
      ...userWithActive,
      averageRating: Math.round(averageRating * 10) / 10,
      reviewCount,
      completedShares,
      activeStatus,
      responseTime,
      trustScore: userWithActive.reputationScore ?? 0,
    });
  });

  // Get user's shared items by username
  app.get("/api/users/username/:username/items", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const username = req.params.username;
    
    // Find the user by username or handle
    let [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    if (!user) {
      [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.handle, username))
        .limit(1);
    }

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get user's items
    const userItems = await db.query.items.findMany({
      where: eq(items.ownerId, user.id),
      orderBy: desc(items.createdAt),
      with: {
        owner: {
          columns: {
            id: true,
            username: true,
            isVerified: true,
            reputationLevel: true,
          }
        }
      }
    });

    res.json(userItems);
  });

  // Get user's reviews by username
  app.get("/api/users/username/:username/reviews", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const username = req.params.username;
    
    // Find the user by username or handle
    let [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    if (!user) {
      [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.handle, username))
        .limit(1);
    }

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get user reviews with reviewer info
    const reviews = await db
      .select({
        id: userReviews.id,
        rating: userReviews.rating,
        comment: userReviews.comment,
        createdAt: userReviews.createdAt,
        reviewer: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          profilePhoto: users.profilePhoto,
          handle: users.handle,
          isVerified: users.isVerified,
          reputationLevel: users.reputationLevel,
        },
      })
      .from(userReviews)
      .innerJoin(users, eq(users.id, userReviews.reviewerId))
      .where(eq(userReviews.reviewedUserId, user.id))
      .orderBy(desc(userReviews.createdAt));

    res.json(reviews);
  });


  // Get user earned achievements/badges by username
  app.get("/api/users/username/:username/achievements", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const username = req.params.username;
    let [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (!targetUser) {
      [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.handle, username)).limit(1);
    }
    if (!targetUser) return res.status(404).json({ error: "User not found" });
    const earned = await db
      .select({
        id: achievements.id,
        name: achievements.name,
        description: achievements.description,
        badgeIcon: achievements.badgeIcon,
        badgeColor: achievements.badgeColor,
        category: achievements.category,
        earnedAt: userAchievements.earnedAt,
      })
      .from(userAchievements)
      .innerJoin(achievements, eq(userAchievements.achievementId, achievements.id))
      .where(and(eq(userAchievements.userId, targetUser.id), eq(userAchievements.isCompleted, true)))
      .orderBy(asc(userAchievements.earnedAt));
    res.json(earned);
  });

  app.get("/api/delivery-arrangements", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const arrangements = await db
      .select({
        id: deliveryArrangements.id,
        requestId: deliveryArrangements.requestId,
        deliveryType: deliveryArrangements.deliveryType,
        deliveryFee: deliveryArrangements.deliveryFee,
        deliveryAddress: deliveryArrangements.deliveryAddress,
        deliveryDate: deliveryArrangements.deliveryDate,
        returnDate: deliveryArrangements.returnDate,
        securityDeposit: deliveryArrangements.securityDeposit,
        depositPaid: deliveryArrangements.depositPaid,
        status: deliveryArrangements.status,
        qrCodeData: deliveryArrangements.qrCodeData,
        specialInstructions: deliveryArrangements.specialInstructions,
        riskAccepted: deliveryArrangements.riskAccepted,
        createdAt: deliveryArrangements.createdAt,
        itemId: items.id,
        itemName: items.name,
        itemPhotos: items.photos,
      })
      .from(deliveryArrangements)
      .innerJoin(
        itemRequests,
        eq(itemRequests.id, deliveryArrangements.requestId),
      )
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(
        or(
          eq(items.ownerId, req.user.id),
          eq(itemRequests.requesterId, req.user.id),
        ),
      )
      .orderBy(desc(deliveryArrangements.deliveryDate));

    // Transform the data to match the expected frontend interface
    const transformedArrangements = arrangements.map(arr => ({
      id: arr.id,
      requestId: arr.requestId,
      deliveryType: arr.deliveryType,
      deliveryFee: arr.deliveryFee,
      deliveryAddress: arr.deliveryAddress,
      deliveryDate: arr.deliveryDate,
      returnDate: arr.returnDate,
      securityDeposit: arr.securityDeposit,
      depositPaid: arr.depositPaid,
      status: arr.status,
      qrCodeData: arr.qrCodeData,
      specialInstructions: arr.specialInstructions,
      riskAccepted: arr.riskAccepted,
      createdAt: arr.createdAt,
      request: {
        id: arr.requestId,
        item: {
          id: arr.itemId,
          name: arr.itemName,
          photos: arr.itemPhotos,
        }
      }
    }));

    res.json(transformedArrangements);
  });

  // Games API routes
  app.get("/api/games", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const games = await db
        .select()
        .from(sponsoredGames)
        .where(eq(sponsoredGames.isActive, true))
        .orderBy(desc(sponsoredGames.createdAt));

      res.json(games);
    } catch (error) {
      console.error("Error fetching games:", error);
      res.status(500).json({ error: "Failed to fetch games" });
    }
  });

  app.get("/api/game-sessions", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const sessions = await db
        .select({
          id: gameSessions.id,
          gameId: gameSessions.gameId,
          startedAt: gameSessions.startedAt,
          completedAt: gameSessions.completedAt,
          score: gameSessions.score,
          rewardAmount: gameSessions.rewardAmount,
          status: gameSessions.status,
          gameName: sponsoredGames.name,
          gameDescription: sponsoredGames.description,
          gameImageUrl: sponsoredGames.imageUrl,
          gameSponsorName: sponsoredGames.sponsorName,
        })
        .from(gameSessions)
        .innerJoin(sponsoredGames, eq(sponsoredGames.id, gameSessions.gameId))
        .where(eq(gameSessions.userId, req.user.id))
        .orderBy(desc(gameSessions.startedAt));

      // Transform data to match frontend interface
      const transformedSessions = sessions.map(session => ({
        id: session.id,
        gameId: session.gameId,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        score: session.score,
        rewardAmount: session.rewardAmount,
        status: session.status,
        game: {
          id: session.gameId,
          name: session.gameName,
          description: session.gameDescription,
          imageUrl: session.gameImageUrl,
          sponsorName: session.gameSponsorName,
        }
      }));

      res.json(transformedSessions);
    } catch (error) {
      console.error("Error fetching game sessions:", error);
      res.status(500).json({ error: "Failed to fetch game sessions" });
    }
  });

  app.post("/api/game-sessions", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { gameId } = req.body;

      if (!gameId) {
        return res.status(400).json({ error: "Game ID is required" });
      }

      // Verify game exists and is active
      const [game] = await db
        .select()
        .from(sponsoredGames)
        .where(and(eq(sponsoredGames.id, gameId), eq(sponsoredGames.isActive, true)))
        .limit(1);

      if (!game) {
        return res.status(404).json({ error: "Game not found or inactive" });
      }

      const [session] = await db
        .insert(gameSessions)
        .values({
          userId: req.user.id,
          gameId,
          status: 'started',
        })
        .returning();

      res.status(201).json(session);
    } catch (error) {
      console.error("Error creating game session:", error);
      res.status(500).json({ error: "Failed to create game session" });
    }
  });

  app.patch("/api/game-sessions/:sessionId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const sessionId = parseInt(req.params.sessionId);
      const { status, score, completedAt } = req.body;

      // Verify session belongs to user
      const [existingSession] = await db
        .select()
        .from(gameSessions)
        .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, req.user.id)))
        .limit(1);

      if (!existingSession) {
        return res.status(404).json({ error: "Game session not found" });
      }

      // Get game details for reward calculation
      const [game] = await db
        .select()
        .from(sponsoredGames)
        .where(eq(sponsoredGames.id, existingSession.gameId))
        .limit(1);

      let rewardAmount = "0.00";
      
      if (status === 'completed' && game) {
        rewardAmount = game.rewardAmount;
        
        // Award ShareCoins to user
        await db
          .update(users)
          .set({
            shareCoins: sql`${users.shareCoins} + ${rewardAmount}`
          })
          .where(eq(users.id, req.user.id));

        // Record transaction
        await db
          .insert(shareCoinsTransactions)
          .values({
            userId: req.user.id,
            amount: rewardAmount,
            description: `Game reward: ${game.name}`,
            transactionType: 'game_reward',
          });
      }

      const [updatedSession] = await db
        .update(gameSessions)
        .set({
          status,
          score,
          completedAt: completedAt ? new Date(completedAt) : null,
          rewardAmount: status === 'completed' ? rewardAmount : null,
        })
        .where(eq(gameSessions.id, sessionId))
        .returning();

      res.json(updatedSession);
    } catch (error) {
      console.error("Error updating game session:", error);
      res.status(500).json({ error: "Failed to update game session" });
    }
  });

  // New features routes handled by simplified routes

  const httpServer = createServer(app);

  // Security: Helper function to parse and validate session from WebSocket request
  async function validateWebSocketSession(req: any): Promise<number | null> {
    return new Promise((resolve) => {
      // Parse cookies manually from the request
      const cookieHeader = req.headers.cookie;
      if (!cookieHeader) {
        console.log("No cookie header found in WebSocket request");
        return resolve(null);
      }

      // Extract session ID from cookie
      const cookies = cookieHeader.split(';').reduce((acc: any, cookie: string) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;
        return acc;
      }, {});

      const sessionId = cookies['shareswap.sid'];
      if (!sessionId) {
        console.log("No session cookie found");
        return resolve(null);
      }

      // Decode session ID (remove 's:' prefix and signature)
      const decodedSessionId = decodeURIComponent(sessionId).split('.')[0].substring(2);
      
      // Validate session in the store
      store.get(decodedSessionId, (err, session) => {
        if (err) {
          console.error("Error validating WebSocket session:", err);
          return resolve(null);
        }
        
        if (!session || !session.passport || !session.passport.user) {
          console.log("Invalid or expired session");
          return resolve(null);
        }
        
        const userId = session.passport.user;
        console.log("WebSocket session validated for user:", userId);
        resolve(userId);
      });
    });
  }

  // Simplified WebSocket server configuration
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws/chat",
    verifyClient: (info, callback) => {
      // Skip verification for Vite HMR
      if (info.req.headers["sec-websocket-protocol"] === "vite-hmr") {
        return callback(true);
      }
      
      // Allow connection - we'll authenticate during the connection handler
      callback(true);
    },
  });

  // Catch WebSocket server-level errors so they do not crash the process
  wss.on("error", (err: Error) => {
    console.error("[WSS] WebSocket server error (non-fatal):", err.message);
  });

  wss.on("connection", async (ws: WebSocket, req: any) => {
    console.log("New WebSocket connection established");
    
    // Security: Validate session immediately on connection
    const userId = await validateWebSocketSession(req);
    
    if (!userId) {
      console.log("WebSocket connection rejected: Invalid or missing session");
      ws.send(JSON.stringify({
        type: "auth_error",
        message: "Authentication failed - please log in"
      }));
      ws.close(1008, "Unauthorized");
      return;
    }
    
    console.log(`✅ WebSocket authenticated for user ${userId}`);
    connectedClients.set(userId, ws);
    
    // Send authentication success
    ws.send(JSON.stringify({
      type: "auth_success",
      message: "Authenticated successfully",
      userId
    }));

    ws.on("message", async (message: string) => {
      try {
        const data = JSON.parse(message.toString());
        console.log("Received message from user:", userId, "data:", data);

        // No need for authenticate message type anymore - authentication happens on connection
        if (data.type === "authenticate") {
          ws.send(JSON.stringify({
            type: "auth_success",
            message: "Already authenticated",
            userId
          }));
          return;
        }

        // new_message is now handled exclusively via HTTP POST /api/messages
        // (which saves to DB and pushes the WS notification to the receiver).
        // Receiving a new_message frame here would be a duplicate — ignore it.
        if (data.type === "new_message") {
          // no-op: persistence and real-time delivery are handled by the HTTP route
        }
      } catch (error) {
        console.error("Error processing WebSocket message:", error);
      }
    });

    ws.on("close", () => {
      console.log("WebSocket connection closed for user:", userId);
      if (userId) connectedClients.delete(userId);
    });

    ws.on("error", (error) => {
      console.error("WebSocket error for user:", userId, error);
      if (userId) connectedClients.delete(userId);
    });
  });

  // Account Deactivation endpoint
  app.post("/api/account/change-password", csrfProtection, async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    const userId = (req.user as any).id;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters" });
    }
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.password) {
      return res.status(400).json({ message: "Password login is not enabled for this account" });
    }
    const valid = await comparePasswords(currentPassword, user.password);
    if (!valid) return res.status(400).json({ message: "Current password is incorrect" });
    const hashed = await hashPassword(newPassword);
    await db.update(users).set({ password: hashed }).where(eq(users.id, userId));
    res.json({ message: "Password updated successfully" });
  });

  // POST /api/account/change-email
  // Body: { newEmail, currentPassword }
  // Only available to local (email/password) accounts. Requires current password.
  app.post("/api/account/change-email", csrfProtection, async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    const userId = (req.user as any).id;
    const { newEmail, currentPassword } = req.body;

    if (!newEmail || typeof newEmail !== "string") {
      return res.status(400).json({ message: "New email is required" });
    }
    if (!currentPassword || typeof currentPassword !== "string") {
      return res.status(400).json({ message: "Current password is required" });
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail.trim())) {
      return res.status(400).json({ message: "Invalid email address" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return res.status(404).json({ message: "User not found" });

    // Google/OAuth users have no local password — they cannot use this endpoint
    if (user.authProvider && user.authProvider !== "local") {
      return res.status(403).json({ message: "Email change is not available for accounts using social login" });
    }

    if (!user.password) {
      return res.status(400).json({ message: "Password login is not enabled for this account" });
    }

    const valid = await comparePasswords(currentPassword, user.password);
    if (!valid) return res.status(401).json({ message: "Current password is incorrect" });

    const trimmedEmail = newEmail.trim().toLowerCase();

    // The canonical login address for local accounts is stored in `username`.
    // `email` may or may not be populated (older accounts may only have username).
    // Check against both to avoid a same-address change or a duplicate conflict.
    const currentEmail = (user.email || user.username || "").toLowerCase();

    // Reject if new email is the same as current
    if (trimmedEmail === currentEmail) {
      return res.status(400).json({ message: "New email is the same as your current email" });
    }

    // Case-insensitive uniqueness check across both username and email columns so
    // legacy accounts (email only in username) and modern accounts (email in both)
    // are both caught. Exclude the current user's own row.
    const [existingByUsername] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(ilike(users.username, trimmedEmail), ne(users.id, userId)))
      .limit(1);
    const [existingByEmail] = !existingByUsername
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(and(ilike(users.email, trimmedEmail), ne(users.id, userId)))
          .limit(1)
      : [existingByUsername];

    if (existingByUsername || existingByEmail) {
      return res.status(409).json({ message: "That email address is already in use" });
    }

    // Generate a fresh verification token for the new address
    const emailVerificationToken = randomBytes(32).toString("hex");
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store the new email as PENDING — it will only be applied after the user
    // clicks the confirmation link sent to the new address.
    // The current email / username remain unchanged until then.
    await db
      .update(users)
      .set({
        pendingEmail: trimmedEmail,
        emailVerificationToken,
        emailVerificationExpires,
      })
      .where(eq(users.id, userId));

    const oldEmail = user.email || user.username;

    // Send confirmation link to the NEW address (non-blocking)
    sendEmailChangeVerificationEmail(
      trimmedEmail,
      emailVerificationToken,
      user.displayName || undefined,
    ).catch((err) => {
      console.error("[Auth] Failed to send email-change verification email:", err);
    });

    // Send security alert to the OLD address (non-blocking)
    if (oldEmail) {
      sendEmailChangeAlertEmail(
        oldEmail,
        trimmedEmail,
        user.displayName || undefined,
      ).catch((err) => {
        console.error("[Auth] Failed to send email-change alert to old address:", err);
      });
    }

    console.log(`[Auth] Email change requested for user ${userId}: pending ${trimmedEmail}; verification sent`);
    res.json({ message: "Check your new inbox to confirm the change. Your current email stays active until you confirm." });
  });

  app.post("/api/account/deactivate", csrfProtection, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    const { confirmDeactivation } = req.body;
    if (!confirmDeactivation) {
      return res.status(400).json({ message: "Confirmation required" });
    }
    
    try {
      const userId = req.user.id;
      
      // Check for active transactions (pending requests) - user is requester or owns the item
      const activeRequests = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(itemRequests.itemId, items.id))
        .where(
          and(
            or(
              eq(itemRequests.requesterId, userId),
              eq(items.ownerId, userId)
            ),
            or(
              eq(itemRequests.status, 'PENDING'),
              eq(itemRequests.status, 'ACCEPTED')
            )
          )
        )
        .limit(1);
      
      if (activeRequests.length > 0) {
        return res.status(400).json({ 
          message: "Cannot deactivate account with active transactions. Please complete or cancel pending requests first."
        });
      }
      
      // Deactivate user account
      await db
        .update(users)
        .set({
          accountStatus: 'deactivated',
          deactivatedAt: new Date(),
        } as any)
        .where(eq(users.id, userId));
      
      // Archive all user items (mark as unavailable)
      await db
        .update(items)
        .set({ isAvailable: false })
        .where(eq(items.ownerId, userId));
      
      // Log the user out
      req.logout((err) => {
        if (err) {
          console.error("Logout error during deactivation:", err);
        }
        res.json({ 
          message: "Account deactivated successfully",
          status: "deactivated"
        });
      });
    } catch (error) {
      console.error("Account deactivation error:", error);
      res.status(500).json({ message: "Failed to deactivate account" });
    }
  });

  // Get account status
  app.get("/api/account/status", async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const [user] = await db
        .select({
          accountStatus: users.accountStatus,
          deactivatedAt: users.deactivatedAt,
          deletionRequestedAt: users.deletionRequestedAt,
        } as any)
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);
      
      res.json(user || { accountStatus: 'active' });
    } catch (error) {
      console.error("Account status error:", error);
      res.status(500).json({ message: "Failed to get account status" });
    }
  });

  // ===== SUBSCRIPTION ROUTES =====

  // Get current subscription status
  app.get("/api/subscription/status", async (req: any, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const [user] = await db
        .select({
          subscriptionTier: users.subscriptionTier,
          stripeSubscriptionId: users.stripeSubscriptionId,
          stripeSubscriptionStatus: users.stripeSubscriptionStatus,
          monthlyBorrowCount: users.monthlyBorrowCount,
          monthlyBorrowResetAt: users.monthlyBorrowResetAt,
          proDeliveryCount: users.proDeliveryCount,
          proDeliveryResetAt: users.proDeliveryResetAt,
        } as any)
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);
      res.json(user || { subscriptionTier: 'free' });
    } catch (error) {
      console.error("Subscription status error:", error);
      res.status(500).json({ message: "Failed to get subscription status" });
    }
  });

  // Create Stripe Checkout session for subscription
  app.post("/api/subscription/checkout", requireEmailVerified, async (req: any, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    const { tier, successUrl, cancelUrl } = req.body;
    if (!tier || !['member', 'pro'].includes(tier)) {
      return res.status(400).json({ message: "Invalid tier. Must be 'member' or 'pro'" });
    }
    try {
      const stripe = await getUncachableStripeClient();

      const [userRecord] = await db
        .select({ stripeCustomerId: users.stripeCustomerId, email: users.email, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      let customerId = userRecord?.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: userRecord?.email || undefined,
          name: userRecord?.fullName || undefined,
          metadata: { userId: String(req.user.id) },
        });
        customerId = customer.id;
        await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, req.user.id));
      }

      // Find active Stripe price by tier metadata
      const products = await stripe.products.search({
        query: `metadata['tier']:'${tier}' AND metadata['app']:'shareswap'`,
      });
      if (!products.data.length) {
        return res.status(404).json({ message: "Subscription plan not found. Please contact support." });
      }
      const prices = await stripe.prices.list({ product: products.data[0].id, active: true, limit: 1 });
      if (!prices.data.length) {
        return res.status(404).json({ message: "Price not found for this plan." });
      }
      const priceId = prices.data[0].id;

      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const baseUrl = `${proto}://${host}`;

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl || `${baseUrl}/profile?sub_success=true`,
        cancel_url: cancelUrl || `${baseUrl}/profile?sub_canceled=true`,
        metadata: { userId: String(req.user.id), tier },
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Checkout session error:", error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  // Stripe Customer Portal (manage/cancel subscription)
  app.post("/api/subscription/portal", requireEmailVerified, async (req: any, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const stripe = await getUncachableStripeClient();
      const [userRecord] = await db
        .select({ stripeCustomerId: users.stripeCustomerId })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!userRecord?.stripeCustomerId) {
        return res.status(400).json({ message: "No Stripe customer found. Please subscribe first." });
      }

      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const baseUrl = `${proto}://${host}`;

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: userRecord.stripeCustomerId,
        return_url: req.body.returnUrl || `${baseUrl}/profile`,
      });
      res.json({ url: portalSession.url });
    } catch (error) {
      console.error("Customer portal error:", error);
      res.status(500).json({ message: "Failed to open subscription management" });
    }
  });

  // Stripe subscription webhook
  app.post("/api/stripe/subscription-webhook", async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;

    let event: any;
    try {
      if (webhookSecret && sig) {
        const stripe = await getUncachableStripeClient();
        event = stripe.webhooks.constructEvent(req.body as Buffer, sig as string, webhookSecret);
      } else {
        const bodyStr = Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
        event = JSON.parse(bodyStr);
        console.warn("⚠️ Stripe subscription webhook: STRIPE_SUBSCRIPTION_WEBHOOK_SECRET not set — skipping signature verification");
      }
    } catch (err: any) {
      console.error("Subscription webhook signature error:", err.message);
      return res.status(400).json({ error: `Webhook error: ${err.message}` });
    }

    try {
      const stripe = await getUncachableStripeClient();

      if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;

        let tier = 'free';
        const priceId = subscription.items?.data?.[0]?.price?.id;
        if (priceId) {
          const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
          const product = price.product as any;
          tier = product?.metadata?.tier || 'free';
        }

        await db.update(users)
          .set({
            subscriptionTier: tier,
            stripeSubscriptionId: subscription.id,
            stripeSubscriptionStatus: subscription.status,
          } as any)
          .where(eq(users.stripeCustomerId, customerId));

        console.log(`✅ Subscription updated for customer ${customerId}: tier=${tier}, status=${subscription.status}`);
      }

      if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;

        await db.update(users)
          .set({
            subscriptionTier: 'free',
            stripeSubscriptionId: null,
            stripeSubscriptionStatus: 'canceled',
          } as any)
          .where(eq(users.stripeCustomerId, customerId));

        console.log(`🔴 Subscription canceled for customer ${customerId}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Subscription webhook processing error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // Migrate existing users to have handles (runs once at startup)
  (async () => {
    try {
      const usersWithoutHandles = await db
        .select({ id: users.id, username: users.username, fullName: users.fullName })
        .from(users)
        .where(isNull(users.handle));
      
      if (usersWithoutHandles.length > 0) {
        console.log(`[Migration] Generating handles for ${usersWithoutHandles.length} existing users...`);
        
        const ltrs = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const dgts = '23456789';
        const rL = () => ltrs[Math.floor(Math.random() * ltrs.length)];
        const rD = () => dgts[Math.floor(Math.random() * dgts.length)];

        for (const user of usersWithoutHandles) {
          const firstLetter = user.username.split('@')[0].replace(/[^a-zA-Z]/g, '').charAt(0)?.toUpperCase();
          const l1 = firstLetter && /^[A-Z]$/.test(firstLetter) ? firstLetter : rL();

          let handle = '';
          for (let attempts = 0; attempts < 100; attempts++) {
            const code = `${l1}${rD()}${rL()}${rD()}${rL()}${rD()}`;
            const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.handle, code)).limit(1);
            if (!existing) { handle = code; break; }
          }
          if (!handle) handle = `${l1}${rD()}${rL()}${rD()}${rL()}${rD()}`;

          await db
            .update(users)
            .set({ handle, referralCode: handle })
            .where(eq(users.id, user.id));
          
          console.log(`[Migration] User ${user.id} assigned userCode: ${handle}`);
        }
        
        console.log(`[Migration] Handle migration complete!`);
      }
    } catch (error) {
      console.error('[Migration] Error migrating user handles:', error);
    }
  })();

  setupAuth(app);
  
  // Add simplified routes for new features
  addSimplifiedRoutes(app);

  return httpServer;
}
