import type { Express } from "express";
import { createServer, type Server } from "http";
import * as uberDirect from "./uber-direct";
import { randomBytes } from "crypto";
import { setupAuth, hashPassword, comparePasswords } from "./auth";
import { db, pool } from "@db";
import {
  verifications,
  messages,
  items,
  users,
  shareCoinsTransactions,
  notifications,
} from "@db/schema";
import { eq, and, or, desc, sql, gte, lt, ne, isNull } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { log } from "./vite";
import multer from "multer";
import { uploadToStorage } from "./storage";
import path from "path";
import * as express from "express";
import { itemConditionVerifications } from "@db/schema";
import { sponsoredGames, gameSessions } from "@db/schema";
import { communityChallenges, challengeParticipants } from "@db/schema";
import { itemRequests, deliveryArrangements } from "@db/schema";
import { reputationActivities, userReviews } from "@db/schema";
import { locationAlerts, swapMatches, swapCooldowns, farmingDetections, rentalReturns, platformCommissions, wishlists, referrals, rentalPayouts } from "@db/schema";
import session from "express-session";
import { sessionSettings, store } from "./auth";
import type { InsertItem } from "@db/schema";
import connectPgSimple from "connect-pg-simple";
import { recommendationEngine } from "./recommendation-engine";
import { addSimplifiedRoutes } from "./simplified-routes";
import { platformConfig, calculateCommission } from "./platform-config";
import { AntiFarmingSystem } from "./anti-farming-system";
import { CooldownChecker } from "./cooldown-checker";
import { csrfProtection, setCsrfToken } from "./csrf";
import OpenAI from "openai";
import Stripe from "stripe";
import { 
  awardBorrowReturnPoints, 
  awardSwapCompletionPoints, 
  awardRentalCompletionPoints, 
  awardGiftingPoints, 
  awardFeedbackPoints, 
  TRUST_POINTS,
  applyLateReturnPenalty,
  applyCancellationPenalty,
  applyDepositClaimedPenalty
} from "./trust-score-service";
import { calculateAIValuation, getTierBand, type ItemValuationInput } from "./ai-valuation";
import { calculateReplacementValueAndTier } from "./replacement-value";

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
  
  // Award first-time bonus if applicable
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
  }
  
  // Award base completion reward
  await db.insert(shareCoinsTransactions).values({
    userId,
    amount: baseReward.toString(),
    description: `Successful ${actionType.charAt(0) + actionType.slice(1).toLowerCase()}: ${itemName}`,
    transactionType: "EARNED",
  });
  totalAwarded += baseReward;
  
  // Update user's ShareCoins balance
  await db
    .update(users)
    .set({
      shareCoins: sql`share_coins + ${totalAwarded}`,
    })
    .where(eq(users.id, userId));
  
  return { totalAwarded, isFirstTime };
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

    return { awarded: true, referrerId: referral.referrerId };
  } catch (error) {
    console.error("Error checking/awarding referral bonus:", error);
    return { awarded: false, reason: "Internal error" };
  }
}

// Initialize Stripe - will be loaded from connector
import { getUncachableStripeClient, getStripePublishableKey } from "./stripe.server";

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

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Serve uploaded files
  app.use("/uploads", express.static("uploads"));

  // Security: CSRF token endpoint - call this before making mutating requests
  // This endpoint generates and sets the CSRF token cookie
  app.get("/api/csrf-token", (req, res) => {
    // Generate and set CSRF token in cookie
    const token = setCsrfToken(req, res);
    console.log('[CSRF Token Endpoint] Token generated and set');
    
    res.json({ 
      message: "CSRF token set in cookie and ready for use",
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
          reputationScore: sql`COALESCE(reputation_score, 0) + ${VERIFICATION_TRUST_BOOST}`,
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

      res.json({ 
        success: true, 
        message: "Verification approved! You received a trust score boost and 5 ShareCoins.",
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
            reputationScore: sql`COALESCE(reputation_score, 0) + ${VERIFICATION_TRUST_BOOST}`,
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

        res.json({
          success: true,
          status: "approved",
          message: "Identity verified! You received a trust score boost and 5 ShareCoins.",
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

  // Profile photo upload endpoint with face validation
  app.post("/api/users/profile-photo", upload.single("profilePhoto"), async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: "Profile photo is required" });
      }

      // Upload photo to object storage
      const photoUrl = await uploadToStorage(req.file.buffer, req.file.originalname);
      console.log(`[Profile Photo] Uploaded: ${req.file.originalname} -> ${photoUrl}`);
      
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
          // Use buffer directly instead of reading from file
          const base64Image = req.file.buffer.toString("base64");
          const mimeType = req.file.mimetype || "image/jpeg";

          // Call GPT-4 Vision for face validation
          const OpenAI = (await import("openai")).default;
          const openai = new OpenAI({
            apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
            baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
          });

          const response = await openai.chat.completions.create({
            model: "gpt-4o",
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
            message: "You've used all 3 free SmartScans this month. Upgrade to Premium for unlimited scans or upload items manually.",
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
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are an expert at identifying and analyzing items from photos for a peer-to-peer sharing marketplace. Pay special attention to LUXURY BRANDS (Chanel, Louis Vuitton, Hermès, Gucci, Prada, Rolex, Cartier, Dior, Balenciaga, etc.) - these items often have market values in the thousands or tens of thousands of dollars.

Analyze these images and extract the following information in JSON format:

{
  "name": "Short, descriptive name of the item (max 50 chars)",
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

      res.json({
        success: true,
        analysis: {
          name: analysisData.name || "Unidentified Item",
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

  // Import listing from marketplace URL
  app.post("/api/import-listing", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { url } = req.body;
      
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: "Valid URL is required" });
      }

      // Validate and sanitize URL
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }

      // Security: Only allow HTTPS URLs from approved marketplaces
      if (parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ error: "Only HTTPS URLs are supported" });
      }

      // Allowlist of approved marketplace domains
      const allowedDomains = [
        'craigslist.org',
        'facebook.com',
        'fb.com',
        'marketplace.facebook.com',
      ];

      const hostname = parsedUrl.hostname.toLowerCase();
      const isAllowed = allowedDomains.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
      );

      if (!isAllowed) {
        return res.status(400).json({ 
          error: "URL must be from Facebook Marketplace, Craigslist, or Facebook Groups" 
        });
      }

      // Security: Prevent access to private/internal IP addresses
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (ipv4Regex.test(hostname)) {
        const parts = hostname.split('.').map(Number);
        // Block private IP ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.x.x.x
        if (
          parts[0] === 10 ||
          parts[0] === 127 ||
          (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
          (parts[0] === 192 && parts[1] === 168)
        ) {
          return res.status(400).json({ error: "Access to private IP addresses is not allowed" });
        }
      }

      // Initialize OpenAI client with Replit AI Integrations
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      // Fetch page content with security controls
      let pageContent = "";
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);

        // Validate response
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Check content type
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
          throw new Error('Unsupported content type');
        }

        // Limit response size to prevent memory issues
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > 1024 * 1024) { // 1MB limit
          throw new Error('Response too large');
        }

        const html = await response.text();
        
        // Limit total text length
        if (html.length > 1024 * 1024) { // 1MB limit
          throw new Error('Content too large');
        }

        // Simple text extraction - remove HTML tags
        pageContent = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 5000); // Limit content length for AI
      } catch (fetchError: any) {
        console.log("Could not fetch URL content:", fetchError.message);
        // Don't expose internal error details to client
        if (fetchError.name === 'AbortError') {
          return res.status(400).json({ error: "Request timeout - the page took too long to load" });
        }
        // Continue with URL-only analysis
      }

      // Validate we have some content to analyze
      if (!pageContent && !url) {
        return res.status(400).json({ 
          error: "Unable to extract content from URL. The page may require login or JavaScript to load." 
        });
      }

      const aiPrompt = `Extract item listing details from this marketplace URL and content. Return ONLY valid JSON with this exact structure:

{
  "name": "Item name (max 60 chars)",
  "description": "Detailed description of the item",
  "price": "Price as a number (no currency symbol), or null if not found",
  "conditionRating": "Integer 1-10 rating based on description, default 8 if unclear"
}

URL: ${url}
${pageContent ? `\nPage Content:\n${pageContent}` : '\nNote: Could not fetch page content directly (the page likely requires login or JavaScript). Analyze the URL structure to extract any item identifiers, and provide your best guess at what the listing might contain based on the URL patterns. If you truly cannot determine anything, use "Imported Item" as the name.'}

Return only the JSON object, no other text.`;

      let listingData: any = null;
      const models = ["gpt-5", "gpt-4o-mini"];
      
      for (const model of models) {
        try {
          const completion = await openai.chat.completions.create({
            model,
            messages: [
              {
                role: "system",
                content: "You are an expert at extracting structured data from marketplace listings (Facebook Marketplace, Craigslist, Facebook Groups, etc.). Extract item details and return valid JSON only. Always return a valid JSON object even if you have limited information.",
              },
              { role: "user", content: aiPrompt },
            ],
            max_completion_tokens: 500,
            response_format: { type: "json_object" },
          });

          const aiResponse = completion.choices[0]?.message?.content;
          if (aiResponse) {
            listingData = JSON.parse(aiResponse);
            if (listingData.name && listingData.name.trim().length > 0) {
              break;
            }
          }
        } catch (modelError: any) {
          console.log(`Import listing: ${model} failed, trying next model...`, modelError.message);
          continue;
        }
      }

      if (!listingData || !listingData.name || listingData.name.trim().length === 0) {
        return res.status(400).json({ 
          error: "Could not extract item details from this listing. The page may require login. Please enter details manually." 
        });
      }

      res.json({
        success: true,
        name: (listingData.name || "Imported Item").substring(0, 60),
        description: listingData.description || "Imported from marketplace listing",
        price: listingData.price ? parseFloat(listingData.price) : null,
        conditionRating: Math.min(10, Math.max(1, parseInt(listingData.conditionRating) || 8)),
      });
    } catch (error: any) {
      console.error("Error importing listing:", error);
      
      // Provide helpful error messages
      if (error.message?.includes('timeout') || error.name === 'AbortError') {
        return res.status(400).json({ 
          error: "The request timed out. Please try again." 
        });
      }
      
      if (error.message?.includes('API') || error.message?.includes('rate limit')) {
        return res.status(503).json({ 
          error: "AI service is temporarily unavailable. Please try again later." 
        });
      }

      res.status(500).json({ 
        error: "Failed to import listing. Please try again or enter details manually.",
      });
    }
  });


  // Import listing from marketplace screenshot using GPT-4 Vision
  app.post('/api/import-from-screenshot', upload.single('screenshot'), async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Screenshot image is required' });
      }

      const base64Image = req.file.buffer.toString('base64');
      const mimeType = req.file.mimetype || 'image/jpeg';

      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail: 'high',
                },
              },
              {
                type: 'text',
                text: `Analyze this marketplace listing screenshot and extract every visible detail. Return ONLY valid JSON with EXACTLY these fields:
{
  "name": "item name, max 60 chars",
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
  "suggestedTier": <1, 2, 3, or 4>
}

Condition mapping: new/like new/mint → "New / Like New" (rating 9-10); good/great/excellent → "Good" (7-8); fair/used/okay → "Fair" (5-6); worn/damaged/poor → "Well Loved" (1-4).
Tier: under $50 → tier 1; $50-$199 → tier 2; $200-$499 → tier 3; $500+ → tier 4.
Luxury: true if brand is designer/premium (e.g. Gucci, LV, Apple, Sony, Dyson, Rolex, etc).
Return only the JSON object, no other text.`
              }
            ]
          }
        ],
        max_tokens: 600,
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

      return res.json({
        name: (extracted.name || 'Imported Item').substring(0, 60),
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
- Clothing & Accessories (adult clothing, shoes, bags, jewelry, hats, scarves, etc.)
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
              title: "Swap Match Found!",
              message: `A new item matches what you're looking to trade for: ${item.name}`,
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

      // Check if item has any active requests or transactions
      const activeRequests = await db.query.itemRequests.findMany({
        where: and(
          eq(itemRequests.itemId, itemId),
          or(
            eq(itemRequests.status, "PENDING"),
            eq(itemRequests.status, "ACCEPTED")
          )
        ),
      });

      if (activeRequests.length > 0) {
        return res.status(400).json({ 
          error: "Cannot delete item with active requests. Please complete or decline pending requests first." 
        });
      }

      // Delete the item
      await db.delete(items).where(eq(items.id, itemId));

      res.json({ success: true, message: "Item permanently removed" });
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
      
      let whereConditions = [eq(items.isAvailable, true)];
      
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
        .where(eq(items.ownerId, req.user.id))
        .orderBy(desc(items.createdAt));

      res.json(userItems);
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
        .where(eq(wishlists.isActive, true))
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
        
        return {
          ...w,
          isExpired,
          // Verified users are highlighted in urgent wishlists
          highlightVerified: (w.urgency === 'urgent' || w.urgency === 'high') && w.isVerified,
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

  // Create wishlist item
  app.post("/api/wishlists", requireEmailVerified, async (req: any, res) => {
    try {
      const { itemName, description, category, needType, maxShareCoinPrice, maxDollarPrice, preferredLocation, neededDate, returnDate, urgency } = req.body;

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

      const { itemName, description, category, needType, maxShareCoinPrice, maxDollarPrice, preferredLocation, neededDate, returnDate, urgency } = req.body;

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
  app.delete("/api/wishlists/:id", requireEmailVerified, async (req: any, res) => {
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

      res.json(myWishlists);
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

      // Get the lister's username
      const [lister] = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, req.user.id));

      const listerName = lister?.username || "A neighbour";

      // Create notification for the wishlist owner
      await db.insert(notifications).values({
        userId: wishlistOwnerId,
        type: "wishlist_match",
        title: "Good news! A neighbour has an item that matches your wishlist",
        message: `${listerName} has listed "${item.name}" which matches what you're looking for.`,
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
        swapDesiredItem: items.swapDesiredItem,
        swapNotifyOnMatch: items.swapNotifyOnMatch,
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

    res.json(itemWithOwner);
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
    const { receiverId, content } = req.body;
    const [message] = await db
      .insert(messages)
      .values({
        senderId: req.user.id,
        receiverId,
        content,
      })
      .returning();

    res.status(201).json(message);
  });

  app.get("/api/messages/:userId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const chatMessages = await db
      .select()
      .from(messages)
      .where(
        or(
          and(
            eq(messages.senderId, req.user.id),
            eq(messages.receiverId, parseInt(req.params.userId)),
          ),
          and(
            eq(messages.senderId, parseInt(req.params.userId)),
            eq(messages.receiverId, req.user.id),
          ),
        ),
      )
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

    try {
      await db
        .update(messages)
        .set({ isRead: true })
        .where(
          and(
            eq(messages.senderId, partnerId),
            eq(messages.receiverId, req.user.id),
            eq(messages.isRead, false)
          )
        );

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
        displayName: users.displayName,
        profilePhoto: users.profilePhoto,
        isVerified: users.isVerified,
        reputationScore: users.reputationScore,
        lastActiveAt: users.lastActiveAt,
        bio: users.bio,
        location: users.location,
      })
      .from(users)
      .where(eq(users.id, targetId));

    if (!user) return res.status(404).json({ error: "User not found" });

    // Compute review stats
    const reviews = await db
      .select({ rating: userReviews.rating })
      .from(userReviews)
      .where(eq(userReviews.reviewedUserId, targetId));

    const reviewCount = reviews.length;
    const averageRating = reviewCount > 0
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviewCount) * 10) / 10
      : null;

    res.json({ ...user, reviewCount, averageRating });
  });

  // Unified inbox: combines item requests + direct messages sorted by most recent activity
  app.get("/api/inbox", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = req.user.id;

    // --- Gather all messages involving this user ---
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
      .where(or(eq(messages.senderId, userId), eq(messages.receiverId, userId)))
      .orderBy(desc(messages.createdAt));

    // Build per-partner message map
    const partnerMsgMap = new Map<number, { lastMsg: string; lastTime: Date; unread: number }>();
    for (const msg of allMessages) {
      const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      if (!partnerMsgMap.has(partnerId)) {
        const unread = allMessages.filter(
          m => m.senderId === partnerId && m.receiverId === userId && !m.isRead
        ).length;
        partnerMsgMap.set(partnerId, {
          lastMsg: msg.content,
          lastTime: msg.createdAt!,
          unread,
        });
      }
    }

    // --- Gather all item requests involving this user ---
    const allRequests = await db
      .select({
        id: itemRequests.id,
        requesterId: itemRequests.requesterId,
        ownerId: items.ownerId,
        itemName: items.name,
        itemId: itemRequests.itemId,
        requestType: itemRequests.requestType,
        status: itemRequests.status,
        negotiationStatus: itemRequests.negotiationStatus,
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

    // Build per-partner request map (most recent request per partner)
    const partnerReqMap = new Map<number, typeof allRequests[0]>();
    for (const req of allRequests) {
      const partnerId: number | null = req.requesterId === userId ? req.ownerId : req.requesterId;
      if (partnerId !== null && !partnerReqMap.has(partnerId)) {
        partnerReqMap.set(partnerId, req);
      }
    }

    // Collect all partner IDs
    const partnerIdsSet = new Set<number>([...Array.from(partnerMsgMap.keys()), ...Array.from(partnerReqMap.keys())]);
    const partnerIds = Array.from(partnerIdsSet);

    // Fetch partner user details
    const partnerDetails = await Promise.all(
      Array.from(partnerIds).map(async (pid) => {
        const [u] = await db
          .select({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            profilePhoto: users.profilePhoto,
            isVerified: users.isVerified,
            lastActiveAt: users.lastActiveAt,
          })
          .from(users)
          .where(eq(users.id, pid));
        return u;
      })
    );
    const partnerMap = new Map(partnerDetails.filter(Boolean).map(u => [u.id, u]));

    // Build unified inbox entries
    const inboxItems = Array.from(partnerIds).map((pid) => {
      const partner = partnerMap.get(pid);
      const msgData = partnerMsgMap.get(pid);
      const reqData = partnerReqMap.get(pid);

      const msgTime = msgData?.lastTime ? new Date(msgData.lastTime) : null;
      const reqTime = reqData?.createdAt ? new Date(reqData.createdAt) : null;

      // Most recent activity time
      let lastActivityTime: Date;
      let preview: string;
      let previewType: "message" | "request";

      if (msgTime && reqTime) {
        if (msgTime >= reqTime) {
          lastActivityTime = msgTime;
          previewType = "message";
          preview = msgData!.lastMsg;
        } else {
          lastActivityTime = reqTime;
          previewType = "request";
          preview = `${reqData!.requestType} · ${reqData!.status}`;
        }
      } else if (msgTime) {
        lastActivityTime = msgTime;
        previewType = "message";
        preview = msgData!.lastMsg;
      } else {
        lastActivityTime = reqTime!;
        previewType = "request";
        preview = `${reqData!.requestType} · ${reqData!.status}`;
      }

      return {
        partnerId: pid,
        partnerUsername: partner?.username || "Unknown",
        partnerDisplayName: partner?.displayName || null,
        partnerPhoto: partner?.profilePhoto || null,
        partnerIsVerified: partner?.isVerified || false,
        partnerLastActiveAt: partner?.lastActiveAt || null,
        lastActivityTime,
        preview,
        previewType,
        unreadCount: msgData?.unread || 0,
        // Request info (if any)
        requestId: reqData?.id || null,
        requestType: reqData?.requestType || null,
        requestStatus: reqData?.status || null,
        requestNegotiationStatus: reqData?.negotiationStatus || null,
        itemName: reqData?.itemName || null,
        itemId: reqData?.itemId || null,
        iAmRequester: reqData ? reqData.requesterId === userId : false,
      };
    });

    // Sort by most recent activity
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

  // Game session completion endpoint
  app.post("/api/games/:gameId/complete-session", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const gameId = parseInt(req.params.gameId);
    const { score, sessionId } = req.body;

    // Find the game and validate
    const [game] = await db
      .select()
      .from(sponsoredGames)
      .where(eq(sponsoredGames.id, gameId))
      .limit(1);

    if (!game) {
      return res.status(404).send("Game not found");
    }

    // Update session status and award coins
    const [session] = await db
      .update(gameSessions)
      .set({
        completedAt: new Date(),
        score,
        rewardAmount: game.rewardAmount,
        status: "completed",
      })
      .where(eq(gameSessions.id, parseInt(sessionId)))
      .returning();

    // Record ShareCoins transaction
    await db.insert(shareCoinsTransactions).values({
      userId: req.user.id,
      amount: game.rewardAmount.toString(),
      description: `Earned from completing ${game.name}`,
      transactionType: "EARNED",
    });

    // Update user's ShareCoins balance
    await db
      .update(users)
      .set({
        shareCoins: sql`share_coins + ${game.rewardAmount}`,
      })
      .where(eq(users.id, req.user.id));

    res.json({ success: true, reward: game.rewardAmount });
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
    const { requestType, message, startDate, endDate, deliveryMethod } = req.body;

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

    // Validate deliveryMethod
    const validDeliveryMethods = ["in_person", "courier"];
    const validatedDeliveryMethod = validDeliveryMethods.includes(deliveryMethod) 
      ? deliveryMethod 
      : "in_person";

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
        deliveryConfirmed: false,
      })
      .returning();

    // Get requester info for notification
    const [requester] = await db
      .select({ username: users.username, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    const requesterName = requester?.displayName || requester?.username || "Someone";
    const requestTypeLabel = requestType.charAt(0).toUpperCase() + requestType.slice(1).toLowerCase();

    // Create notification for item owner
    if (item.ownerId) {
      await db.insert(notifications).values({
        userId: item.ownerId,
        type: "item_request",
        title: `New ${requestTypeLabel} Request`,
        message: `${requesterName} wants to ${requestType.toLowerCase()} your ${item.name}`,
        itemId: item.id,
        requestId: request.id,
        isRead: false,
      });
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
        courierBookedBy: itemRequests.courierBookedBy,
        courierIssue: itemRequests.courierIssue,
        courierIssueNote: itemRequests.courierIssueNote,
        // Trust deposit fields
        trustDepositAmount: itemRequests.trustDepositAmount,
        trustDepositBaseAmount: itemRequests.trustDepositBaseAmount,
        trustDiscountPercentage: itemRequests.trustDiscountPercentage,
        shareCoinAmount: itemRequests.shareCoinAmount,
        depositStatus: itemRequests.depositStatus,
        courierAddress: itemRequests.courierAddress,
        courierPickupWindow: itemRequests.courierPickupWindow,
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
        // Handoff / return confirmations
        ownerConfirmedHandoff: itemRequests.ownerConfirmedHandoff,
        borrowerConfirmedHandoff: itemRequests.borrowerConfirmedHandoff,
        handoffConfirmDeadline: itemRequests.handoffConfirmDeadline,
        ownerConfirmedReturn: itemRequests.ownerConfirmedReturn,
        borrowerConfirmedReturn: itemRequests.borrowerConfirmedReturn,
        returnConditionOk: itemRequests.returnConditionOk,
        returnDisputeTriggered: itemRequests.returnDisputeTriggered,
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
        reqId: users.id,
        reqUsername: users.username,
        reqHandle: users.handle,
        reqDisplayName: users.displayName,
        reqIsVerified: users.isVerified,
        reqReputationLevel: users.reputationLevel,
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
      courierBookedBy: r.courierBookedBy,
      courierIssue: r.courierIssue,
      courierIssueNote: r.courierIssueNote,
      trustDepositAmount: r.trustDepositAmount,
      trustDepositBaseAmount: r.trustDepositBaseAmount,
      trustDiscountPercentage: r.trustDiscountPercentage,
      shareCoinAmount: r.shareCoinAmount,
      depositStatus: r.depositStatus,
      courierAddress: r.courierAddress,
      courierPickupWindow: r.courierPickupWindow,
      negotiationStatus: r.negotiationStatus,
      counterDeliveryMethod: r.counterDeliveryMethod,
      counterDepositMethod: r.counterDepositMethod,
      counterStartDate: r.counterStartDate,
      counterEndDate: r.counterEndDate,
      counterProposedBy: r.counterProposedBy,
      counterProposedAt: r.counterProposedAt,
      termsAcceptedAt: r.termsAcceptedAt,
      termsDeclinedAt: r.termsDeclinedAt,
      ownerConfirmedHandoff: r.ownerConfirmedHandoff,
      borrowerConfirmedHandoff: r.borrowerConfirmedHandoff,
      handoffConfirmDeadline: r.handoffConfirmDeadline,
      ownerConfirmedReturn: r.ownerConfirmedReturn,
      borrowerConfirmedReturn: r.borrowerConfirmedReturn,
      returnConditionOk: r.returnConditionOk,
      returnDisputeTriggered: r.returnDisputeTriggered,
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
      },
      requester: {
        id: r.reqId,
        username: r.reqUsername,
        handle: r.reqHandle,
        displayName: r.reqDisplayName,
        isVerified: r.reqIsVerified,
        reputationLevel: r.reqReputationLevel,
      },
    }));

    // Sort to prioritize verified requesters for pending requests (owner sees verified first)
    const sortedRequests = requests.sort((a, b) => {
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

    const [updatedRequest] = await db
      .update(itemRequests)
      .set({ status })
      .where(eq(itemRequests.id, requestId))
      .returning();

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
        
        // Award ShareCoins only if not flagged as farming
        if (measures.awardShareCoins) {
          // Award ShareCoins to the item owner (current user) with first-time bonus
          const ownerResult = await awardShareCoinsWithFirstTimeBonus(
            req.user.id,
            'SWAP',
            request.items.name,
            1
          );

          // Award ShareCoins to the requester with first-time bonus
          const requesterResult = await awardShareCoinsWithFirstTimeBonus(
            request.item_requests.requesterId,
            'SWAP',
            request.items.name,
            1
          );
            
          console.log(`✅ Awarded ShareCoins for swap: Owner=${ownerResult.totalAwarded} (first-time: ${ownerResult.isFirstTime}), Requester=${requesterResult.totalAwarded} (first-time: ${requesterResult.isFirstTime})`);
          
          // Award trust points for successful swap completion (+30 each)
          try {
            await awardSwapCompletionPoints(
              req.user.id,
              request.item_requests.requesterId,
              requestId,
              request.items.id,
              request.items.id // Both users get points for the same transaction
            );
            console.log(`✅ Awarded trust points for swap completion`);
          } catch (trustError) {
            console.error("Error awarding swap trust points:", trustError);
          }

          // Check and award referral bonus for both users (first transaction completion)
          await checkAndAwardReferralBonus(req.user.id, requestId, 'SWAP');
          await checkAndAwardReferralBonus(request.item_requests.requesterId, requestId, 'SWAP');
        } else {
          console.log(`🚫 ShareCoins not awarded due to farming detection (${farmingDetection.riskLevel})`);
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

    // Handle gift acceptance - send system message (rewards given when both confirm handoff)
    if (status === "ACCEPTED" && request.item_requests.requestType === "GIFT") {
      try {
        await db.insert(messages).values({
          content: `🎁 Gift accepted! Arrange pickup or delivery for "${request.items.name}".`,
          senderId: req.user.id,
          receiverId: request.item_requests.requesterId,
        });
        console.log(`✅ Gift accepted - chat message sent for pickup coordination`);
      } catch (error) {
        console.error("Error sending gift acceptance message:", error);
      }
    }

    // For BORROW and RENT: send a system prompt so both parties know to coordinate here
    if (status === "ACCEPTED" && (request.item_requests.requestType === "BORROW" || request.item_requests.requestType === "RENT")) {
      try {
        const deliveryMethod = request.item_requests.deliveryMethod;
        const coordinationHint = deliveryMethod === "courier"
          ? `A courier will handle delivery — use this chat to confirm your pickup and drop-off addresses.`
          : `Use this chat to agree on a pickup location, address, and time that works for both of you.`;
        await db.insert(messages).values({
          content: `✅ Request accepted for "${request.items.name}"! ${coordinationHint}`,
          senderId: req.user.id,
          receiverId: request.item_requests.requesterId,
          messageType: "system",
        });
      } catch (_) {}
    }

    // Handle commission for rental transactions
    if (status === "ACCEPTED" && request.item_requests.requestType === "RENT") {
      try {
        const rentalPrice = parseFloat(request.items.dollarsPrice || "0");
        
        if (rentalPrice > 0) {
          // Check if requester is premium user
          const [requesterUser] = await db
            .select({ isPremium: users.isPremium })
            .from(users)
            .where(eq(users.id, request.item_requests.requesterId))
            .limit(1);
          
          const isPremiumUser = requesterUser?.isPremium || false;
          const commissionDetails = calculateCommission(rentalPrice, 'RENTAL', isPremiumUser);
          
          if (commissionDetails.commissionAmount > 0) {
            // Log platform commission with new messaging
            console.log(`✅ ${platformConfig.messaging.commission}`);
            console.log(`Commission: $${commissionDetails.commissionAmount.toFixed(2)} (${(commissionDetails.rate * 100).toFixed(1)}% of $${rentalPrice}) - Premium: ${isPremiumUser}`);
            console.log(`Breakdown: $${commissionDetails.platformAmount.toFixed(2)} platform sustainability, $${commissionDetails.userRewardAmount.toFixed(2)} user reward fund`);
            
            // Record commission transaction
            await db.insert(shareCoinsTransactions).values({
              userId: request.item_requests.requesterId,
              amount: (-commissionDetails.commissionAmount).toString(),
              description: `Platform commission for renting: ${request.items.name}${isPremiumUser ? ' (Premium Rate)' : ''}`,
              transactionType: "COMMISSION",
            });
            
            // Record commission details in platform_commissions table
            await db.insert(platformCommissions).values({
              transactionId: requestId,
              amount: commissionDetails.commissionAmount.toString(),
              commissionRate: commissionDetails.rate.toString(),
              transactionType: "RENTAL",
              itemId: request.items.id,
              payerId: request.item_requests.requesterId,
            });
          } else {
            console.log(`No commission charged: amount below minimum ($${platformConfig.minimumCommission})`);
          }
        }
      } catch (error) {
        console.error("Error processing rental commission:", error);
        // Don't fail the request acceptance if commission processing fails
      }
    }

    res.json(updatedRequest);
  });

  // =====================================
  // TERMS NEGOTIATION ENDPOINTS
  // =====================================

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
    const { deliveryMethod, depositMethod, startDate, endDate } = req.body;

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

    // If the user is the requester responding to an owner counter, they must have a counter to respond to
    const isRequester = req.user.id === request.item_requests.requesterId;
    const isOwner = req.user.id === request.items.ownerId;

    if (isRequester && request.item_requests.negotiationStatus !== "counter_proposed") {
      return res.status(400).json({ error: "No counter-proposal to respond to with your own counter" });
    }

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
      })
      .where(eq(itemRequests.id, requestId))
      .returning();

    const otherUserId = isOwner ? request.item_requests.requesterId : request.items.ownerId!;

    // Log event in chat
    await logRequestEvent(req.user.id, otherUserId, requestId, "counter_proposed", {
      deliveryMethod: updated.counterDeliveryMethod,
      depositMethod: updated.counterDepositMethod,
      startDate: updated.counterStartDate,
      endDate: updated.counterEndDate,
      proposedByRole: isOwner ? "owner" : "requester",
    });

    // Notify other party
    await db.insert(notifications).values({
      userId: otherUserId,
      type: "terms_counter_proposed",
      title: isOwner ? "Owner Proposed New Terms" : "Requester Proposed New Terms",
      message: `New terms proposed for your ${request.item_requests.requestType?.toLowerCase()} request. Review and respond.`,
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
    const { accept, counter } = req.body; // accept: bool | counter: { deliveryMethod, depositMethod, startDate, endDate }

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

    const isRequester = req.user.id === request.item_requests.requesterId;
    const isOwner = req.user.id === request.items.ownerId;
    const otherUserId = isRequester ? request.items.ownerId! : request.item_requests.requesterId;

    // The responder must be the other party from whoever proposed
    if (request.item_requests.counterProposedBy === req.user.id) {
      return res.status(400).json({ error: "You already proposed the current counter. Wait for the other party." });
    }

    // Counter-back
    if (counter) {
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
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      await logRequestEvent(req.user.id, otherUserId, requestId, "counter_proposed", {
        deliveryMethod: updated.counterDeliveryMethod,
        depositMethod: updated.counterDepositMethod,
        startDate: updated.counterStartDate,
        endDate: updated.counterEndDate,
        proposedByRole: isOwner ? "owner" : "requester",
      });

      await db.insert(notifications).values({
        userId: otherUserId,
        type: "terms_counter_proposed",
        title: "New Counter-Proposal",
        message: `New terms proposed for your ${request.item_requests.requestType?.toLowerCase()} request.`,
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
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      // If owner accepted, create delivery arrangement so requester can proceed to deposit
      if (ownerIsAccepting && finalDeliveryMethod && finalDepositMethod) {
        try {
          await db.insert(deliveryArrangements).values({
            requestId,
            deliveryType: finalDeliveryMethod === "courier" ? "UBER_DIRECT" : "SELF_ARRANGE",
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

      await db.insert(notifications).values({
        userId: otherUserId,
        type: ownerIsAccepting ? "request_accepted" : "terms_accepted",
        title: ownerIsAccepting ? "Request Accepted!" : "Terms Accepted",
        message: ownerIsAccepting
          ? `Your request for "${request.items.name}" has been accepted! Pay your deposit to confirm.`
          : "Requester accepted your terms. You can now accept or decline the request.",
        itemId: request.items.id,
        requestId,
      });

      return res.json({
        success: true,
        request: updated,
        ownerAccepted: ownerIsAccepting,
        message: ownerIsAccepting
          ? "Request accepted! The requester can now pay their deposit."
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
        message: "The other party declined the proposed terms.",
        itemId: request.items.id,
        requestId,
      });

      return res.json({ success: true, request: updated, message: "Request cancelled" });
    }
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

      // Award ShareCoins to both parties
      const giverId = request.items.ownerId!;
      const receiverId = request.item_requests.requesterId;

      // Award to giver
      await awardShareCoinsWithFirstTimeBonus(giverId, 'GIFT', request.items.name, 1);
      
      // Award to receiver
      await db.insert(shareCoinsTransactions).values({
        userId: receiverId,
        amount: "1",
        description: `Received gift: ${request.items.name}`,
        transactionType: "GIFT_RECEIVED",
      });
      await db
        .update(users)
        .set({ 
          shareCoins: sql`${users.shareCoins} + 1`
        })
        .where(eq(users.id, receiverId));

      // Update trust scores
      try {
        await awardGiftingPoints(giverId, receiverId, requestId, request.items.id);
        console.log(`✅ Awarded trust points for completed gift`);
      } catch (trustError) {
        console.error("Error awarding gift trust points:", trustError);
      }

      // Check and award referral bonus for both users (first transaction completion)
      await checkAndAwardReferralBonus(giverId, requestId, 'GIFT');
      await checkAndAwardReferralBonus(receiverId, requestId, 'GIFT');

      // Send completion notification to both parties
      await db.insert(notifications).values([
        {
          userId: giverId,
          type: "gift_completed",
          title: "Gift Complete!",
          message: `Your gift "${request.items.name}" has been received. Thank you for sharing! +1 ShareCoins`,
          itemId: request.items.id,
          requestId: requestId,
        },
        {
          userId: receiverId,
          type: "gift_completed",
          title: "Gift Received!",
          message: `You've received "${request.items.name}". Enjoy! +1 ShareCoins`,
          itemId: request.items.id,
          requestId: requestId,
        },
      ]);

      return res.json({
        success: true,
        completed: true,
        message: "Gift exchange complete! Both parties have been awarded ShareCoins.",
      });
    }

    // Only one party confirmed so far
    const otherPartyId = role === "giver" ? request.item_requests.requesterId : request.items.ownerId!;
    await db.insert(notifications).values({
      userId: otherPartyId,
      type: "gift_handoff_pending",
      title: role === "giver" ? "Giver confirmed handoff" : "Receiver confirmed receipt",
      message: `Please confirm the gift handoff for "${request.items.name}"`,
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
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { depositAmount, requestId } = req.body;

      if (!depositAmount || depositAmount <= 0) {
        return res.status(400).json({ error: "Invalid deposit amount" });
      }

      // Calculate 5% processing fee
      const processingFee = depositAmount * 0.05;
      const totalAmount = depositAmount + processingFee;

      // Create payment intent with manual capture (authorization hold)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalAmount * 100), // Convert to cents
        currency: "usd",
        capture_method: "manual", // Hold funds, don't capture immediately
        metadata: {
          type: "security_deposit",
          request_id: requestId.toString(),
          user_id: req.user.id.toString(),
          deposit_amount: depositAmount.toString(),
          processing_fee: processingFee.toString(),
        },
        description: `Security deposit hold for ShareSwap request #${requestId}`,
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        depositAmount,
        processingFee,
        totalAmount,
      });
    } catch (error: any) {
      console.error("Error creating deposit hold:", error);
      res.status(500).json({ error: "Failed to create deposit hold: " + error.message });
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

      // For now, simulate payout request (Stripe Connect integration needed for real payouts)
      // In production, this would create a Stripe Transfer to the connected account
      
      // Deduct from balance and create payout record
      await db
        .update(users)
        .set({
          rentalBalance: sql`${users.rentalBalance} - ${requestedAmount}`,
        })
        .where(eq(users.id, req.user.id));

      // Create a payout tracking record (null requestId for manual cash-out)
      const [payoutRecord] = await db.insert(rentalPayouts).values({
        userId: req.user.id,
        requestId: null,
        amount: requestedAmount.toString(),
        rentalAmount: requestedAmount.toString(),
        platformFee: "0",
        processingFee: "0",
        netAmount: requestedAmount.toString(),
        status: 'pending_payout',
        paidOutAt: new Date(),
      }).returning();

      res.json({
        success: true,
        message: "Payout request submitted. Funds will be transferred to your bank account within 2-3 business days.",
        payout: {
          id: payoutRecord.id,
          amount: requestedAmount,
          status: 'pending_payout',
          estimatedArrival: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
        },
      });
    } catch (error: any) {
      console.error("Error processing payout:", error);
      res.status(500).json({ error: "Failed to process payout" });
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
      const { requestId, depositAmount, rentalAmount, processingFee, platformFee, courierFee } = req.body;

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

      // Total amount to authorize (deposit + processing fee + courier if applicable)
      // Rental fee will be charged on handoff, deposit is held
      const totalHoldAmount = depositAmount + (processingFee || 0) + (courierFee || 0);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalHoldAmount * 100),
        currency: "usd",
        capture_method: "manual",
        metadata: {
          type: "rental_deposit",
          requestId: requestId.toString(),
          userId: req.user.id.toString(),
          depositAmount: depositAmount.toString(),
          rentalAmount: (rentalAmount || 0).toString(),
          processingFee: (processingFee || 0).toString(),
          platformFee: (platformFee || 0).toString(),
        },
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        depositAmount,
        rentalAmount,
        totalHoldAmount,
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

      // Verify payment intent is in the correct state (requires_capture = authorized but not captured)
      if (paymentIntent.status !== "requires_capture") {
        return res.status(400).json({ 
          error: "Payment has not been authorized correctly",
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

      // Create escrow record for rental earnings (held until return confirmed)
      if (rentalAmount && rentalAmount > 0) {
        const actualRentalAmount = parseFloat(rentalAmount);
        const actualPlatformFee = 0; // 0% platform fee for 2025
        const actualProcessingFee = actualRentalAmount * 0.03; // 3% processing fee
        const netAmount = actualRentalAmount - actualPlatformFee - actualProcessingFee;
        
        // Create held payout record for the owner
        await db.insert(rentalPayouts).values({
          userId: request.items.ownerId!,
          requestId: requestId,
          amount: actualRentalAmount.toString(),
          rentalAmount: actualRentalAmount.toString(),
          platformFee: actualPlatformFee.toString(),
          processingFee: actualProcessingFee.toFixed(2),
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

      const nextStep = request.item_requests.deliveryMethod === "courier" ? "book_courier" : "await_handoff";

      res.json({
        success: true,
        request: updated,
        nextStep,
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
          shareCoinAmount: shareCoinAmount?.toString(),
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      res.json({
        success: true,
        request: updated,
        nextStep: request.item_requests.deliveryMethod === "courier" ? "book_courier" : "await_handoff",
      });
    } catch (error: any) {
      console.error("Error processing deposit payment:", error);
      res.status(500).json({ error: "Failed to process deposit payment" });
    }
  });

  // Book courier (step 2 if courier was selected)
  app.post("/api/requests/:requestId/book-courier", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      const { address, pickupWindow } = req.body;
      
      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      // Must be the requester (borrower is responsible for courier)
      if (request.item_requests.requesterId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Deposit must be confirmed first (CRITICAL: never book courier if deposit failed)
      if (request.item_requests.status !== "DEPOSIT_CONFIRMED") {
        return res.status(400).json({ error: "Deposit must be confirmed before booking courier" });
      }

      // Generate a simulated courier booking ID (in production, this would call Uber Direct API)
      const courierBookingId = `COURIER-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

      // Update request with courier info
      const [updated] = await db
        .update(itemRequests)
        .set({
          status: "COURIER_PENDING",
          courierAddress: address,
          courierPickupWindow: pickupWindow,
          courierBookingId: courierBookingId,
          courierBookedAt: new Date(),
          courierStatus: "booked",
          courierBookedBy: "requester",
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      res.json({
        success: true,
        request: updated,
        courierBookingId,
        message: "Courier booked successfully. Awaiting pickup.",
      });
    } catch (error: any) {
      console.error("Error booking courier:", error);
      res.status(500).json({ error: "Failed to book courier" });
    }
  });

  // Cancel courier booking (transaction pauses, nothing breaks)
  app.post("/api/requests/:requestId/cancel-courier", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      
      const [request] = await db
        .select()
        .from(itemRequests)
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      if (request.requesterId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Update status back to deposit confirmed (paused state)
      const [updated] = await db
        .update(itemRequests)
        .set({
          status: "DEPOSIT_CONFIRMED",
          courierStatus: "cancelled",
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      res.json({
        success: true,
        request: updated,
        message: "Courier booking cancelled. You can rebook anytime.",
      });
    } catch (error: any) {
      console.error("Error cancelling courier:", error);
      res.status(500).json({ error: "Failed to cancel courier" });
    }
  });

  // Cancel request after acceptance (applies penalty with grace pass for first offense)
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

      // Can only cancel if status is ACCEPTED or beyond (but not COMPLETED)
      const cancelableStatuses = ["ACCEPTED", "DEPOSIT_CONFIRMED", "COURIER_PENDING", "HANDOFF_CONFIRMED"];
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
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      // Make item available again
      await db
        .update(items)
        .set({ isAvailable: true })
        .where(eq(items.id, request.items.id));

      // Apply cancellation penalty to the cancelling user (with grace pass for first offense)
      let penaltyResult = { applied: false, wasGracePass: false };
      try {
        penaltyResult = await applyCancellationPenalty(
          req.user.id,
          requestId,
          request.items.id
        );
      } catch (penaltyError) {
        console.error("Error applying cancellation penalty:", penaltyError);
        // Don't fail the cancellation if penalty fails
      }

      res.json({
        success: true,
        request: updated,
        depositReleased: !!request.item_requests.depositPaymentIntentId,
        message: penaltyResult.wasGracePass 
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
      const noShowStatuses = ["DEPOSIT_CONFIRMED", "COURIER_PENDING", "HANDOFF_CONFIRMED"];
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

      // Validate status (must be DEPOSIT_CONFIRMED, COURIER_PENDING, or AWAITING_HANDOFF_CONFIRM)
      const validStatuses = ["DEPOSIT_CONFIRMED", "COURIER_PENDING", "AWAITING_HANDOFF_CONFIRM"];
      if (!validStatuses.includes(request.item_requests.status)) {
        return res.status(400).json({ error: "Request is not ready for handoff" });
      }

      const now = new Date();
      const CONFIRMATION_DEADLINE_HOURS = 24;
      const deadline = new Date(now.getTime() + CONFIRMATION_DEADLINE_HOURS * 60 * 60 * 1000);
      
      // Determine which party is confirming
      const ownerAlreadyConfirmed = request.item_requests.ownerConfirmedHandoff;
      const borrowerAlreadyConfirmed = request.item_requests.borrowerConfirmedHandoff;
      
      let updateData: any = {};
      let waitingMessage = "";
      let bothConfirmed = false;

      if (isOwner && !ownerAlreadyConfirmed) {
        updateData.ownerConfirmedHandoff = true;
        updateData.ownerConfirmedHandoffAt = now;
        
        if (borrowerAlreadyConfirmed) {
          bothConfirmed = true;
        } else {
          updateData.status = "AWAITING_HANDOFF_CONFIRM";
          updateData.handoffConfirmDeadline = deadline;
          waitingMessage = `You've confirmed handoff. Waiting for borrower to confirm (${CONFIRMATION_DEADLINE_HOURS}h deadline).`;
        }
      } else if (isRequester && !borrowerAlreadyConfirmed) {
        updateData.borrowerConfirmedHandoff = true;
        updateData.borrowerConfirmedHandoffAt = now;
        
        if (ownerAlreadyConfirmed) {
          bothConfirmed = true;
        } else {
          updateData.status = "AWAITING_HANDOFF_CONFIRM";
          updateData.handoffConfirmDeadline = deadline;
          waitingMessage = `You've confirmed received. Waiting for owner to confirm (${CONFIRMATION_DEADLINE_HOURS}h deadline).`;
        }
      } else {
        return res.status(400).json({ error: "You have already confirmed the handoff" });
      }

      // If both parties have now confirmed, complete the handoff
      if (bothConfirmed) {
        // Charge ShareCoins from borrower (only for BORROW type)
        const shareCoinAmount = parseFloat(request.item_requests.shareCoinAmount || request.items.shareCoinPrice || "0");
        
        if (shareCoinAmount > 0 && request.item_requests.requestType === "BORROW") {
          const [borrower] = await db
            .select({ shareCoins: users.shareCoins })
            .from(users)
            .where(eq(users.id, request.item_requests.requesterId))
            .limit(1);

          const currentBalance = parseFloat(borrower?.shareCoins || "0");
          
          if (currentBalance < shareCoinAmount) {
            return res.status(400).json({ error: "Insufficient ShareCoins balance" });
          }

          // Deduct ShareCoins from borrower
          await db
            .update(users)
            .set({ shareCoins: (currentBalance - shareCoinAmount).toString() })
            .where(eq(users.id, request.item_requests.requesterId));

          // Record the transaction
          await db.insert(shareCoinsTransactions).values({
            userId: request.item_requests.requesterId,
            amount: (-shareCoinAmount).toString(),
            description: `Borrowed: ${request.items.name}`,
            transactionType: "BORROW_CHARGE",
          });

          // Award ShareCoins to lender
          if (request.items.ownerId) {
            const [lender] = await db
              .select({ shareCoins: users.shareCoins })
              .from(users)
              .where(eq(users.id, request.items.ownerId))
              .limit(1);

            const lenderBalance = parseFloat(lender?.shareCoins || "0");
            await db
              .update(users)
              .set({ shareCoins: (lenderBalance + shareCoinAmount).toString() })
              .where(eq(users.id, request.items.ownerId));

            await db.insert(shareCoinsTransactions).values({
              userId: request.items.ownerId,
              amount: shareCoinAmount.toString(),
              description: `Lent: ${request.items.name}`,
              transactionType: "LEND_REWARD",
            });
          }
        }

        // Complete the handoff
        updateData.status = "IN_PROGRESS";
        updateData.handoffConfirmedAt = now;
        updateData.borrowPeriodStartedAt = now;
        updateData.shareCoinsCharged = true;
        updateData.shareCoinsChargedAt = now;
        updateData.depositStatus = "held";

        // Mark item as unavailable
        await db
          .update(items)
          .set({ isAvailable: false })
          .where(eq(items.id, request.items.id));
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
            ? `Owner has confirmed handoff for "${request.items.name}". Please confirm you received the item.`
            : `Borrower has confirmed receiving "${request.items.name}". Please confirm the handoff.`,
          itemId: request.items.id,
          requestId: requestId,
        });
      }

      res.json({
        success: true,
        request: updated,
        bothConfirmed,
        waitingMessage: bothConfirmed ? undefined : waitingMessage,
        message: bothConfirmed 
          ? "Handoff confirmed by both parties! Borrow period has started." 
          : waitingMessage,
      });
    } catch (error: any) {
      console.error("Error confirming handoff:", error);
      res.status(500).json({ error: "Failed to confirm handoff" });
    }
  });

  // Auto-advance handoffs that have passed their deadline (called by client-side polling)
  app.post("/api/requests/check-handoff-deadlines", csrfProtection, async (req, res) => {
    try {
      const now = new Date();
      
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

      for (const request of expiredHandoffs) {
        // Auto-advance: complete the handoff
        const shareCoinAmount = parseFloat(request.item_requests.shareCoinAmount || request.items.shareCoinPrice || "0");
        
        // Process ShareCoins for BORROW type
        if (shareCoinAmount > 0 && request.item_requests.requestType === "BORROW") {
          const [borrower] = await db
            .select({ shareCoins: users.shareCoins })
            .from(users)
            .where(eq(users.id, request.item_requests.requesterId))
            .limit(1);

          const currentBalance = parseFloat(borrower?.shareCoins || "0");
          
          if (currentBalance >= shareCoinAmount) {
            // Deduct from borrower
            await db
              .update(users)
              .set({ shareCoins: (currentBalance - shareCoinAmount).toString() })
              .where(eq(users.id, request.item_requests.requesterId));

            await db.insert(shareCoinsTransactions).values({
              userId: request.item_requests.requesterId,
              amount: (-shareCoinAmount).toString(),
              description: `Borrowed: ${request.items.name} (auto-advanced)`,
              transactionType: "BORROW_CHARGE",
            });

            // Award to lender
            if (request.items.ownerId) {
              const [lender] = await db
                .select({ shareCoins: users.shareCoins })
                .from(users)
                .where(eq(users.id, request.items.ownerId))
                .limit(1);

              const lenderBalance = parseFloat(lender?.shareCoins || "0");
              await db
                .update(users)
                .set({ shareCoins: (lenderBalance + shareCoinAmount).toString() })
                .where(eq(users.id, request.items.ownerId));

              await db.insert(shareCoinsTransactions).values({
                userId: request.items.ownerId,
                amount: shareCoinAmount.toString(),
                description: `Lent: ${request.items.name} (auto-advanced)`,
                transactionType: "LEND_REWARD",
              });
            }
          }
        }

        // Update request to IN_PROGRESS
        await db
          .update(itemRequests)
          .set({
            status: "IN_PROGRESS",
            handoffConfirmedAt: now,
            borrowPeriodStartedAt: now,
            shareCoinsCharged: true,
            shareCoinsChargedAt: now,
            depositStatus: "held",
            handoffAutoAdvanced: true,
          })
          .where(eq(itemRequests.id, request.item_requests.id));

        // Mark item as unavailable
        await db
          .update(items)
          .set({ isAvailable: false })
          .where(eq(items.id, request.items.id));

        // Notify both parties
        const confirmingParty = request.item_requests.ownerConfirmedHandoff ? "Owner" : "Borrower";
        const notificationMessage = `Handoff for "${request.items.name}" was auto-confirmed after ${confirmingParty.toLowerCase()} confirmation timed out.`;
        
        await db.insert(notifications).values([
          {
            userId: request.item_requests.requesterId,
            type: "handoff_auto_advanced",
            title: "Handoff Auto-Confirmed",
            message: notificationMessage,
            itemId: request.items.id,
            requestId: request.item_requests.id,
          },
          ...(request.items.ownerId ? [{
            userId: request.items.ownerId,
            type: "handoff_auto_advanced",
            title: "Handoff Auto-Confirmed",
            message: notificationMessage,
            itemId: request.items.id,
            requestId: request.item_requests.id,
          }] : []),
        ]);

        autoAdvancedCount++;
      }

      res.json({ success: true, autoAdvancedCount });
    } catch (error: any) {
      console.error("Error checking handoff deadlines:", error);
      res.status(500).json({ error: "Failed to check handoff deadlines" });
    }
  });

  // Borrower notifies about expected late return (avoids penalty when communicating in advance)
  // IMPORTANT: Must be called BEFORE the due date to avoid penalties - post-facto notifications are rejected
  app.post("/api/requests/:requestId/notify-delay", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      const { reason } = req.body;
      
      const [request] = await db
        .select()
        .from(itemRequests)
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      // Must be the borrower/requester
      if (request.requesterId !== req.user.id) {
        return res.status(403).json({ error: "Only the borrower can notify about delays" });
      }

      // Must be in a valid state for delay notification
      const validStatuses = ["IN_PROGRESS"];
      if (!validStatuses.includes(request.status)) {
        return res.status(400).json({ error: "Cannot notify delay in current status" });
      }

      // CRITICAL: Can only notify BEFORE the due date
      // Post-facto notifications don't count - must communicate in advance
      const now = new Date();
      const endDate = request.endDate ? new Date(request.endDate) : null;
      
      if (endDate && now >= endDate) {
        return res.status(400).json({ 
          error: "Cannot notify about delay after the due date. To avoid penalties, please communicate before the return date.",
          alreadyOverdue: true
        });
      }

      // Update the request with delay notification
      const [updated] = await db
        .update(itemRequests)
        .set({
          returnDelayNotifiedAt: new Date(),
          returnDelayReason: reason || "Borrower notified about expected delay",
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      res.json({
        success: true,
        request: updated,
        message: "Delay notification recorded. Thank you for communicating - this will help avoid trust score penalties.",
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
      
      const [request] = await db
        .select()
        .from(itemRequests)
        .innerJoin(items, eq(items.id, itemRequests.itemId))
        .where(eq(itemRequests.id, requestId))
        .limit(1);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      // Must be the borrower
      if (request.item_requests.requesterId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Must be in progress
      if (request.item_requests.status !== "IN_PROGRESS") {
        return res.status(400).json({ error: "Request is not in progress" });
      }

      const endDate = request.item_requests.endDate ? new Date(request.item_requests.endDate) : null;
      const isEarlyReturn = endDate ? new Date() < endDate : false;

      const [updated] = await db
        .update(itemRequests)
        .set({
          status: "RETURN_REQUESTED",
          returnRequestedAt: new Date(),
          isEarlyReturn,
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      res.json({
        success: true,
        request: updated,
        isEarlyReturn,
        message: isEarlyReturn 
          ? "Early return initiated. Waiting for lender confirmation."
          : "Return initiated. Waiting for lender confirmation.",
      });
    } catch (error: any) {
      console.error("Error initiating return:", error);
      res.status(500).json({ error: "Failed to initiate return" });
    }
  });

  // Lender confirms return (releases deposit, updates trust score)
  app.post("/api/requests/:requestId/confirm-return", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseInt(req.params.requestId);
      const { conditionRating, conditionNotes, sameCondition, triggerDispute } = req.body;
      
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
          message: `${req.user.username} has opened a dispute for "${request.items.name}". The deposit is on hold pending review.`,
          link: `/requests`,
        });

        return res.json({
          success: true,
          request: disputed,
          disputeOpened: true,
          message: "Dispute opened. The deposit is held pending review. We'll contact both parties to resolve this.",
        });
      }

      // Release the deposit via Stripe
      if (request.item_requests.depositPaymentIntentId) {
        try {
          await stripe.paymentIntents.cancel(request.item_requests.depositPaymentIntentId);
        } catch (stripeError: any) {
          console.error("Error releasing deposit:", stripeError);
          // Continue even if Stripe fails - we don't want to block the return
        }
      }

      const isEarlyReturn = request.item_requests.isEarlyReturn || false;
      const isRental = request.item_requests.requestType === 'RENT';

      // Update request to completed (early returns get "COMPLETED_EARLY" status)
      const [updated] = await db
        .update(itemRequests)
        .set({
          status: isEarlyReturn ? "COMPLETED_EARLY" : "COMPLETED",
          returnConfirmedAt: new Date(),
          returnConditionRating: conditionRating || 5,
          returnConditionNotes: conditionNotes,
          depositStatus: "released",
          depositReleasedAt: new Date(),
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      // Mark item as available again
      await db
        .update(items)
        .set({ isAvailable: true })
        .where(eq(items.id, request.items.id));

      // Award trust points using the new tiered system
      // Check if return was on time (before or on the end date)
      const endDate = request.item_requests.endDate ? new Date(request.item_requests.endDate) : null;
      const now = new Date();
      const wasOnTime = endDate ? now <= endDate : true;
      
      // Calculate days late for penalty purposes
      let daysLate = 0;
      if (!wasOnTime && endDate) {
        daysLate = Math.ceil((now.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
      }
      
      try {
        await awardBorrowReturnPoints(
          request.item_requests.requesterId,
          request.items.ownerId!,
          requestId,
          request.items.id,
          conditionRating || 5,
          wasOnTime
        );
        
        // Apply late return penalty if applicable (with grace pass for first-time offenders)
        // Only penalize if borrower didn't notify about the delay in advance
        if (!wasOnTime && daysLate >= 1) {
          const hadCommunication = !!request.item_requests.returnDelayNotifiedAt;
          await applyLateReturnPenalty(
            request.item_requests.requesterId,
            requestId,
            request.items.id,
            daysLate,
            hadCommunication
          );
        }
      } catch (trustError) {
        console.error("Error awarding trust points:", trustError);
        // Don't fail the return if trust scoring fails
      }

      // Check and award referral bonus for both users (first transaction completion)
      const transactionType = request.item_requests.requestType === 'RENT' ? 'RENT' : 'BORROW';
      await checkAndAwardReferralBonus(request.item_requests.requesterId, requestId, transactionType);
      await checkAndAwardReferralBonus(request.items.ownerId!, requestId, transactionType === 'RENT' ? 'RENT' : 'LEND');

      // For RENT transactions, release rental earnings from pending to available balance
      let rentalEarnings = null;
      if (request.item_requests.requestType === 'RENT' && request.item_requests.rentalAmount) {
        try {
          const rentalAmount = parseFloat(request.item_requests.rentalAmount);
          const platformFee = 0; // 0% platform fee for 2025
          const processingFee = rentalAmount * 0.03; // 3% payment processing fee
          const netAmount = rentalAmount - platformFee - processingFee;
          
          // Update existing held payout record to released
          const [existingPayout] = await db
            .select()
            .from(rentalPayouts)
            .where(and(
              eq(rentalPayouts.requestId, requestId),
              eq(rentalPayouts.status, 'held')
            ))
            .limit(1);
          
          if (existingPayout) {
            // Update held payout to released
            await db
              .update(rentalPayouts)
              .set({
                status: 'released',
                releasedAt: new Date(),
              })
              .where(eq(rentalPayouts.id, existingPayout.id));
            
            // Move from pending to available balance
            const existingNetAmount = parseFloat(existingPayout.netAmount || "0");
            await db
              .update(users)
              .set({
                pendingRentalBalance: sql`GREATEST(0, COALESCE(${users.pendingRentalBalance}, 0) - ${existingNetAmount})`,
                rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${existingNetAmount}`,
              })
              .where(eq(users.id, request.items.ownerId!));
            
            rentalEarnings = {
              rentalAmount,
              platformFee,
              processingFee,
              netAmount: existingNetAmount,
            };
            
            console.log(`Released rental earnings of $${existingNetAmount.toFixed(2)} from pending to available for owner ${request.items.ownerId}`);
          } else {
            // Fallback: create new released record if no held record exists
            await db.insert(rentalPayouts).values({
              userId: request.items.ownerId!,
              requestId: requestId,
              amount: rentalAmount.toString(),
              rentalAmount: rentalAmount.toString(),
              platformFee: platformFee.toString(),
              processingFee: processingFee.toFixed(2),
              netAmount: netAmount.toFixed(2),
              status: 'released',
              stripePaymentIntentId: request.item_requests.depositPaymentIntentId,
              releasedAt: new Date(),
            });
            
            await db
              .update(users)
              .set({
                rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${netAmount.toFixed(2)}`,
              })
              .where(eq(users.id, request.items.ownerId!));
            
            rentalEarnings = {
              rentalAmount,
              platformFee,
              processingFee,
              netAmount,
            };
            
            console.log(`Released rental earnings of $${netAmount.toFixed(2)} to owner ${request.items.ownerId} (fallback)`);
          }
        } catch (payoutError) {
          console.error("Error processing rental payout:", payoutError);
          // Don't fail the return if payout fails - log and continue
        }
      }

      let message: string;
      if (isEarlyReturn && isRental) {
        message = "Item returned early. Rental period completed.";
      } else if (isEarlyReturn) {
        message = "Item returned early. Deposit released.";
      } else if (isRental) {
        message = "Return confirmed! Deposit released and rental earnings added to your balance.";
      } else {
        message = "Return confirmed! Deposit has been released.";
      }

      res.json({
        success: true,
        request: updated,
        depositReleased: true,
        isEarlyReturn,
        rentalEarnings,
        message,
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
        .limit(50);

      res.json(userNotifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
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

  // Check and generate return reminders for active borrows/rentals
  app.post("/api/notifications/check-return-reminders", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const userId = req.user.id;
      const now = new Date();
      const twoDaysFromNow = new Date(now);
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
      
      // Only check items due within next 2 days or already overdue
      // This reduces DB load significantly
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
            eq(itemRequests.requesterId, userId),
            eq(itemRequests.status, "ACCEPTED"),
            or(
              eq(itemRequests.requestType, "borrow"),
              eq(itemRequests.requestType, "rent")
            ),
            // Only check items with endDate within next 2 days or overdue
            sql`${itemRequests.endDate} IS NOT NULL AND ${itemRequests.endDate} <= ${twoDaysFromNow}`
          )
        );

      let remindersCreated = 0;

      for (const { request, item, owner } of activeRequests) {
        const returnDate = request.endDate;
        if (!returnDate) continue;

        const returnDateObj = new Date(returnDate);
        returnDateObj.setHours(0, 0, 0, 0);
        
        const nowDate = new Date(now);
        nowDate.setHours(0, 0, 0, 0);

        const daysUntilReturn = Math.ceil((returnDateObj.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24));
        
        let notificationType = "";
        let title = "";
        let message = "";

        // Determine if reminder is needed
        if (daysUntilReturn === 1) {
          // Tomorrow
          notificationType = "return_reminder_tomorrow";
          title = "Return Reminder: Tomorrow";
          message = `"${item.name}" is due to be returned tomorrow. Please prepare to return it to ${owner.username}.`;
        } else if (daysUntilReturn === 0) {
          // Today
          notificationType = "return_reminder_today";
          title = "Return Reminder: Today";
          message = `"${item.name}" is due to be returned today! Please return it to ${owner.username} as soon as possible.`;
        } else if (daysUntilReturn < 0) {
          // Overdue
          const daysOverdue = Math.abs(daysUntilReturn);
          notificationType = "return_reminder_overdue";
          title = "Overdue Return";
          message = `"${item.name}" is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue! Please return it to ${owner.username} immediately.`;
        }

        if (notificationType) {
          // More robust duplicate check: check if notification exists for this exact scenario
          // Using try-catch to handle race conditions gracefully
          try {
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);

            const existingNotification = await db
              .select()
              .from(notifications)
              .where(
                and(
                  eq(notifications.userId, userId),
                  eq(notifications.requestId, request.id),
                  eq(notifications.type, notificationType),
                  gte(notifications.createdAt, todayStart)
                )
              )
              .limit(1);

            if (existingNotification.length === 0) {
              // Create the notification
              await db.insert(notifications).values({
                userId,
                type: notificationType,
                title,
                message,
                itemId: item.id,
                requestId: request.id,
                isRead: false,
              });
              remindersCreated++;
            }
          } catch (insertError) {
            // Silently handle duplicate insert errors from race conditions
            console.error("Error creating notification (may be duplicate):", insertError);
          }
        }
      }

      res.json({ remindersCreated });
    } catch (error) {
      console.error("Error checking return reminders:", error);
      res.status(500).json({ error: "Failed to check return reminders" });
    }
  });

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

      // Count referrals
      const [referralCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(eq(referrals.referrerId, userId));

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

      res.json({
        totalBorrowed: Number(borrowedCount?.count || 0),
        totalLent: Number(lentCount?.count || 0),
        totalSwaps: Number(swapCount?.count || 0),
        totalGifts: Number(giftCount?.count || 0),
        successfulHandoffs: Number(handoffCount?.count || 0),
        referrals: Number(referralCount?.count || 0),
        helpedUrgent: Math.min(Number(urgentCount?.count || 0), 1), // Cap at 1 for milestone
      });
    } catch (error) {
      console.error("Error fetching user stats:", error);
      res.status(500).json({ error: "Failed to fetch user stats" });
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

      res.json({
        ...user,
        isVerified,
        emailVerified: user.emailVerified || !!user.googleId || user.authProvider === 'google',
        paymentVerified,
        idVerified,
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

    // Build update object with only provided fields
    const updateData: Partial<{ fullName: string; bio: string; location: string; phone: string; displayName: string; defaultPostalCode: string }> = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (bio !== undefined) updateData.bio = bio;
    if (location !== undefined) updateData.location = location;
    if (phone !== undefined) updateData.phone = phone;
    if (displayName !== undefined) updateData.displayName = displayName;
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
              'COURIER_PENDING','HANDOFF_CONFIRMED','IN_PROGRESS'
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

      // Calculate commission details for ShareCoin rewards
      const rentalPrice = parseFloat(rental.items.dollarsPrice || "0");
      const commissionDetails = calculateCommission(rentalPrice, 'RENTAL', false);

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

  // Get farming detection stats (admin endpoint)
  app.get("/api/admin/farming-stats", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }
    
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
      message: `Your item "${request.items.name}" has been received successfully.`,
      itemId: request.items.id,
      requestId: requestId,
      isRead: false,
    });

    const depositMessage = request.item_requests.deliveryMethod === "courier" 
      ? "Delivery confirmed. Trust-deposit is now active."
      : "Handoff confirmed. Trust-deposit is active.";

    res.json({ 
      success: true, 
      message: depositMessage,
      request: updated 
    });
  });

  // Report courier issue (item lost/damaged during courier delivery)
  app.post("/api/requests/:requestId/courier-issue", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);
    const { issueNote } = req.body;

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

    // Only courier deliveries can have courier issues
    if (request.item_requests.deliveryMethod !== "courier") {
      return res.status(400).send("Courier issues only apply to courier deliveries");
    }

    // Request must be accepted first
    if (request.item_requests.status !== "ACCEPTED") {
      return res.status(400).send("Request must be accepted to report courier issues");
    }

    // Courier booking info should be present for proper responsibility assignment
    if (!request.item_requests.courierBookedBy) {
      return res.status(400).send("Courier booking information must be recorded before reporting issues");
    }

    // Prevent duplicate issue reports
    if (request.item_requests.courierIssue) {
      return res.status(400).send("A courier issue has already been reported for this request");
    }

    // Either party can report a courier issue
    const isOwner = request.items.ownerId === req.user.id;
    const isRequester = request.item_requests.requesterId === req.user.id;
    
    if (!isOwner && !isRequester) {
      return res.status(403).send("Only parties involved in this transaction can report issues");
    }

    // Update courier issue status - this voids any trust-deposit charges
    // When courierIssue is true, trust-deposit should not be activated or charged
    const [updated] = await db
      .update(itemRequests)
      .set({ 
        courierIssue: true,
        courierIssueNote: issueNote || "Item lost or damaged during courier delivery",
        // Clear delivery confirmation since delivery didn't complete successfully
        deliveryConfirmed: false,
        deliveryConfirmedAt: null
      })
      .where(eq(itemRequests.id, requestId))
      .returning();

    // Notify both parties
    const notifyUserId = isOwner ? request.item_requests.requesterId : request.items.ownerId;
    const courierBooker = request.item_requests.courierBookedBy;
    const bookerLabel = courierBooker === 'requester' ? 'borrower/renter' : 'owner';
    
    if (notifyUserId) {
      await db.insert(notifications).values({
        userId: notifyUserId,
        type: "courier_issue",
        title: "Courier Issue Reported",
        message: `A courier issue has been reported for "${request.items.name}". The ${bookerLabel} who booked the courier will handle this with the delivery service. Trust-deposit will NOT be charged.`,
        itemId: request.items.id,
        requestId: requestId,
        isRead: false,
      });
    }

    res.json({ 
      success: true, 
      message: `Courier issue reported. Trust-deposit will NOT be charged. The ${bookerLabel} who booked the courier is responsible for resolving this with the delivery service.`,
      request: updated,
      responsibleParty: courierBooker
    });
  });

  // Update who booked the courier
  app.patch("/api/requests/:requestId/courier-booker", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);
    const { bookedBy } = req.body; // 'requester' | 'owner'

    if (!['requester', 'owner'].includes(bookedBy)) {
      return res.status(400).send("bookedBy must be 'requester' or 'owner'");
    }

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

    // Only allow if user is involved in the transaction
    const isOwner = request.items.ownerId === req.user.id;
    const isRequester = request.item_requests.requesterId === req.user.id;
    
    if (!isOwner && !isRequester) {
      return res.status(403).send("Not authorized");
    }

    // Only courier deliveries need this
    if (request.item_requests.deliveryMethod !== "courier") {
      return res.status(400).send("Only courier deliveries track who booked");
    }

    const [updated] = await db
      .update(itemRequests)
      .set({ courierBookedBy: bookedBy })
      .where(eq(itemRequests.id, requestId))
      .returning();

    res.json({ success: true, request: updated });
  });

  // Create delivery arrangement
  app.post("/api/requests/:requestId/delivery", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);
    const { deliveryType, deliveryAddress, deliveryDate, securityDeposit } =
      req.body;

    // Calculate delivery fee for courier service (Uber Direct = $15)
    const deliveryFee = deliveryType === "IN_APP_SERVICE" || deliveryType === "courier" ? "15.00" : "0.00";

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

    // Validate feedback tags
    const validTags = ["reliable", "on_time", "as_described"];
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

    // Calculate reputation points based on rating
    const reputationPoints = Math.max(rating - 3, 0) * 10; // 0 points for 3 stars or less, 10 for 4 stars, 20 for 5 stars

    // Record reputation activity if positive points
    if (reputationPoints > 0) {
      await db.insert(reputationActivities).values({
        userId: reviewedUserId,
        activityType: "RECEIVE_REVIEW",
        points: reputationPoints,
        itemId: transaction.items.id,
        description: `Received a ${rating}-star review`,
      });

      // Update user's reputation score
      await db
        .update(users)
        .set({
          reputationScore: sql`reputation_score + ${reputationPoints}`,
          reputationLevel: sql`CASE 
            WHEN reputation_score + ${reputationPoints} >= 500 THEN 'Expert'
            WHEN reputation_score + ${reputationPoints} >= 200 THEN 'Trusted'
            WHEN reputation_score + ${reputationPoints} >= 50 THEN 'Regular'
            ELSE 'Newcomer'
          END`,
        })
        .where(eq(users.id, reviewedUserId));
    }

    // Award trust points for positive feedback tags (+12 each for reliable/on_time/as_described)
    if (cleanedTags.length > 0) {
      try {
        await awardFeedbackPoints(
          reviewedUserId,
          transactionId,
          cleanedTags as ("reliable" | "on_time" | "as_described")[]
        );
        console.log(`✅ Awarded trust points for feedback tags: ${cleanedTags.join(", ")}`);
      } catch (trustError) {
        console.error("Error awarding feedback trust points:", trustError);
      }
    }

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

    res.json({
      ...user,
      averageRating: Math.round(averageRating * 10) / 10,
      reviewCount,
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

  // Improve WebSocket message handling
  const connectedClients = new Map<number, WebSocket>();

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

        // Handle new message
        if (data.type === "new_message") {
          const { receiverId, content } = data.payload;

          // Store message in database
          const [storedMessage] = await db
            .insert(messages)
            .values({
              content,
              senderId: userId,
              receiverId,
            })
            .returning();

          // Send to receiver if online
          const receiverWs = connectedClients.get(receiverId);
          if (receiverWs?.readyState === WebSocket.OPEN) {
            receiverWs.send(
              JSON.stringify({
                type: "new_message",
                message: storedMessage,
              }),
            );
          }
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