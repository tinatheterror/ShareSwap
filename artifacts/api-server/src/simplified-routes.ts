// Simple API routes for new features that work with current database structure
import type { Express } from "express";
import { db } from "@workspace/db";
import { users, achievements, userAchievements, wishlists } from "@workspace/db";
import { eq, and, ne, desc } from "drizzle-orm";

const BADGE_TITLE_MAP: Record<string, string> = {
  five_transactions: "Community Sharer",
  ten_transactions: "Power Sharer",
  first_lend: "First Lend",
  five_lends: "Generous Lender",
  first_gift: "Gift Giver",
  three_gifts: "Generous Gifter",
  first_swap: "Swap Starter",
  verified_member: "Verified Member",
  five_swaps: "Swap Champion",
  ten_gifts: "Generous Soul",
  five_borrows: "Active Borrower",
  five_listed: "ShareChest Curator",
  five_reviews_left: "Community Voice",
  referral_5: "Neighbour Connector",
  fast_responder: "Fast Responder",
  five_star_neighbour: "Five-Star Neighbour",
  early_member: "Early Member",
  three_in_week: "Weekly Warrior",
  five_reviews_received: "Highly Rated",
  first_borrow: "First Borrow",
  reliable_borrower: "Reliable Borrower",
  trusted_exchanger: "Trusted Exchanger",
  super_lender: "Super Lender",
  rising_star: "Rising Star",
  exchange_veteran: "Exchange Veteran",
  urgent_helper: "Urgent Helper",
  well_loved: "Well Loved",
  neighbourhood_hero: "Neighbourhood Hero",
  shareswap_legend: "ShareSwap Legend",
  courier_rider: "Courier Rider",
  community_builder: "Community Builder",
  shareswap_ambassador: "ShareSwap Ambassador",
  coin_collector: "Coin Collector",
  power_lister: "Power Lister",
  wish_maker: "Wish Maker",
  good_neighbour: "Good Neighbour",
  photo_pro: "Photo Pro",
  welcome_wagon: "Welcome Wagon",
};

function badgeTitle(rawName: string): string {
  return BADGE_TITLE_MAP[rawName] ??
    rawName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function addSimplifiedRoutes(app: Express) {
  // Real achievements route
  app.get("/api/achievements", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }
    try {
      const userId = (req.user as any).id;

      const [userRow] = await db
        .select({ reputationScore: users.reputationScore, reputationLevel: users.reputationLevel })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const score = userRow?.reputationScore ?? 0;
      const level = userRow?.reputationLevel ?? "Newcomer";

      const LEVEL_THRESHOLDS = [
        { name: "Newcomer", minScore: 0 },
        { name: "Neighbour", minScore: 50 },
        { name: "Trusted Member", minScore: 150 },
        { name: "Community Pillar", minScore: 300 },
        { name: "ShareSwap Champion", minScore: 500 },
      ];
      const nextLevel = LEVEL_THRESHOLDS.find((l) => l.minScore > score);
      const nextLevelScore = nextLevel ? nextLevel.minScore : undefined;

      const allAchievements = await db
        .select({
          id: achievements.id,
          name: achievements.name,
          description: achievements.description,
          badgeIcon: achievements.badgeIcon,
          category: achievements.category,
        })
        .from(achievements);

      const earnedRows = await db
        .select({ achievementId: userAchievements.achievementId, earnedAt: userAchievements.earnedAt })
        .from(userAchievements)
        .where(and(eq(userAchievements.userId, userId), eq(userAchievements.isCompleted, true)));

      const earnedMap = new Map(earnedRows.map((r) => [r.achievementId, r.earnedAt]));

      const badges = allAchievements.map((a) => ({
        id: a.id,
        title: badgeTitle(a.name),
        description: a.description,
        badgeIcon: a.badgeIcon,
        category: a.category ?? undefined,
        earned: earnedMap.has(a.id),
        earnedAt: earnedMap.get(a.id) ?? undefined,
      }));

      res.json({ score, level, nextLevelScore, badges });
    } catch (error) {
      console.error("Error fetching achievements:", error);
      res.status(500).json({ error: "Failed to fetch achievements" });
    }
  });

  // User achievements route
  app.get("/api/user-achievements", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Mock user achievements - return empty for now
      res.json([]);
    } catch (error) {
      console.error("Error fetching user achievements:", error);
      res.status(500).json({ error: "Failed to fetch user achievements" });
    }
  });

  // Basic wishlists route
  app.get("/api/wishlists", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Helper function to check if wishlist is expired
      const isWishlistExpired = (wishlist: any) => {
        if (!wishlist.neededDate) return false;
        const neededDate = new Date(wishlist.neededDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return neededDate < today;
      };

      // Mock user wishlist data - includes some expired items for demonstration
      const rawWishlists = [
        {
          id: 101,
          userId: req.user.id,
          itemName: "Professional Camera",
          description: "Need for a wedding photography event",
          category: "electronics",
          needType: "borrow",
          preferredLocation: "Downtown area",
          urgency: "high",
          neededDate: "2025-08-03", // Past date - expired
          returnDate: "2025-08-05",
          isActive: true,
          createdAt: "2025-07-28T00:00:00.000Z"
        },
        {
          id: 102,
          userId: req.user.id,
          itemName: "Hiking Boots",
          description: "Size 10, needed for weekend camping trip",
          category: "outdoor",
          needType: "borrow",
          preferredLocation: "North side",
          urgency: "normal",
          neededDate: "2025-08-10", // Future date - active
          returnDate: "2025-08-12",
          isActive: true,
          createdAt: "2025-08-01T00:00:00.000Z"
        },
        {
          id: 103,
          userId: req.user.id,
          itemName: "Lawn Mower",
          description: "Spring cleaning project completed",
          category: "garden",
          needType: "borrow",
          preferredLocation: "Suburban area",
          urgency: "low",
          neededDate: "2025-08-01", // Past date - expired
          returnDate: "2025-08-02",
          isActive: true,
          createdAt: "2025-07-25T00:00:00.000Z"
        }
      ];

      // Process wishlists to mark expired ones
      const wishlists = rawWishlists.map(wishlist => {
        const expired = isWishlistExpired(wishlist);
        return {
          ...wishlist,
          isExpired: expired,
          expirationReason: expired ?
            `Needed date ${new Date(wishlist.neededDate).toLocaleDateString()} has passed` :
            undefined
        };
      });

      res.json(wishlists);
    } catch (error) {
      console.error("Error fetching wishlists:", error);
      res.status(500).json({ error: "Failed to fetch wishlists" });
    }
  });

  // All wishlists for fulfillment popup
  app.get("/api/all-wishlists", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
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
          isPrivate: wishlists.isPrivate,
          createdAt: wishlists.createdAt,
          username: users.username,
          displayName: users.displayName,
          isVerified: users.isVerified,
        })
        .from(wishlists)
        .innerJoin(users, eq(users.id, wishlists.userId))
        .where(and(eq(wishlists.isActive, true), ne(wishlists.userId, (req.user as any).id)))
        .orderBy(desc(wishlists.createdAt));

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const result = allWishlists.map(w => {
        let isExpired = false;
        if (w.returnDate) {
          isExpired = new Date(w.returnDate) < today;
        } else if (w.neededDate) {
          isExpired = new Date(w.neededDate) < today;
        }
        return { ...w, isExpired };
      });

      // Sort: urgent first (by urgency field), then verified, then date
      const urgencyOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
      result.sort((a, b) => {
        const aU = urgencyOrder[a.urgency ?? 'normal'] ?? 2;
        const bU = urgencyOrder[b.urgency ?? 'normal'] ?? 2;
        if (aU !== bU) return aU - bU;
        if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
        return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime();
      });

      res.json(result);
    } catch (error) {
      console.error("Error fetching all wishlists:", error);
      res.status(500).json({ error: "Failed to fetch wishlists" });
    }
  });

  // User profile endpoint
  app.get("/api/user-profile", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Mock user profile data
      const profile = {
        id: req.user.id,
        username: req.user.username,
        email: `${req.user.username}@example.com`,
        fullName: req.user.username === "harrisonma" ? "Harrison Ma" : `${req.user.username.charAt(0).toUpperCase()}${req.user.username.slice(1)} User`,
        bio: "Passionate about sharing and connecting with my community through sustainable resource exchange.",
        location: "Downtown Toronto, ON",
        phone: "+1 (555) 123-4567",
        joinedDate: "2024-01-15T00:00:00.000Z",
        shareCoins: req.user.shareCoins || 0,
        itemsShared: 12,
        itemsBorrowed: 8,
        rating: 4.8,
        totalTransactions: 20,
        isVerified: true,
        subscription: "ShareSwap Premium"
      };

      res.json(profile);
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ error: "Failed to fetch user profile" });
    }
  });

  // Update user profile endpoint
  app.patch("/api/user-profile", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { fullName, bio, location, phone } = req.body;

      // Mock successful update
      const updatedProfile = {
        id: req.user.id,
        username: req.user.username,
        email: `${req.user.username}@example.com`,
        fullName: fullName || req.user.username,
        bio: bio || "",
        location: location || "",
        phone: phone || "",
        joinedDate: "2024-01-15T00:00:00.000Z",
        shareCoins: req.user.shareCoins || 0,
        itemsShared: 12,
        itemsBorrowed: 8,
        rating: 4.8,
        totalTransactions: 20,
        isVerified: true,
        subscription: "ShareSwap Premium"
      };

      res.json(updatedProfile);
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ error: "Failed to update user profile" });
    }
  });

  // Location alerts endpoint
  app.get("/api/location-alerts", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Mock location alerts data
      const alerts = [
        {
          id: 1,
          keyword: "power drill",
          location: "Within 5km",
          isActive: true
        },
        {
          id: 2,
          keyword: "camping gear",
          location: "Downtown area",
          isActive: true
        },
        {
          id: 3,
          keyword: "kitchen mixer",
          location: "North side",
          isActive: false
        }
      ];

      res.json(alerts);
    } catch (error) {
      console.error("Error fetching location alerts:", error);
      res.status(500).json({ error: "Failed to fetch location alerts" });
    }
  });

  app.post("/api/wishlists", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { itemName, description, category, needType, preferredLocation, urgency, neededDate, returnDate, isPrivate } = req.body;

      if (!itemName) {
        return res.status(400).json({ error: "Item name is required" });
      }

      // Mock successful creation
      const wishlist = {
        id: Date.now(),
        userId: req.user.id,
        itemName,
        description,
        category,
        needType: needType || 'borrow',
        preferredLocation,
        urgency: urgency || 'normal',
        neededDate,
        returnDate,
        isActive: true,
        isPrivate: isPrivate || false,
        createdAt: new Date().toISOString(),
      };

      res.status(201).json(wishlist);
    } catch (error) {
      console.error("Error creating wishlist:", error);
      res.status(500).json({ error: "Failed to create wishlist" });
    }
  });

  // Delete wishlist item
  app.delete("/api/wishlists/:id", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const wishlistId = parseInt(req.params.id);

      // In production, this would delete from the database
      // For now, we'll just return success
      res.json({ success: true, message: "Wishlist item deleted" });
    } catch (error) {
      console.error("Error deleting wishlist:", error);
      res.status(500).json({ error: "Failed to delete wishlist" });
    }
  });

  // Update wishlist item
  app.patch("/api/wishlists/:id", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const wishlistId = parseInt(req.params.id);
      const { itemName, description, preferredLocation, neededDate, returnDate } = req.body;

      // In production, this would update the database
      // For now, we'll return the updated data
      const updatedWishlist = {
        id: wishlistId,
        userId: req.user.id,
        itemName,
        description,
        preferredLocation,
        neededDate,
        returnDate,
        isActive: true,
        updatedAt: new Date().toISOString(),
      };

      res.json(updatedWishlist);
    } catch (error) {
      console.error("Error updating wishlist:", error);
      res.status(500).json({ error: "Failed to update wishlist" });
    }
  });

  // Subscription plans route
  app.get("/api/subscription-plans", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const plans = [
        {
          id: 1,
          name: "ShareSwap Premium",
          description: "Unlock priority access, lower fees, and exclusive features",
          monthlyPrice: "9.99",
          annualPrice: "99.99",
          features: [
            "Priority access to high-demand items",
            "50% reduction in transaction fees",
            "Early access to new features",
            "Premium customer support",
            "Advanced search filters",
            "Unlimited wishlist items",
            "Enhanced profile visibility"
          ],
          discountPercentage: 50,
          priorityAccess: true,
          lowerFees: true,
          isActive: true,
        },
        {
          id: 2,
          name: "ShareSwap Pro",
          description: "Perfect for active community members",
          monthlyPrice: "4.99",
          annualPrice: "49.99",
          features: [
            "25% reduction in transaction fees",
            "Advanced search filters",
            "Up to 20 wishlist items",
            "Priority customer support",
            "Extended borrowing periods"
          ],
          discountPercentage: 25,
          priorityAccess: false,
          lowerFees: true,
          isActive: true,
        }
      ];

      res.json(plans);
    } catch (error) {
      console.error("Error fetching subscription plans:", error);
      res.status(500).json({ error: "Failed to fetch subscription plans" });
    }
  });

  // User subscription route
  app.get("/api/user-subscription", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Return null for now (no active subscription)
      res.json(null);
    } catch (error) {
      console.error("Error fetching user subscription:", error);
      res.status(500).json({ error: "Failed to fetch subscription" });
    }
  });

  // Referral code generation
  app.post("/api/referrals/generate", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Generate unique referral code
      const referralCode = `SHARE${req.user.id}${Date.now().toString().slice(-6)}`;

      // Update user's referral code in database
      try {
        await db
          .update(users)
          .set({ referralCode })
          .where(eq(users.id, req.user.id));
      } catch (dbError) {
        // If the column doesn't exist yet, just return the generated code
        console.log("Referral code column not yet created, returning generated code");
      }

      res.json({ referralCode });
    } catch (error) {
      console.error("Error generating referral code:", error);
      res.status(500).json({ error: "Failed to generate referral code" });
    }
  });

  // Auto-match endpoint for connecting lenders and borrowers
  app.post("/api/auto-match", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { itemId, wishlistId, lenderUserId, borrowerUserId } = req.body;

      // Mock successful auto-match creation
      const autoMatch = {
        id: Date.now(),
        itemId,
        wishlistId,
        lenderUserId,
        borrowerUserId,
        status: "matched",
        matchedAt: new Date().toISOString(),
        shareCoinsEarned: Math.floor(Math.random() * 11) + 10, // 10-20 ShareCoins
      };

      // In a real app, this would:
      // 1. Create a match record in the database
      // 2. Update wishlist status to "fulfilled"
      // 3. Send notifications to both users
      // 4. Award ShareCoins to the lender
      // 5. Create a lending request/arrangement

      res.json(autoMatch);
    } catch (error) {
      console.error("Error creating auto-match:", error);
      res.status(500).json({ error: "Failed to create auto-match" });
    }
  });
}