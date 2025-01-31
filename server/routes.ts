import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { verifications, messages } from "@db/schema";
import { eq, and, or } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { log } from "./vite";

export function registerRoutes(app: Express): Server {
  setupAuth(app);

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