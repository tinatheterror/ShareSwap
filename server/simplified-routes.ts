// Simple API routes for new features that work with current database structure
import type { Express } from "express";
import { db } from "@db";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";

export function addSimplifiedRoutes(app: Express) {
  // Basic achievements route
  app.get("/api/achievements", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      // Mock achievements data for now
      const achievements = [
        {
          id: 1,
          name: "First Lender",
          description: "Lend your first item to a neighbor",
          badgeIcon: "🤝",
          badgeColor: "#10b981",
          pointsRequired: 0,
          category: "milestone",
          isActive: true,
        },
        {
          id: 2,
          name: "Trusted Neighbor", 
          description: "Maintain a 4.5+ star rating with 10+ transactions",
          badgeIcon: "⭐",
          badgeColor: "#f59e0b",
          pointsRequired: 100,
          category: "social",
          isActive: true,
        },
        {
          id: 3,
          name: "Green Warrior",
          description: "Share 50+ items promoting sustainable living",
          badgeIcon: "🌱",
          badgeColor: "#059669",
          pointsRequired: 250,
          category: "lending",
          isActive: true,
        }
      ];

      res.json(achievements);
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
      // Generate dates relative to today for realistic mock data
      const today = new Date();
      const threeDaysLater = new Date(today);
      threeDaysLater.setDate(today.getDate() + 3);
      const fiveDaysLater = new Date(today);
      fiveDaysLater.setDate(today.getDate() + 5);
      const tenDaysLater = new Date(today);
      tenDaysLater.setDate(today.getDate() + 10);
      const fifteenDaysLater = new Date(today);
      fifteenDaysLater.setDate(today.getDate() + 15);

      // Mock sample wishlists from other users (no urgency field - calculated by frontend)
      const sampleWishlists = [
        {
          id: 1,
          userId: 2,
          itemName: "Power Drill",
          description: "Need a power drill for a quick home repair project",
          category: "tools",
          needType: "borrow",
          preferredLocation: "Downtown area",
          neededDate: fiveDaysLater.toISOString().split('T')[0],
          returnDate: new Date(fiveDaysLater.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          isActive: true,
          createdAt: new Date().toISOString(),
          username: "Sarah M.",
          distance: "0.8 miles away"
        },
        {
          id: 2,
          userId: 3,
          itemName: "Camping Tent",
          description: "Looking for a 4-person tent for weekend camping trip",
          category: "outdoor",
          needType: "rent",
          preferredLocation: "North side",
          neededDate: threeDaysLater.toISOString().split('T')[0],
          isActive: true,
          createdAt: new Date().toISOString(),
          username: "Mike R.",
          distance: "1.2 miles away"
        },
        {
          id: 3,
          userId: 4,
          itemName: "Stand Mixer",
          description: "Baking for a family event, need mixer for the weekend",
          category: "kitchen",
          needType: "borrow",
          preferredLocation: "Central area",
          neededDate: fiveDaysLater.toISOString().split('T')[0],
          returnDate: new Date(fiveDaysLater.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          isActive: true,
          createdAt: new Date().toISOString(),
          username: "Emma L.",
          distance: "0.5 miles away"
        },
        {
          id: 4,
          userId: 5,
          itemName: "Lawn Mower",
          description: "Spring cleaning - need to mow overgrown yard",
          category: "garden",
          needType: "borrow",
          preferredLocation: "Suburban area",
          neededDate: fifteenDaysLater.toISOString().split('T')[0],
          returnDate: new Date(fifteenDaysLater.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          isActive: true,
          createdAt: new Date().toISOString(),
          username: "David K.",
          distance: "2.1 miles away"
        }
      ];

      // Filter out current user's own wishlists
      const otherUsersWishlists = sampleWishlists.filter(w => w.userId !== req.user.id);
      
      res.json(otherUsersWishlists);
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
      const { itemName, description, category, needType, preferredLocation, urgency, neededDate, returnDate } = req.body;

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
        createdAt: new Date().toISOString(),
      };

      res.status(201).json(wishlist);
    } catch (error) {
      console.error("Error creating wishlist:", error);
      res.status(500).json({ error: "Failed to create wishlist" });
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