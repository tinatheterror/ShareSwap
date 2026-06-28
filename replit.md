# ShareSwap

A community sharing platform where neighbours borrow, lend, rent, swap, and gift items — reducing waste and building community connections.

## Run & Operate

- `PORT=8080 pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `PORT=19887 BASE_PATH=/ pnpm --filter @workspace/shareswap run dev` — run the web frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Frontend: React 18 + Vite + Tailwind CSS v3 + wouter routing
- Auth: Passport.js (local + Google OAuth)
- Payments: Stripe
- Storage: @replit/object-storage
- Email: SendGrid
- AI: OpenAI
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/api-server/src/` — Express 5 backend (routes, auth, storage, Stripe, AI)
- `artifacts/api-server/src/routes/routes.ts` — all app routes (13k lines, registerRoutes pattern)
- `artifacts/shareswap/src/` — React frontend
- `artifacts/shareswap/src/App.tsx` — routing and app entry
- `lib/db/src/schema/schema.ts` — Drizzle DB schema (source of truth)
- `artifacts/shareswap/theme.json` — ShadCN theme (teal brand colors)

## Architecture decisions

- Backend uses `registerRoutes(app)` pattern (not Express router) because of WebSocket, session, and middleware complexity
- OpenAPI spec skipped for this port — app has 100+ endpoints with a custom fetch layer; kept existing frontend API hooks
- `@replit/object-storage` externalized in esbuild since it uses Google Cloud Storage internals
- Express 5 requires named wildcards: `/storage/*path` instead of `/storage/*`
- `@db` and `@db/schema` imports in server files replaced with `@workspace/db`

## Product

ShareSwap lets neighbours share items in 5 ways: borrow/lend, rent, swap, and gift. Features include AI-powered item valuation, trust scores, ShareCoins reward currency, Stripe payments, delivery via Uber Direct, and community challenges/games.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- API Server builds with esbuild before starting — dev restarts are slow (30-60s)
- `drizzle-kit push` requires a TTY for interactive prompts; apply schema changes via SQL for non-interactive environments
- Express 5 path-to-regexp v8 requires named wildcards in route patterns
- The `lib/baby-catalog.ts` file lives nested at `src/lib/lib/baby-catalog.ts` in the api-server artifact

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
