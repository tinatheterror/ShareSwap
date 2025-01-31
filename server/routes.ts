import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { verifications, messages, items, users, shareCoinsTransactions } from "@db/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { log } from "./vite";
import multer from "multer";
import path from "path";
import * as express from 'express';
import { itemConditionVerifications } from "@db/schema";
import { sponsoredGames, gameSessions } from "@db/schema";
import { communityChallenges, challengeParticipants } from "@db/schema";
import { itemRequests, deliveryArrangements } from "@db/schema";
import { reputationActivities, userReviews } from "@db/schema";

// Configure multer for handling file uploads
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Serve uploaded files
  app.use('/uploads', express.static('uploads'));

  app.post("/api/verify", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

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

  // Item endpoints
  app.post("/api/items", upload.array('photos'), async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const files = req.files as Express.Multer.File[];
    const photoUrls = files ? files.map(file => `/uploads/${file.filename}`) : [];

    // Parse boolean flags
    const isLendable = req.body.isLendable === 'true';
    const isSwappable = req.body.isSwappable === 'true';
    const isRentable = req.body.isRentable === 'true';

    // Calculate ShareCoins reward based on sharing modes
    let shareCoinsReward = 0;

    // Base reward for listing an item
    const baseReward = 5;
    shareCoinsReward += baseReward;

    // Additional rewards based on sharing modes
    if (isLendable) {
      const securityDeposit = parseFloat(req.body.securityDeposit || "0");
      const lendingDuration = parseInt(req.body.lendingDuration || "0");

      // Calculate lending reward: 1% of security deposit per day
      const lendingReward = Math.max(
        10, // Minimum lending reward
        Math.floor((securityDeposit * lendingDuration * 0.01)) // 1% per day
      );
      shareCoinsReward += lendingReward;
    }

    if (isSwappable) {
      // Fixed reward for making item available for swaps
      shareCoinsReward += 20;
    }

    if (isRentable) {
      const securityDeposit = parseFloat(req.body.securityDeposit || "0");
      // Base rental reward plus 5% of security deposit
      const rentalReward = 25 + Math.floor(securityDeposit * 0.05);
      shareCoinsReward += rentalReward;
    }

    // First insert the item
    const [item] = await db
      .insert(items)
      .values({
        ownerId: req.user.id,
        name: req.body.name,
        description: req.body.description,
        conditionRating: parseInt(req.body.conditionRating),
        photos: photoUrls,
        isLendable: isLendable,
        isSwappable: isSwappable,
        isRentable: isRentable,
        securityDeposit: req.body.securityDeposit || null,
        lendingDuration: req.body.lendingDuration || null,
        shareCoinsReward: shareCoinsReward.toString(),
        isAvailable: true,
        isConditionVerified: false
      })
      .returning();

    // Record the ShareCoins transaction
    await db
      .insert(shareCoinsTransactions)
      .values({
        userId: req.user.id,
        amount: shareCoinsReward.toString(),
        description: `Earned for listing ${item.name} (${
          [
            isLendable && 'Lending',
            isSwappable && 'Swapping',
            isRentable && 'Renting'
          ].filter(Boolean).join(', ')
        })`,
        transactionType: "EARNED"
      });

    // Update user's ShareCoins
    await db
      .update(users)
      .set({
        shareCoins: sql`share_coins + ${shareCoinsReward}`,
      })
      .where(eq(users.id, req.user.id));

    res.status(201).json({
      ...item,
      shareCoinsReward,
    });
  });

  app.get("/api/items", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const availableItems = await db
      .select()
      .from(items)
      .where(eq(items.isAvailable, true));

    res.json(availableItems);
  });

  // Add GET route for single item
  app.get("/api/items/:id", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const itemId = parseInt(req.params.id);
    const [item] = await db
      .select()
      .from(items)
      .where(eq(items.id, itemId))
      .limit(1);

    if (!item) {
      return res.status(404).send("Item not found");
    }

    res.json(item);
  });


  // Item condition verification endpoints
  app.post("/api/items/:itemId/verify-condition", upload.array('photos'), async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    // TODO: Add admin check here
    const itemId = parseInt(req.params.itemId);
    const files = req.files as Express.Multer.File[];
    const photoUrls = files ? files.map(file => `/uploads/${file.filename}`) : [];

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

    if (req.body.status === 'approved') {
      await db
        .update(items)
        .set({
          isConditionVerified: true,
          conditionRating: parseInt(req.body.actualConditionRating),
        })
        .where(eq(items.id, itemId));
    }

    res.status(201).json(verification);
  });

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
            eq(messages.receiverId, parseInt(req.params.userId))
          ),
          and(
            eq(messages.senderId, parseInt(req.params.userId)),
            eq(messages.receiverId, req.user.id)
          )
        )
      )
      .orderBy(messages.createdAt);

    res.json(chatMessages);
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
    await db
      .insert(shareCoinsTransactions)
      .values({
        userId: req.user.id,
        amount: amount.toString(),
        description: `Earned from playing ${gameType} game`,
        transactionType: "EARNED"
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
    await db
      .insert(shareCoinsTransactions)
      .values({
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
      .where(and(
        eq(communityChallenges.id, challengeId),
        eq(communityChallenges.status, "active")
      ))
      .limit(1);

    if (!challenge) {
      return res.status(404).send("Challenge not found or not active");
    }

    // Check if user is already participating
    const [existing] = await db
      .select()
      .from(challengeParticipants)
      .where(and(
        eq(challengeParticipants.challengeId, challengeId),
        eq(challengeParticipants.userId, req.user.id)
      ))
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
    const { requestType, message } = req.body;

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
            and(eq(items.isSwappable, true), eq(requestType, "SWAP"))
          )
        )
      )
      .limit(1);

    if (!item) {
      return res.status(404).send("Item not found or not available for this type of request");
    }

    // Create the request
    const [request] = await db
      .insert(itemRequests)
      .values({
        itemId,
        requesterId: req.user.id,
        requestType,
        message,
        status: "PENDING",
      })
      .returning();

    res.status(201).json(request);
  });

  // Get item requests for a user (both as requester and owner)
  app.get("/api/requests", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requests = await db
      .select({
        request: itemRequests,
        item: {
          id: items.id,
          name: items.name,
          photos: items.photos,
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
          eq(itemRequests.requesterId, req.user.id)
        )
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
        and(
          eq(itemRequests.id, requestId),
          eq(items.ownerId, req.user.id)
        )
      )
      .limit(1);

    if (!request) {
      return res.status(404).send("Request not found");
    }

    const [updatedRequest] = await db
      .update(itemRequests)
      .set({ status })
      .where(eq(itemRequests.id, requestId))
      .returning();

    res.json(updatedRequest);
  });

  // Create delivery arrangement
  app.post("/api/requests/:requestId/delivery", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    const requestId = parseInt(req.params.requestId);
    const {
      deliveryType,
      deliveryAddress,
      deliveryDate,
      securityDeposit,
    } = req.body;

    // Calculate delivery fee for in-app service
    const deliveryFee = deliveryType === "IN_APP_SERVICE" ? "10.00" : "0.00";

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
    const { rating, comment, transactionId } = req.body;

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
              eq(items.ownerId, reviewedUserId)
            ),
            and(
              eq(itemRequests.requesterId, reviewedUserId),
              eq(items.ownerId, req.user.id)
            )
          )
        )
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
          eq(userReviews.transactionId, transactionId)
        )
      )
      .limit(1);

    if (existingReview) {
      return res.status(400).send("You have already reviewed this transaction");
    }

    // Create the review
    const [review] = await db
      .insert(userReviews)
      .values({
        reviewerId: req.user.id,
        reviewedUserId,
        rating,
        comment,
        transactionId,
      })
      .returning();

    // Calculate reputation points based on rating
    const reputationPoints = Math.max(rating - 3, 0) * 10; // 0 points for 3 stars or less, 10 for 4 stars, 20 for 5 stars

    // Record reputation activity if positive points
    if (reputationPoints > 0) {
      await db
        .insert(reputationActivities)
        .values({
          userId: reviewedUserId,
          activityType: "RECEIVE_REVIEW",
          points: reputationPoints,
          itemId: transaction.itemId,
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

    res.status(201).json(review);
  });

  const httpServer = createServer(app);

  // Set up WebSocket server for real-time chat
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws/chat",
    // Allow both secure and non-secure connections
    perMessageDeflate: true,
  });

  wss.on("connection", (ws: WebSocket) => {
    log("New WebSocket connection established");

    ws.on("message", (message: string) => {
      try {
        // Broadcast the message to all connected clients
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      } catch (error) {
        console.error("Error broadcasting message:", error);
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    // Handle client disconnection
    ws.on("close", () => {
      log("Client disconnected from chat");
    });
  });

  return httpServer;
}