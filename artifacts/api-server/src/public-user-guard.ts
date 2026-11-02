import type { NextFunction, Request, Response } from "express";
import { eq, or } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { accountIsPubliclyVisible, usersAreBlocked } from "./content-visibility";

// Mounted at /api/users. Every route that shows someone else's profile, reputation, listings, reviews or
// achievements answers 404 for an account that is banned, deactivated or deleted, instead of each handler
// remembering to. The same answer for anyone who has blocked, or been blocked by, the person asked about.
// People always see themselves.
const BY_ID = /^\/(\d+)\/(?:public-profile|reputation)$/;
const BY_USERNAME = /^\/username\/([^/]+)(?:\/(?:items|reviews|achievements))?$/;

export function publicUserGuard() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const byId = BY_ID.exec(req.path);
      const byUsername = byId ? null : BY_USERNAME.exec(req.path);
      if (!byId && !byUsername) return next();

      const [target] = byId
        ? await db.select({ id: users.id, accountStatus: users.accountStatus }).from(users).where(eq(users.id, Number(byId[1]))).limit(1)
        : await db
            .select({ id: users.id, accountStatus: users.accountStatus })
            .from(users)
            .where(or(eq(users.username, decodeURIComponent(byUsername![1])), eq(users.handle, decodeURIComponent(byUsername![1]))))
            .limit(1);

      // No such user: the route's own 404 handling stays in charge.
      if (!target) return next();
      const viewerId = (req.user as { id?: number } | undefined)?.id;
      if (viewerId === target.id) return next();
      if (!accountIsPubliclyVisible(target)) return res.status(404).json({ error: "User not found" });
      // A block hides each from the other, whoever pressed the button.
      if (viewerId && await usersAreBlocked(viewerId, target.id)) return res.status(404).json({ error: "User not found" });
      return next();
    } catch (err) {
      next(err);
    }
  };
}
