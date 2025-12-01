# Peer-to-Peer Sharing Marketplace

## Overview
A comprehensive peer-to-peer sharing marketplace platform enabling secure and engaging item borrowing, lending, and swapping. The platform features an advanced verification system, robust real-time communication, and focuses on creating trust-driven item exchange experiences. It aims to connect neighbors and foster a community of shared resources, moving towards a vision of "Share more, own less." Key capabilities include AI-powered item recognition (SmartScan), intelligent matching for requests, a gamified user progression system, and a flexible commission structure.

## User Preferences
- Keep original design (not the fresh green design)
- Prefer the professional teal color scheme over vibrant alternatives

## Authentication Setup
- **Google OAuth**: Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables
- **Phone Verification**: User dismissed Twilio integration setup. To enable phone auth in the future, either:
  1. Set up Twilio connector via Replit integrations, OR
  2. Manually add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER as secrets
- **Current State**: Google OAuth ready to test once credentials are added; phone button is disabled placeholder
- Minimize file count by collapsing similar components

## System Architecture
The platform is a full-stack JavaScript application utilizing modern patterns. The frontend, built with React TypeScript and Wouter, handles most application logic, while the Express.js backend with TypeScript manages data persistence and API calls. PostgreSQL with Drizzle ORM is used for the database.

Key architectural decisions and features include:
- **Authentication**: Custom Passport-based system with multi-provider support (local, Google OAuth, phone - pending Twilio).
- **Real-time Communication**: WebSocket server with reconnection strategies for chat.
- **Verification System**: Dual verification requiring government ID and payment method (credit card), enabling security deposits and damage/non-return protection.
- **AI-Powered Features**:
    - **SmartScan**: Uses GPT-4 Vision API for AI-powered item recognition from 360° photo scans, auto-filling item details. Offers 3 free scans/month, unlimited for Premium users, with premium users receiving AI value estimates.
    - **Marketplace Import**: AI-powered listing import from Facebook Marketplace, Craigslist, and Facebook Groups. Users paste a URL and GPT-5 extracts item details (name, description, price, condition) to auto-fill the listing form. Features comprehensive security controls including HTTPS-only, domain allowlisting, SSRF protection, and rate limiting.
    - **Item Category Detection**: AI-powered auto-categorization of items based on name. Uses GPT-4o-mini to detect item type (Baby & Kids, Clothing & Accessories, Electronics, Home & Kitchen, Tools & Equipment).
    - **Item Recommendations**: AI-powered recommendations based on user behavior, categories, and seasonal relevance.
    - **Smart Matching**: Algorithm considers item condition, category, value fairness, and distance for swap requests, and automatically matches lenders/borrowers based on wishlists.
- **AI-Powered Automatic Valuation System**:
    - **Photo Required**: At least 1 photo is mandatory for listing items (enforced on frontend and backend)
    - **3 Required Questions**: Item Name, Item Type (AI auto-filled), Condition (4 options) - No manual value entry needed
    - **Vision-Enhanced AI Valuation**: Uses GPT-4 Vision to analyze uploaded photos for:
      - Brand and model identification (logos, labels, model numbers)
      - Actual condition verification (scratches, wear, stains, damage)
      - Age indicators and completeness assessment
      - Quality level (premium vs budget brand)
    - **AI Valuation Analysis**: Automatically triggered when item details are filled, analyzing:
      - Category-specific depreciation rates (Electronics: 20-30%/year, Baby & Kids: 15-25%/year, Tools: 10-15%/year, etc.)
      - Condition multipliers (New/Like New: 85-100%, Good: 70-85% - no tier penalty, Fair: 45-60%, Well Loved: 25-40%)
      - Market trends (seasonal demand, brand reputation, secondhand availability)
    - **Trust-Building Display**: Shows confidence level badge (High/Medium/Low), original retail estimate, depreciation breakdown, and market context
    - **Automatic Tier Assignment**: 
      - Tier 1 ($0-$49) = 5 ShareCoins/week
      - Tier 2 ($50-$149) = 10 ShareCoins/week
      - Tier 3 ($150-$299) = 20 ShareCoins/week
      - Tier 4 ($300+) = 40 ShareCoins/week
    - **Day Proration**: ShareCoin cost = (Weekly Rate ÷ 7) × days, rounded down with minimum 1 coin
    - **Category-Specific Durations**: Baby & Kids items show longer duration presets (1 week to 6 months) vs standard items (1 day to 1 month)
- **UI/UX Decisions**:
    - Focus on intuitive interfaces like swipeable cards for item requests, stacked card UI with animations, and in-app scheduling.
    - Gamified Account Statistics section with gradients, animations, and progress bars to incentivize sharing behavior, leading to Community Impact Levels with associated benefits.
    - Professional teal color scheme.
- **Transactional System**:
    - In-app scheduling for pickup/delivery, celebration animations for transaction acceptance.
    - Flexible commission system for rentals (e.g., 5% standard) with platform sustainability and user reward fund components (ShareCoins).
    - Security deposit options (Stripe payment authorization holds vs. self-arranged).
    - Anti-farming system for ShareCoin exploitation detection.
- **Messaging**: Automated messaging system for item requests with template generation and date range selection.
- **Inventory Management**: "My ShareChest" for intuitive inventory management with filtering and item actions.
- **Follow System**: Allows users to follow neighbors to see their items in a personalized feed, promoting community.
- **No Results Wishlist Prompt**: When search returns no results on Borrow, Rent, or Swap pages, users see an attractive empty state with an "Add to Wishlist" button. This converts potentially frustrating experiences into demand signals, building community-driven inventory while keeping users engaged.
- **Automated Return Reminders**: Intelligent notification system that automatically reminds borrowers/renters about upcoming item returns. Sends reminders 1 day before the return date, on the return date, and daily for overdue items. Features a notification bell in the navbar with unread count badge, polling every 2 minutes for new notifications, and automatic reminder generation every 15 minutes. The system uses optimized queries (only checking items due within 2 days) to minimize server load. Return reminder notifications include distinct icons (clock for upcoming, alert for overdue) and relative timestamps for better user experience. Note: Current implementation uses client-side polling; for production scale, consider migrating to server-side background job scheduler (e.g., node-cron or Bull queue) to reduce redundant calculations and improve efficiency.
- **Security**: Comprehensive CSRF protection using a double-submit cookie pattern.
- **Database Optimization**: Strategic composite indexes for improved query performance.

## External Dependencies
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js (custom implementation), Google OAuth
- **AI Integration**: OpenAI (GPT-4 Vision API via Replit AI Integrations)
- **Payment Processing**: Stripe (for payment authorization holds)
- **File Uploads**: Multer
- **Routing**: Wouter (for React frontend)
- **Styling**: Tailwind CSS, shadcn UI components
- **Delivery Service (Test Mode)**: Simulated Uber Direct (for testing user interest, not live integration)