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
- Implemented functional ID document upload with credit card verification
- Added comprehensive verification system requiring both identity and payment methods
- Fixed item upload form data handling and database validation errors
- Added camera scanning functionality for credit card verification
- Updated brand slogan to: "Share more, own less. Connect with your neighbours and discover a world of shared resources"
- Applied new slogan consistently across home page and auth page
- Date: August 3, 2025

## Architecture
- Full-stack JavaScript application following modern patterns
- Frontend handles most app logic, backend for data persistence and API calls
- Real-time messaging through WebSocket server
- Comprehensive authentication and authorization system
- Advanced verification system for items and users

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