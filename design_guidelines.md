# ShareSwap Post-Request Acceptance Modal - Design Guidelines

## Design Approach

**Reference-Based Strategy:** Drawing from Airbnb's marketplace trust patterns, Stripe's payment transparency, and Uber's service clarity. This modal must instill confidence through clear information hierarchy, transparent pricing, and gentle guidance toward platform-protected options.

## Typography System

**Font Stack:** Inter (Google Fonts) for entire application
- Modal Title: 24px, weight 700, letter-spacing -0.02em
- Step Headers: 18px, weight 600
- Option Titles: 16px, weight 600
- Body Text: 15px, weight 400, line-height 1.5
- Fee Breakdown: 14px, weight 500
- Warnings/Disclaimers: 13px, weight 400, line-height 1.4
- Badge Text: 12px, weight 600, uppercase, letter-spacing 0.05em

## Layout & Spacing System

**Tailwind Spacing Primitives:** Standardize on 4, 6, 8, 12, 16, 24 unit increments
- Modal Container: max-w-2xl, rounded-2xl
- Modal Padding: p-8 (desktop), p-6 (mobile)
- Section Spacing: space-y-6
- Card Spacing: p-6
- Button Spacing: px-8 py-3
- Badge Spacing: px-3 py-1

**Grid System:**
- Option Cards: Full width stacked (single column for clarity)
- Fee Breakdown: Two-column grid (label | value)
- Navigation Buttons: Flex row with space-between

## Component Library

### Modal Container
- Centered overlay with backdrop blur
- Shadow: Large, soft (0 20px 60px rgba(0,0,0,0.15))
- Border: 1px subtle border for definition
- Entry animation: Fade + scale from 0.95 to 1.0 (200ms ease-out)

### Progress Indicator
- Horizontal step tracker at top of modal
- Two circles connected by line
- Active step: Filled, larger (32px)
- Inactive step: Outline, smaller (28px)
- Completed step: Checkmark icon
- Spacing: mb-8

### Option Cards (Primary Selection UI)
- Border: 2px solid, rounded-xl
- Hover: Lift effect with shadow increase
- Selected: Thicker border (3px), subtle glow
- Radio button: Top-right corner (20px size)
- Layout: Vertical stack with 16px spacing between elements

**Card Structure (Top to Bottom):**
1. Flex row: Title + Badge (if recommended)
2. Description text (gray tone)
3. Fee display (bold, prominent)
4. Feature list with checkmark icons (space-y-2)
5. Warning box (if self-arrange option)

### Recommended Badge
- Position: Absolute top-right of card (offset -2px, -12px for hanging effect)
- Rounded-full pill shape
- Icon: Star or shield (12px) + text
- Subtle gradient background enhancement

### Warning Components
- Light background treatment
- Left border accent (4px thick)
- Icon: Alert triangle (20px) at start
- Padding: p-4
- Border-radius: rounded-lg
- Font: 13px with tighter line-height

### Fee Breakdown Table
- Two-column layout with divider line
- Labels: Left-aligned, medium weight
- Values: Right-aligned, bold
- Total row: Thicker top border, larger text (16px)
- Spacing: py-3 per row

### Button System
**Primary CTA:**
- Full width on mobile, auto width on desktop
- Height: h-12
- Rounded: rounded-lg
- Weight: font-semibold
- Disabled state: Reduced opacity (0.5)

**Secondary/Back:**
- Ghost style (transparent with border)
- Same height as primary
- Icon support for back arrow

### Navigation Footer
- Sticky to modal bottom: pt-6, border-top
- Flex layout: Back button (left) | Progress dots (center) | Continue button (right)
- Desktop: justify-between
- Mobile: Stack with full-width buttons

## Step-Specific Layouts

### Step 1: Delivery Method
**Card Order:**
1. ShareSwap Delivery (Recommended) - Uber Direct integration
2. Self-Arrange Delivery

**ShareSwap Delivery Card:**
- Estimated delivery time with clock icon
- Insurance coverage highlight
- Real-time tracking feature
- Fee: "$X.XX via Uber Direct"

**Self-Arrange Card:**
- "No platform protection" warning box
- Responsibility disclaimer
- Fee: "Free"

### Step 2: Security Deposit

**Card Order:**
1. ShareSwap Deposit (Recommended) - Stripe integration
2. Self-Arrange Deposit

**ShareSwap Deposit Card:**
- Stripe hold explanation
- Auto-release timeline
- Dispute protection with shield icon
- Fee breakdown: "5% processing fee" with calculation shown

**Self-Arrange Card:**
- Risk warning box (more prominent than Step 1)
- "No platform mediation" emphasis
- Payment dispute disclaimer
- Fee: "Free"

## Visual Hierarchy

**Information Priority:**
1. Step title + progress (most prominent)
2. Recommended option card (visual emphasis via badge + subtle elevation)
3. Alternative option card
4. Fee breakdown (clear but secondary)
5. Navigation controls (accessible but not competing)

## Responsive Behavior

**Desktop (lg+):**
- Modal: 640px width, centered
- Cards: Full width with generous padding
- Buttons: Natural width with px-8

**Tablet (md):**
- Modal: 90% viewport width
- Maintain card spacing
- Buttons: Flexible width

**Mobile (base):**
- Modal: Full viewport height slide-up
- Reduced padding (p-6 to p-4)
- Stack all elements vertically
- Full-width buttons
- Sticky navigation footer

## Interaction Patterns

**Card Selection:**
- Single selection only (radio behavior)
- Click entire card to select
- Visual feedback: border change + subtle background shift
- Auto-scroll to selected card on mobile

**Fee Transparency:**
- Expandable fee breakdown (collapsed by default for recommended, expanded for self-arrange to show true cost)
- Calculation shown inline for percentage fees

**Validation:**
- Disable continue button until selection made
- Show validation message if attempting to proceed without selection

## Accessibility

- Focus visible indicators on all interactive elements
- ARIA labels for progress steps
- Semantic HTML with proper heading hierarchy (h2 for modal title, h3 for step titles)
- Keyboard navigation support (Tab, Enter, Escape)
- Screen reader announcements for step changes
- Color-independent indicators (icons + text, never color alone)

## Animation Budget (Minimal)

**Permitted animations only:**
- Modal entry/exit fade + scale
- Card selection state change (100ms)
- Progress step completion (checkmark fade-in 150ms)

**No animations for:**
- Hover states (instant)
- Fee breakdown expand/collapse (instant or CSS transition only)
- Button interactions

## Trust-Building Elements

**Security Signals:**
- Stripe logo integration for deposit step
- Uber Direct logo for delivery step
- Lock icon for secure transactions
- Shield icon for protection features

**Social Proof:**
- Optional: "Used by X,XXX transactions" micro-copy below recommended options
- Trust badge row at modal footer

This design prioritizes clarity and confidence, guiding users toward platform-protected options while maintaining transparency about all choices.