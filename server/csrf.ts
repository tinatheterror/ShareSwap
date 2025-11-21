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

// Export the middleware and token generator
export const csrfProtection = csrfConfig.doubleCsrfProtection;
export const generateCsrfToken = csrfConfig.generateCsrfToken;

// Set CSRF token using the library's token generation
export function setCsrfToken(req: Request, res: Response): string {
  // Use the library's generateCsrfToken function which properly signs the token
  const token = csrfConfig.generateCsrfToken(req, res);
  
  console.log('[CSRF] Token set in cookie');
  return token;
}

// Middleware to attach CSRF token to response locals
export function attachCsrfToken(req: Request, res: Response, next: NextFunction) {
  // Token will be available in res.locals.csrfToken after the protection middleware runs
  next();
}
