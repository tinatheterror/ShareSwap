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
    - **Item Recommendations**: AI-powered recommendations based on user behavior, categories, and seasonal relevance.
    - **Smart Matching**: Algorithm considers item condition, category, value fairness, and distance for swap requests, and automatically matches lenders/borrowers based on wishlists.
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