# Peer-to-Peer Sharing Marketplace

## Overview
A comprehensive peer-to-peer sharing marketplace platform enabling secure and engaging item borrowing, lending, and swapping. The platform features an advanced verification system, robust real-time communication, and focuses on creating trust-driven item exchange experiences. It aims to connect neighbours and foster a community of shared resources, with a vision of "Share more, own less." Key capabilities include AI-powered item recognition (SmartScan), intelligent matching, a gamified user progression system, and a flexible commission structure.

## User Preferences
- Keep original design (not the fresh green design)
- Prefer the professional teal color scheme over vibrant alternatives
- Minimize file count by collapsing similar components

## System Architecture
The platform is a full-stack JavaScript application utilizing modern patterns. The frontend, built with React TypeScript and Wouter, handles most application logic, while the Express.js backend with TypeScript manages data persistence and API calls. PostgreSQL with Drizzle ORM is used for the database.

**Key architectural decisions and features include:**
- **Authentication**: Custom Passport-based system with multi-provider support (local email/password, Google OAuth, and optional phone verification). Email registration includes verification via SendGrid - users receive a verification link valid for 24 hours.
- **Real-time Communication**: WebSocket server with reconnection strategies for chat.
- **Verification System**: Three-tiered verification with progressive access:
    - **Unverified (no email verification)**: Can only create account and browse items
    - **Email Verified (no ID/payment)**: Can create items, send messages, make swaps/gifts, add wishlists, leave reviews - but cannot borrow or rent items
    - **Fully Verified (email + ID + payment)**: No restrictions - full access to borrow and rent items
    - Identity verification via Persona embedded flow (selfie + government ID matching), payment verification via Stripe payment method on file
    - Persona integration: Server creates inquiry via API, frontend launches modal SDK, server verifies status via Persona API before awarding rewards (idempotent)
- **AI-Powered Features**:
    - **SmartScan**: Uses GPT-4 Vision API for AI-powered item recognition from 360° photo scans, with auto-filling item details and AI value estimates for premium users.
    - **Marketplace Import**: AI-powered listing import from external marketplaces (e.g., Facebook Marketplace) using GPT-5 to extract and auto-fill item details, with robust security controls.
    - **Item Category Detection**: AI-powered auto-categorization of items using GPT-4o-mini.
    - **Item Recommendations**: AI-powered recommendations based on user behavior and context.
    - **Smart Matching**: Algorithm considers item condition, category, value fairness, and distance for swap requests, and matches lenders/borrowers based on wishlists.
- **Tier-Based Pricing System with AI Valuation**: Uses priority-based replacement value calculation:
    - **Priority 1**: If AI estimated value exists (from SmartScan), use it directly as replacement value and calculate tier from it
    - **Priority 2**: If no AI estimate, use midpoint of the original value range as replacement value and calculate tier from it
    - Tier boundaries: Tier 1 (Under $50), Tier 2 ($50–$199), Tier 3 ($200–$499), Tier 4 ($500–$2,000). Items over $2,000 replacement value cannot be listed.
    - Condition modifier: "Fair" or "Well Loved" reduces tier by 1
    - ShareCoin valuation, trust-based borrow deposits, and rental rates derived from tier. Includes brand quality adjustments.
- **Rental Pricing System**: Category-based weekly rental rates and tier-based rental security deposits, both adjustable by owners within certain parameters. Features a 0% platform fee for 2025 (3% payment processing fee applies).
- **Swap System**: Uses fixed ShareCoin values per tier to ensure fairness, allowing 1-tier difference with ShareCoin offsets. Swaps do not involve cash offsets or security deposits.
- **UI/UX Decisions**: Intuitive interfaces with swipeable cards, stacked card UI, in-app scheduling, and a professional teal color scheme. Gamified account statistics and community impact levels incentivize sharing.
- **Transactional System**: Supports distinct transaction flows for Borrow (ShareCoins), Rent (Cash), Swap, and Gift. Includes in-app scheduling, security deposit options, and an anti-farming system for ShareCoin exploitation. All transaction lifecycle actions are managed through a unified inbox.
- **Messaging**: Automated messaging system for item requests with template generation.
- **Inventory Management**: "My ShareChest" for intuitive item management.
- **Follow System**: Allows users to follow neighbours to see their items in a personalized feed.
- **No Results Wishlist Prompt**: Engages users by prompting them to add to a wishlist when search yields no results.
- **Automated Return Reminders**: Intelligent notification system for upcoming and overdue returns, with client-side polling and distinct notification icons.
- **Account Deactivation System**: Self-service deactivation that hides user profiles and listings while preserving transaction history for compliance. Reactivation is instant. Permanent deletion requires contacting support.
- **Security**: Comprehensive CSRF protection using a double-submit cookie pattern.
- **Database Optimization**: Strategic composite indexes for improved query performance.
- **Referral System**: Rewards referrers with 10 ShareCoins upon a new user's first transaction.
- **Profile Photos**: Users can upload profile photos, with GPT-4 Vision validation for a +1 ShareCoin bonus for clear human faces.
- **Trust Score System**: Reflects user reliability based on borrowing/returning behavior, lending, swaps, positive reviews, good communication, and rentals/gifting. Penalties apply for unreturned or damaged items, or late returns without notice.

## External Dependencies
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js, Google OAuth
- **AI Integration**: OpenAI (GPT-4 Vision API)
- **Payment Processing**: Stripe
- **File Uploads**: Multer with memory storage
- **Image Storage**: Replit Object Storage (primary) with local filesystem fallback
- **Routing**: Wouter
- **Styling**: Tailwind CSS, shadcn UI components
- **Delivery Service**: Simulated Uber Direct (for testing)
- **Email Service**: SendGrid (via Replit integration for transactional emails including verification)
- **Beta Feedback**: UserJot widget (SDK v2, custom trigger, logged-in users only via VITE_USERJOT_PROJECT_ID env var)

## Server Stability
- **Neon DB Keepalive**: `db/index.ts` runs a `SELECT 1` keepalive every 55s to prevent Neon from auto-suspending idle connections (which caused silent server crashes)
- **Per-client DB error handlers**: Individual pool client errors are caught before they can propagate and crash the process
- **WebSocket server error handler**: `wss.on("error", ...)` prevents unhandled WS server errors from crashing Node.js
- **SIGTERM/SIGINT handlers**: Graceful shutdown logging in `server/index.ts`
- **EADDRINUSE recovery**: Retry-with-delay mechanism (no pkill — avoiding self-termination risk)

## Image Storage Configuration
The platform uses Replit Object Storage for persistent image storage:
- **Primary**: Replit Object Storage (images persist across redeploys)
- **Fallback**: Local filesystem (used if Object Storage not configured)
- **URL Format**: `/storage/images/filename.jpg` for Object Storage, `/uploads/filename.jpg` for local
- **Setup**: Create a bucket via Tools → Object Storage in the Replit workspace
- **Status Check**: GET `/api/storage/status` returns current storage configuration