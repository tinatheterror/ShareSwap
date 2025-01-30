import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { verifications } from "@db/schema";
import { eq } from "drizzle-orm";

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

  const httpServer = createServer(app);
  return httpServer;
}
