import { doubleCsrf } from "csrf-csrf";
import { Request, Response, NextFunction } from "express";

// Security: Configure CSRF protection
const csrfConfig = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET || process.env.REPL_ID || "csrf-secret-fallback",
  cookieName: "x-csrf-token",
  cookieOptions: {
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false, // Must be false so frontend can read the token to send in header
    path: "/",
  },
  size: 64,
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  getSessionIdentifier: (req: Request) => {
    // Use session ID as identifier (available after session middleware)
    return req.sessionID || "anonymous";
  },
  getCsrfTokenFromRequest: (req: Request) => {
    // Check multiple possible locations for the CSRF token
    return req.headers["x-csrf-token"] as string || 
           req.body?._csrf || 
           req.query?._csrf as string;
  },
});

// Export the middleware
export const csrfProtection = csrfConfig.doubleCsrfProtection;

// Middleware to attach CSRF token to response locals
export function attachCsrfToken(req: Request, res: Response, next: NextFunction) {
  // Token will be available in res.locals.csrfToken after the protection middleware runs
  next();
}
