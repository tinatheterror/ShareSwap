import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { verifications, messages, items, users, shareCoinsTransactions } from "@db/schema";
import { eq, and, or, sql, desc } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { log } from "./vite";
import multer from "multer";
import path from "path";
import * as express from 'express';
import { itemConditionVerifications } from "@db/schema";

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
        isLendable,
        isSwappable,
        isRentable,
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