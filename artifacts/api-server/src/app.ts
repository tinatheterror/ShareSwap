import express, { type Express, type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import healthRouter from "./routes/health";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed =
        origin.includes(".replit.app") ||
        origin.includes(".replit.dev") ||
        origin.includes(".expo.spock.replit.dev") ||
        origin.includes("localhost");
      callback(null, allowed);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-csrf-token", "Authorization"],
  }),
);

app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production"
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                "https://js.stripe.com",
                "https://cdn.withpersona.com",
                "https://*.userjot.com",
                "https://accounts.google.com",
              ],
              styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
              imgSrc: ["'self'", "data:", "blob:", "https:"],
              connectSrc: [
                "'self'",
                "https://api.stripe.com",
                "https://api.withpersona.com",
                "https://*.withpersona.com",
                "https://api.openai.com",
                "https://*.userjot.com",
                "wss:",
                "ws:",
              ],
              frameSrc: [
                "'self'",
                "https://js.stripe.com",
                "https://*.stripe.com",
                "https://*.stripe.network",
                "https://withpersona.com",
                "https://*.withpersona.com",
                "https://*.userjot.com",
                "https://accounts.google.com",
              ],
              frameAncestors: ["'none'"],
              objectSrc: ["'none'"],
              mediaSrc: ["'self'", "blob:"],
              workerSrc: ["'self'", "blob:"],
            },
          }
        : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ message: "Too many requests, please try again later." });
  },
});

app.use("/api/", generalLimiter);

app.use(cookieParser());

app.use("/api/stripe/subscription-webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false, limit: "10mb" }));

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Robots-Tag", "index, follow");
  next();
});

app.use("/api/healthz", healthRouter);

export default app;
