# Peer-to-Peer Sharing Marketplace

## Overview
A comprehensive peer-to-peer sharing marketplace platform enabling secure and engaging item borrowing, lending, and swapping. The platform features an advanced verification system, robust real-time communication, and focuses on creating trust-driven item exchange experiences. It aims to connect neighbors and foster a community of shared resources, with a vision of "Share more, own less." Key capabilities include AI-powered item recognition (SmartScan), intelligent matching, a gamified user progression system, and a flexible commission structure.

## User Preferences
- Keep original design (not the fresh green design)
- Prefer the professional teal color scheme over vibrant alternatives
- Minimize file count by collapsing similar components

## System Architecture
The platform is a full-stack JavaScript application utilizing modern patterns. The frontend, built with React TypeScript and Wouter, handles most application logic, while the Express.js backend with TypeScript manages data persistence and API calls. PostgreSQL with Drizzle ORM is used for the database.

**Key architectural decisions and features include:**
- **Authentication**: Custom Passport-based system with multi-provider support (local, Google OAuth, and optional phone verification).
- **Real-time Communication**: WebSocket server with reconnection strategies for chat.
- **Verification System**: Separate pages for identity verification (government ID upload) and payment methods (Stripe Elements for secure card entry), adhering to best practices.
- **AI-Powered Features**:
    - **SmartScan**: Uses GPT-4 Vision API for AI-powered item recognition from 360° photo scans, with auto-filling item details and AI value estimates for premium users.
    - **Marketplace Import**: AI-powered listing import from external marketplaces (e.g., Facebook Marketplace) using GPT-5 to extract and auto-fill item details, with robust security controls.
    - **Item Category Detection**: AI-powered auto-categorization of items using GPT-4o-mini.
    - **Item Recommendations**: AI-powered recommendations based on user behavior and context.
    - **Smart Matching**: Algorithm considers item condition, category, value fairness, and distance for swap requests, and matches lenders/borrowers based on wishlists.
- **Tier-Based Pricing System with AI Valuation**: Automatically assigns items to tiers based on original value, with AI-powered internal appraisal (using GPT-4 Vision and other factors) to determine ShareCoin valuation, trust-based borrow deposits, and rental rates. Includes condition modifiers and brand quality adjustments.
- **Rental Pricing System**: Category-based weekly rental rates and tier-based rental security deposits, both adjustable by owners within certain parameters. Features a 0% platform fee for 2025 (3% payment processing fee applies).
- **Swap System**: Uses fixed ShareCoin values per tier to ensure fairness, allowing 1-tier difference with ShareCoin offsets. Swaps do not involve cash offsets or security deposits.
- **UI/UX Decisions**: Intuitive interfaces with swipeable cards, stacked card UI, in-app scheduling, and a professional teal color scheme. Gamified account statistics and community impact levels incentivize sharing.
- **Transactional System**: Supports distinct transaction flows for Borrow (ShareCoins), Rent (Cash), Swap, and Gift. Includes in-app scheduling, security deposit options, and an anti-farming system for ShareCoin exploitation. All transaction lifecycle actions are managed through a unified inbox.
- **Messaging**: Automated messaging system for item requests with template generation.
- **Inventory Management**: "My ShareChest" for intuitive item management.
- **Follow System**: Allows users to follow neighbors to see their items in a personalized feed.
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
- **File Uploads**: Multer
- **Routing**: Wouter
- **Styling**: Tailwind CSS, shadcn UI components
- **Delivery Service**: Simulated Uber Direct (for testing)