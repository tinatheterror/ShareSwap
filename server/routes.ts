import type { Express } from "express";
import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { setupAuth } from "./auth";
import { db, pool } from "@db";
import {
  verifications,
  messages,
  items,
  users,
  shareCoinsTransactions,
  notifications,
} from "@db/schema";
import { eq, and, or, desc, sql, gte, ne } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { log } from "./vite";
import multer from "multer";
import path from "path";
import * as express from "express";
import { itemConditionVerifications } from "@db/schema";
import { sponsoredGames, gameSessions } from "@db/schema";
import { communityChallenges, challengeParticipants } from "@db/schema";
import { itemRequests, deliveryArrangements } from "@db/schema";
import { reputationActivities, userReviews } from "@db/schema";
import { locationAlerts, swapMatches, swapCooldowns, farmingDetections, rentalReturns, platformCommissions, wishlists } from "@db/schema";
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
import { calculateReplacementValue } from "./replacement-value";

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

// Initialize Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing required Stripe secret: STRIPE_SECRET_KEY');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-07-30.basil",
});

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

// Security: Configure multer for secure file uploads
const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: function (req, file, cb) {
    // Sanitize filename to prevent directory traversal attacks
    const sanitizedOriginalName = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, '_');
    const randomPrefix = randomBytes(16).toString('hex');
    cb(null, `${randomPrefix}-${Date.now()}${path.extname(sanitizedOriginalName)}`);
  },
});

// Security: File upload validation and limits
const upload = multer({
  storage: storage,
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
      .orderBy(verifications.createdAt)
      .limit(1);

    res.json(verification || { status: "not_submitted" });
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
      // 1. Set isVerified = true and verifiedAt timestamp
      // 2. Boost trust/reputation score significantly (+50 points)
      const VERIFICATION_TRUST_BOOST = 50;
      
      await db
        .update(users)
        .set({
          isVerified: true,
          verifiedAt: new Date(),
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
                text: `You are an expert at identifying and analyzing items from photos for a peer-to-peer sharing marketplace. Analyze these images and extract the following information in JSON format:

{
  "name": "Short, descriptive name of the item (max 50 chars)",
  "description": "Detailed description including notable features, condition details, and any visible wear or damage (100-300 chars)",
  "category": "One of: Electronics, Tools, Sports, Home & Garden, Books & Media, Clothing, Toys & Games, Kitchen, Outdoor, Other",
  "brand": "Brand name if visible, otherwise 'Unknown'",
  "conditionRating": "Integer 1-5 where 1=Poor, 2=Fair, 3=Good, 4=Very Good, 5=Excellent",
  ${user.isPremium ? '"estimatedValue": "Estimated market value in USD (just the number, e.g., \'25.00\')",' : ''}
  "confidence": "Float 0-1 indicating how confident you are in this analysis"
}

Be specific and honest about condition. Look for signs of wear, damage, or quality issues.`,
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
          conditionRating: Math.min(5, Math.max(1, parseInt(analysisData.conditionRating) || 3)),
          estimatedValue: user.isPremium && analysisData.estimatedValue ? analysisData.estimatedValue : null,
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

      // Call GPT to extract listing details
      const completion = await openai.chat.completions.create({
        model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
        messages: [
          {
            role: "system",
            content: "You are an expert at extracting structured data from marketplace listings (Facebook Marketplace, Craigslist, Facebook Groups, etc.). Extract item details and return valid JSON only.",
          },
          {
            role: "user",
            content: `Extract item listing details from this marketplace URL and content. Return ONLY valid JSON with this exact structure:

{
  "name": "Item name (max 60 chars)",
  "description": "Detailed description of the item",
  "price": "Price as a number (no currency symbol), or null if not found",
  "conditionRating": "Integer 1-10 rating based on description, default 8 if unclear"
}

URL: ${url}
${pageContent ? `\nPage Content:\n${pageContent}` : '\nNote: Could not fetch page content. Extract what you can from the URL.'}

Return only the JSON object, no other text.`,
          },
        ],
        max_completion_tokens: 500,
        response_format: { type: "json_object" },
      });

      // Parse AI response with validation
      const aiResponse = completion.choices[0]?.message?.content;
      if (!aiResponse) {
        return res.status(500).json({ 
          error: "AI analysis failed. Please try again or enter details manually." 
        });
      }

      let listingData;
      try {
        listingData = JSON.parse(aiResponse);
      } catch (parseError) {
        console.error("Failed to parse AI response:", aiResponse);
        return res.status(500).json({ 
          error: "Could not extract listing details. Please enter details manually." 
        });
      }

      // Validate extracted data
      if (!listingData.name || listingData.name.trim().length === 0) {
        return res.status(400).json({ 
          error: "Could not extract item name from listing. Please verify the URL is correct." 
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

      // Calculate tier from originalValue and condition (same logic as frontend)
      let baseTier = 1;
      if (originalValue === "Under $50") baseTier = 1;
      else if (originalValue === "$50–$150") baseTier = 2;
      else if (originalValue === "$150–$300") baseTier = 3;
      else if (originalValue === "$300+") baseTier = 4;

      // Apply condition modifier
      if (condition === "Fair" || condition === "Well Loved") {
        baseTier = Math.max(1, baseTier - 1);
      }

      const tier = baseTier;

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
      
      res.json({
        tier,
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
  app.post("/api/items", upload.array("photos"), async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

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
        // Use SmartScan photos (already uploaded)
        photoUrls = JSON.parse(req.body.smartScanPhotos);
      } else {
        // Use manually uploaded photos
        const files = req.files as Express.Multer.File[];
        photoUrls = files ? files.map((file) => `/uploads/${file.filename}`) : [];
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

    // Parse tier from request
    const tier = req.body.tier ? parseInt(req.body.tier) : null;
    
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

    // Calculate replacement value for borrowable items (locked at listing time)
    const replacementValue = isLendable ? calculateReplacementValue(tier) : null;

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
      securityDeposit: req.body.securityDeposit || "0",
      lendingDuration: parseInt(req.body.lendingDuration || "0") || 0,
      shareCoinsReward: shareCoinsReward.toString(),
      estimatedValue: req.body.estimatedValue || null,
      replacementValue: replacementValue,
      isAvailable: true,
      isConditionVerified: false,
      wasSmartScanned: wasSmartScanned,
      ownerId: req.user.id,
    };

    // First insert the item
    const [item] = await db.insert(items).values(itemData).returning();

    // Build transaction description
    let transactionDescription = `Earned for listing ${item.name}`;
    if (aiValuationResult) {
      const tierBand = aiValuationResult.tierBand;
      transactionDescription += ` (AI-valued at ${shareCoinsReward} ShareCoins/week in Tier ${tier} band: ${tierBand.min}-${tierBand.max})`;
    } else {
      transactionDescription += ` (${[
        isLendable && "Lending",
        isSwappable && "Swapping",
        isRentable && "Renting",
        isGift && "Gifting",
      ]
        .filter(Boolean)
        .join(", ")})`;
    }

    // Record the ShareCoins transaction
    await db.insert(shareCoinsTransactions).values({
      userId: req.user.id,
      amount: shareCoinsReward.toString(),
      description: transactionDescription,
      transactionType: "EARNED",
    });

    // Update user's ShareCoins
    await db
      .update(users)
      .set({
        shareCoins: sql`share_coins + ${shareCoinsReward}`,
      })
      .where(eq(users.id, req.user.id));

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
  app.patch("/api/items/:id", upload.array("photos"), async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

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
        // New photos uploaded
        photoUrls = files.map((file) => `/uploads/${file.filename}`);
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
        securityDeposit: req.body.securityDeposit || existingItem.securityDeposit,
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
  app.delete("/api/items/:id", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

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
          maxShareCoinPrice: wishlists.maxShareCoinPrice,
          maxDollarPrice: wishlists.maxDollarPrice,
          preferredLocation: wishlists.preferredLocation,
          urgency: wishlists.urgency,
          isActive: wishlists.isActive,
          createdAt: wishlists.createdAt,
          username: users.username,
          isVerified: users.isVerified,
          reputationLevel: users.reputationLevel,
        })
        .from(wishlists)
        .innerJoin(users, eq(users.id, wishlists.userId))
        .where(eq(wishlists.isActive, true))
        .orderBy(desc(wishlists.createdAt));

      // For urgent wishlists, highlight verified users
      const wishlistsWithHighlight = allWishlists.map(w => ({
        ...w,
        // Verified users are highlighted in urgent wishlists
        highlightVerified: (w.urgency === 'urgent' || w.urgency === 'high') && w.isVerified,
      }));

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
  app.post("/api/wishlists", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { itemName, description, category, maxShareCoinPrice, maxDollarPrice, preferredLocation, urgency } = req.body;

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
          maxShareCoinPrice,
          maxDollarPrice,
          preferredLocation,
          urgency: urgency || 'normal',
        })
        .returning();

      res.status(201).json(newWishlist);
    } catch (error) {
      console.error("Error creating wishlist:", error);
      res.status(500).json({ error: "Failed to create wishlist item" });
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
  app.post("/api/delivery-arrangements", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const {
        itemId,
        deliveryMethod,
        depositMethod,
        scheduledDate,
        scheduledTime,
        returnDate,
        pickupLocation,
        deliveryAddress,
        deliveryService,
        specialInstructions,
        suggestedDepositAmount,
        riskAccepted
      } = req.body;

      if (!itemId || !deliveryMethod || !depositMethod || !scheduledDate || !scheduledTime) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Validate item exists and user can access it
      const [item] = await db
        .select()
        .from(items)
        .where(eq(items.id, itemId))
        .limit(1);

      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }

      // Generate QR code data for handover verification
      const qrCodeData = JSON.stringify({
        itemId,
        itemName: item.name,
        deliveryMethod,
        scheduledDate,
        scheduledTime,
        deliveryAddress: deliveryMethod === 'pickup' ? pickupLocation : deliveryAddress,
        timestamp: new Date().toISOString(),
        verificationCode: Math.random().toString(36).substring(2, 15)
      });

      const deliveryFee = deliveryMethod === 'delivery' ? 
        (deliveryService === 'uber' ? '15.00' : 
         deliveryService === 'doordash' ? '12.00' : 
         deliveryService === 'postmates' ? '18.00' : 
         deliveryService === 'local_courier' ? '25.00' : '0.00') : '0.00';

      const [arrangement] = await db
        .insert(deliveryArrangements)
        .values({
          deliveryType: deliveryMethod,
          deliveryFee,
          deliveryAddress: deliveryMethod === 'pickup' ? pickupLocation : deliveryAddress,
          deliveryDate: new Date(`${scheduledDate}T${scheduledTime}`),
          returnDate: returnDate ? new Date(`${returnDate}T23:59:59`) : null,
          securityDeposit: suggestedDepositAmount.toString(),
          specialInstructions,
          qrCodeData,
          riskAccepted: deliveryMethod === 'self_delivery' ? riskAccepted : false,
          status: 'pending',
        })
        .returning();

      res.status(201).json(arrangement);
    } catch (error) {
      console.error("Error creating delivery arrangement:", error);
      res.status(500).json({ error: "Failed to create delivery arrangement" });
    }
  });

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
        ownerId: items.ownerId,
        createdAt: items.createdAt,
        owner: {
          id: users.id,
          username: users.username,
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
  app.post("/api/messages", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

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

  // Get all conversations for the current user
  app.get("/api/conversations", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    // Get all messages involving the current user
    const allMessages = await db
      .select()
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
        // Count unread messages from this partner
        const unread = allMessages.filter(
          m => m.senderId === partnerId && m.receiverId === req.user.id
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
  app.post("/api/items/:itemId/request", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const itemId = parseInt(req.params.itemId);
    const { requestType, message, startDate, endDate, deliveryMethod } = req.body;

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
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    // Create notification for item owner
    if (item.ownerId) {
      await db.insert(notifications).values({
        userId: item.ownerId,
        type: "item_request",
        title: "New Item Request",
        message: `${requester?.username || "Someone"} wants to ${requestType.toLowerCase()} your ${item.name}`,
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

    const requests = await db
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
        deliveryConfirmed: itemRequests.deliveryConfirmed,
        deliveryConfirmedAt: itemRequests.deliveryConfirmedAt,
        courierBookedBy: itemRequests.courierBookedBy,
        courierIssue: itemRequests.courierIssue,
        courierIssueNote: itemRequests.courierIssueNote,
        item: {
          id: items.id,
          name: items.name,
          description: items.description,
          photos: items.photos,
          estimatedValue: items.estimatedValue,
          ownerId: items.ownerId,
        },
        requester: {
          id: users.id,
          username: users.username,
        },
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

    res.json(requests);
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
        } else {
          console.log(`🚫 ShareCoins not awarded due to farming detection (${farmingDetection.riskLevel})`);
        }
        
      } catch (error) {
        console.error("Error in swap processing with anti-farming:", error);
        // Don't fail the request acceptance if anti-farming processing fails
      }
    }

    // Award ShareCoins for accepted gift requests (gifter gets rewarded for generosity)
    if (status === "ACCEPTED" && request.item_requests.requestType === "GIFT") {
      try {
        // Award ShareCoins to the gifter (owner) for their generosity
        const gifterResult = await awardShareCoinsWithFirstTimeBonus(
          req.user.id,
          'GIFT',
          request.items.name,
          1
        );
        
        console.log(`✅ Awarded ShareCoins for gift: Gifter=${gifterResult.totalAwarded} (first-time: ${gifterResult.isFirstTime})`);
        
        // Award trust points for gifting (+6 to giver)
        try {
          await awardGiftingPoints(
            req.user.id,
            request.item_requests.requesterId,
            requestId,
            request.items.id
          );
          console.log(`✅ Awarded trust points for gifting`);
        } catch (trustError) {
          console.error("Error awarding gifting trust points:", trustError);
        }
      } catch (error) {
        console.error("Error processing gift reward:", error);
      }
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
      const { confirmedBy } = req.body; // 'owner' or 'requester'
      
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

      // Validate status (must be DEPOSIT_CONFIRMED or COURIER_PENDING for courier deliveries)
      const validStatuses = ["DEPOSIT_CONFIRMED", "COURIER_PENDING"];
      if (!validStatuses.includes(request.item_requests.status)) {
        return res.status(400).json({ error: "Request is not ready for handoff" });
      }

      // Charge ShareCoins from borrower
      const shareCoinAmount = parseFloat(request.item_requests.shareCoinAmount || request.items.shareCoinPrice || "0");
      
      if (shareCoinAmount > 0 && request.item_requests.requestType === "BORROW") {
        // Get borrower's current ShareCoin balance
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

      // Update request status
      const [updated] = await db
        .update(itemRequests)
        .set({
          status: "IN_PROGRESS",
          handoffConfirmedAt: new Date(),
          borrowPeriodStartedAt: new Date(),
          shareCoinsCharged: true,
          shareCoinsChargedAt: new Date(),
          depositStatus: "held",
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      // Mark item as unavailable
      await db
        .update(items)
        .set({ isAvailable: false })
        .where(eq(items.id, request.items.id));

      res.json({
        success: true,
        request: updated,
        shareCoinsCharged: shareCoinAmount,
        message: "Handoff confirmed! Borrow period has started.",
      });
    } catch (error: any) {
      console.error("Error confirming handoff:", error);
      res.status(500).json({ error: "Failed to confirm handoff" });
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

      const [updated] = await db
        .update(itemRequests)
        .set({
          status: "RETURN_REQUESTED",
          returnRequestedAt: new Date(),
        })
        .where(eq(itemRequests.id, requestId))
        .returning();

      res.json({
        success: true,
        request: updated,
        message: "Return initiated. Waiting for lender confirmation.",
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
      const { conditionRating, conditionNotes } = req.body;
      
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

      // Release the deposit via Stripe
      if (request.item_requests.depositPaymentIntentId) {
        try {
          await stripe.paymentIntents.cancel(request.item_requests.depositPaymentIntentId);
        } catch (stripeError: any) {
          console.error("Error releasing deposit:", stripeError);
          // Continue even if Stripe fails - we don't want to block the return
        }
      }

      // Update request to completed
      const [updated] = await db
        .update(itemRequests)
        .set({
          status: "COMPLETED",
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

      res.json({
        success: true,
        request: updated,
        depositReleased: true,
        message: "Return confirmed! Deposit has been released.",
      });
    } catch (error: any) {
      console.error("Error confirming return:", error);
      res.status(500).json({ error: "Failed to confirm return" });
    }
  });

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
  app.post("/api/users/:userId/reviews", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

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
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        isVerified: users.isVerified,
        reputationScore: users.reputationScore,
        reputationLevel: users.reputationLevel,
        isPremium: users.isPremium,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

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
    
    // First find the user
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

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
    
    // First find the user
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

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

  setupAuth(app);
  
  // Add simplified routes for new features
  addSimplifiedRoutes(app);

  return httpServer;
}