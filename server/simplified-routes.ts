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
      // Mock empty wishlists for now
      res.json([]);
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
      // Mock sample wishlists from other users
      const sampleWishlists = [
        {
          id: 1,
          userId: 2,
          itemName: "Power Drill",
          description: "Need a power drill for a quick home repair project",
          category: "tools",
          needType: "borrow",
          preferredLocation: "Downtown area",
          urgency: "high",
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
          urgency: "urgent",
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
          urgency: "high",
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
          urgency: "normal",
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

  app.post("/api/wishlists", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    try {
      const { itemName, description, category, needType, preferredLocation, urgency } = req.body;

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
}