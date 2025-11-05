import { doubleCsrf } from "csrf-csrf";
import { Request, Response, NextFunction } from "express";

// Security: Configure CSRF protection
const { doubleCsrfProtection, generateToken: csrfGenerateToken } = doubleCsrf({
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
    const token = req.headers["x-csrf-token"] as string || 
           req.body?._csrf || 
           req.query?._csrf as string;
    
    // Debug logging
    if (!token) {
      console.log('[CSRF] No token found in request. Headers:', req.headers);
    }
    
    return token;
  },
});

// Export the middleware
export const csrfProtection = doubleCsrfProtection;

// Manually set CSRF token in cookie (for GET /api/csrf-token endpoint)
export function setCsrfToken(req: Request, res: Response) {
  if (csrfGenerateToken && typeof csrfGenerateToken === 'function') {
    return csrfGenerateToken(req, res);
  } else {
    // Fallback: manually set a token if generateToken doesn't exist
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('x-csrf-token', token, {
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      httpOnly: false,
      path: "/",
    });
    return token;
  }
}

// Middleware to attach CSRF token to response locals
export function attachCsrfToken(req: Request, res: Response, next: NextFunction) {
  // Token will be available in res.locals.csrfToken after the protection middleware runs
  next();
}
