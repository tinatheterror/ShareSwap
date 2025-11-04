# Peer-to-Peer Sharing Marketplace

## Project Overview
A comprehensive peer-to-peer sharing marketplace platform that enables secure and engaging item borrowing, lending, and swapping through an advanced verification system. The platform focuses on creating delightful, trust-driven item exchange experiences with robust real-time communication.

## Tech Stack
- **Frontend**: React TypeScript with Wouter for routing
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Custom passport-based verification system
- **Real-time Communication**: WebSocket with reconnection strategy
- **File Uploads**: Multer for image handling
- **Security**: Advanced location matching and item verification

## Recent Changes
- ✅ **Implemented SmartScan AI item recognition** - Computer vision-powered auto-tagging with 3 free scans/month, unlimited for Premium
- ✅ **Implemented CSRF protection** - Double-submit cookie pattern with csrf-csrf package protects all mutating requests
- ✅ **Fixed WebSocket authentication security** - Session-based validation prevents user impersonation in real-time chat
- Fixed TypeScript type declarations for Passport.js session data
- Fixed critical item browsing issues caused by Express route conflicts
- Implemented swipeable card interface for Item Requests page with intuitive left/right swipe actions
- Added clever copy: "Not today!" for reject (left swipe) and "Let's share!" for accept (right swipe)
- Created first-time user tutorial showing swipe functionality with visual indicators
- Added stacked card UI with smooth animations and swipe feedback
- Added prompts for users with 0 ShareCoins when accessing borrow functionality
- Added prompts for users with 0 items in ShareChest when accessing swap functionality
- Both prompts redirect users to item upload screen to encourage participation
- Implemented AI-powered item recommendations based on past behavior
- Added intelligent recommendation engine that analyzes user patterns, categories, and similarity
- Integrated recommendations section into borrow and swap pages with engaging yellow theme
- Recommendations show AI reasoning with badges like "Matches your interests" and "Similar to recent activity"
- Added smart matching for swap requests with compatibility scoring based on category, value, and condition
- Implemented location-based item alerts system allowing users to set keyword alerts for nearby items
- Created seasonal item recommendations that adapt to current season (Winter, Spring, Summer, Fall)
- Built comprehensive profile page with location alerts management and personalized recommendations
- Enhanced matching algorithm considers item condition, category similarity, value fairness, and distance
- ✅ **Secured WebSocket chat** - Validates sessions on connection, rejects unauthorized users, prevents impersonation
- Implemented functional ID document upload with credit card verification
- Added comprehensive verification system requiring both identity and payment methods
- Fixed item upload form data handling and database validation errors
- Added camera scanning functionality for credit card verification
- Updated brand slogan to: "Share more, own less. Connect with your neighbours and discover a world of shared resources"
- Applied new slogan consistently across home page and auth page
- Added in-app scheduling for pickup/delivery after accepting requests
- Implemented celebration animation with satisfying sound effects for transaction acceptance
- Created security deposit options: credit card processing vs self-facilitated with risk warnings
- Enhanced swipe-right functionality to trigger celebration then scheduling flow
- Added delivery service integration with commission structure for Uber, DoorDash, etc.
- Implemented self-delivery option with comprehensive risk warnings and user acknowledgments
- Added calendar sync functionality for lending durations with return date tracking
- Enhanced QR code generation for easy item handover verification with detailed metadata
- Created calendar export functionality (.ics format) for delivery appointments
- Extended delivery arrangements with return dates, special instructions, and risk acceptance tracking
- Improved delivery arrangements page with better QR codes, calendar integration, and visual indicators
- Updated subscription plans branding from "ShareSpace" to "ShareSwap" to align with platform identity
- Clarified ShareCoin earning model: coins earned only after successful lending/delivery completion, not for posting items
- Added wishlist fulfillment popup to encourage immediate ShareCoin earning by helping neighbors
- Added wishlist expiration system that automatically archives items after their needed date passes
- Implemented archive toggle to show/hide expired wishlist items with visual indicators
- Enhanced wishlist interface with expiration status, reasons, and archive management
- Added database columns for expiration tracking (is_expired, expiration_reason)
- Created comprehensive archiving system instead of deletion to preserve user history
- Implemented automatic matching system between lenders and borrowers when items are uploaded
- Added intelligent matching modal that appears when uploading items that fulfill wishlist requests
- Created auto-match API endpoint that connects lenders and borrowers automatically
- Enhanced lend page with real-time wishlist matching and ShareCoin earning incentives
- Replaced lending duration with calendar-specific availability dates (Available From/Until)
- Added automatic date matching that fills availability dates from wishlist request dates
- Enhanced matching modal to display perfect date alignments with duration calculations
- Added visual indicators showing matched dates and automatic form population
- Added "My ShareChest" navigation item for intuitive inventory management with filtering and item actions
- Removed requests page per user preference - users don't need to see current transactions happening
- Updated navigation to focus on core sharing actions: browse, lend, borrow, swap
- Streamlined user experience by removing transactional complexity from main navigation
- Fixed universal messaging on lend page to work for all three modes: lending, renting, and swapping
- Implemented ShareCoin earning for successful swaps: both users earn 1 ShareCoin when swap requests are accepted
- Enhanced swap transaction system with automatic ShareCoin rewards and transaction logging
- Added configurable commission system for rental transactions with multiple pricing strategies
- Implemented platform commission tracking with premium user benefits (reduced rates)
- Created flexible commission structure: 5% standard, 3% low-cost, 8% premium, or flat fees
- Added minimum commission threshold ($0.50) to avoid micro-charges
- Implemented comprehensive anti-farming system to prevent ShareCoin exploitation through coordinated swaps
- Added intelligent detection for suspicious patterns: rapid back-and-forth swaps, reverse swaps, artificial items
- Created automatic cooldown system (6-48 hours) and transaction blocking for farming attempts
- Enhanced security with account correlation analysis and earning rate monitoring
- Implemented 5% rental commission system split: 3% platform sustainability + 2% user reward fund (converted to ShareCoins)
- Added ShareCoin rewards for rental returns: 1 ShareCoin to both users when items are successfully returned
- Updated platform messaging: "Only pay when you earn — our platform grows with you"
- Created rental return tracking system with commission breakdown and reward distribution
- Implemented automated messaging system for item requests with template generation
- Added date range selection (start/end dates) for rental, borrowing, and swap requests
- Created quick message templates: Quick & Friendly, Polite & Formal, Detailed & Personal
- Enhanced request form with date picker functionality and automated date range buttons (1 day, 3 days, 1 week, 2 weeks)
- Messages automatically include owner name, item name, action type, and selected date ranges with emoji support
- Fixed rent and swap browsing to display only items available for those specific actions
- Enhanced API filtering with type parameter (rent/borrow/swap) for both nearby and general item endpoints
- Created dedicated rent page with proper filtering for rentable items only
- Updated swap page to use backend filtering instead of frontend filtering for better performance
- Enhanced Account Statistics section with gamified design including gradients, animations, and progress bars
- Implemented meaningful Community Impact Level system based on actual sharing behavior
- Added level benefits: higher trust score, priority in requests, exclusive items access, and reduced platform fees
- Created themed color schemes and hover effects for each statistic (gold, green, blue, purple)
- Optimized database performance with 17 strategic composite indexes (8-20x faster queries)
- Fixed bounding box location queries with antimeridian crossing and extreme latitude handling
- Implemented comprehensive CSRF protection using csrf-csrf package with double-submit cookie pattern
- Frontend automatically fetches and includes CSRF tokens in all POST/PUT/DELETE/PATCH requests
- Built SmartScan feature with AI-powered item recognition from 360° photo scans
- Added monthly usage tracking (3 free SmartScans/month, reset on 1st, unlimited for Premium users)
- ✅ **Activated GPT-4 Vision API integration** - Real AI-powered item analysis now live via Replit AI Integrations
- Premium users get AI value estimates in addition to standard SmartScan features
- SmartScan auto-fills: name, description, category, brand, condition rating
- OpenAI Vision API analyzes multiple images simultaneously for comprehensive item recognition
- Graceful fallback system if AI analysis fails (photos still uploaded, user fills details manually)
- ✅ **Implemented Follow System** - Users can follow neighbors to see their items in a personalized feed
- Added friendly connection displays showing "Trusted by X neighbors" instead of competitive follower counts
- Created "From People You Follow" feed section on borrow page showing recent items from followed users
- Implemented transactional follow/unfollow operations with unique constraints to prevent duplicates
- Added optimistic UI updates with proper cache invalidation for instant feedback
- Built reusable FollowButton component with loading states and error handling
- Follow counts displayed on profile page in supportive, community-focused language
- Database includes follower/following counts for efficient queries without expensive joins
- Date: November 4, 2025

## Architecture
- Full-stack JavaScript application following modern patterns
- Frontend handles most app logic, backend for data persistence and API calls
- Real-time messaging through WebSocket server
- Comprehensive authentication and authorization system
- Advanced verification system for items and users
- AI-powered SmartScan using GPT-4o Vision for item recognition (active)
- Freemium model: 3 free SmartScans/month, unlimited for Premium
- Replit AI Integrations provides OpenAI access (billed to user credits)

## Security & Payment System
- **Dual Verification**: Users must verify both identity (government ID) and payment method (credit card)
- **Security Deposits**: Credit card information enables charging deposits for borrowed items
- **Damage Protection**: Ability to charge for item repairs or replacements
- **Non-Return Protection**: Charge full replacement cost if items aren't returned
- **Trust & Accountability**: Payment verification creates responsible user behavior

## User Preferences
- Keep original design (not the fresh green design)
- Prefer the professional teal color scheme over vibrant alternatives

## Development Guidelines
- Follow full-stack JavaScript best practices
- Use Replit's workflow system for long-running tasks
- Minimize file count by collapsing similar components
- Use shadcn UI components with Tailwind CSS
- Implement proper error handling and loading states