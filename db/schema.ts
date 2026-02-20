import { pgTable, text, serial, boolean, timestamp, integer, decimal, numeric, varchar, index, date } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  handle: text("handle").unique(), // Auto-generated unique handle (e.g., jessica483) - never changes
  displayName: text("display_name"), // User-editable display name shown on cards, chats, reviews
  password: text("password"), // Made nullable for OAuth/phone auth
  authProvider: text("auth_provider").default("local"), // 'local', 'google', 'phone'
  googleId: text("google_id").unique(),
  phoneNumber: text("phone_number").unique(),
  phoneVerified: boolean("phone_verified").default(false),
  emailVerified: boolean("email_verified").default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpires: timestamp("email_verification_expires"),
  isVerified: boolean("is_verified").default(false),
  verifiedAt: timestamp("verified_at"),
  profilePhoto: text("profile_photo"), // URL to uploaded profile photo
  hasUploadedProfilePhoto: boolean("has_uploaded_profile_photo").default(false), // For one-time bonus tracking
  profilePhotoValidationStatus: text("profile_photo_validation_status"), // 'approved', 'rejected', 'pending'
  profilePhotoValidationReason: text("profile_photo_validation_reason"), // Reason for rejection or notes
  shareCoins: decimal("share_coins", { precision: 10, scale: 2 }).default("0.00"),
  reputationScore: integer("reputation_score").default(0),
  reputationLevel: text("reputation_level").default("Newcomer"),
  isPremium: boolean("is_premium").default(false),
  premiumExpiresAt: timestamp("premium_expires_at"),
  referralCode: text("referral_code").unique(),
  referredBy: integer("referred_by"),
  smartScansUsed: integer("smart_scans_used").default(0),
  smartScansResetDate: timestamp("smart_scans_reset_date").defaultNow(),
  hasCompletedFirstListing: boolean("has_completed_first_listing").default(false),
  hasCompletedFirstRent: boolean("has_completed_first_rent").default(false),
  hasCompletedFirstLend: boolean("has_completed_first_lend").default(false),
  hasCompletedFirstSwap: boolean("has_completed_first_swap").default(false),
  hasCompletedFirstGift: boolean("has_completed_first_gift").default(false),
  hasCompletedFirstBorrow: boolean("has_completed_first_borrow").default(false),
  hasSeenVerificationNudge: boolean("has_seen_verification_nudge").default(false),
  accountStatus: text("account_status").default("active"), // 'active', 'deactivated', 'pending_deletion'
  deactivatedAt: timestamp("deactivated_at"),
  deletionRequestedAt: timestamp("deletion_requested_at"),
  fullName: text("full_name"),
  bio: text("bio"),
  location: text("location"),
  phone: text("phone"),
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  paymentMethodLast4: text("payment_method_last4"),
  paymentMethodBrand: text("payment_method_brand"),
  paymentMethodExpMonth: integer("payment_method_exp_month"),
  paymentMethodExpYear: integer("payment_method_exp_year"),
  paymentMethodAddedAt: timestamp("payment_method_added_at"),
  deviceFingerprint: text("device_fingerprint"), // For referral fraud detection
  rentalBalance: decimal("rental_balance", { precision: 10, scale: 2 }).default("0.00"), // Available balance from rental earnings
  pendingRentalBalance: decimal("pending_rental_balance", { precision: 10, scale: 2 }).default("0.00"), // Pending balance (in escrow)
  stripeConnectedAccountId: text("stripe_connected_account_id"), // For Stripe Connect payouts
  defaultPostalCode: text("default_postal_code"), // Saved location for browsing
  defaultCity: text("default_city"), // Saved city for browsing
  locationRadius: integer("location_radius").default(25), // Search radius in km (5, 25, or custom)
  hasCompletedLocationSetup: boolean("has_completed_location_setup").default(false), // Track if user completed location setup
  createdAt: timestamp("created_at").defaultNow(),
});

export const reputationActivities = pgTable("reputation_activities", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  activityType: text("activity_type").notNull(),
  points: integer("points").notNull(),
  itemId: integer("item_id").references(() => items.id),
  description: text("description").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userReviews = pgTable("user_reviews", {
  id: serial("id").primaryKey(),
  reviewerId: integer("reviewer_id").references(() => users.id),
  reviewedUserId: integer("reviewed_user_id").references(() => users.id),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  feedbackTags: text("feedback_tags").array(), // ['reliable', 'on_time', 'as_described']
  transactionId: integer("transaction_id").references(() => itemRequests.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: serial("id").primaryKey(),
  userId: serial("user_id").references(() => users.id),
  fullName: text("full_name"),
  idNumber: text("id_number"),
  personaInquiryId: text("persona_inquiry_id"),
  personaStatus: text("persona_status"),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").references(() => users.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category"),
  brand: text("brand"),
  itemType: text("item_type"),
  condition: text("condition"),
  originalValue: text("original_value"),
  tier: integer("tier"),
  conditionRating: integer("condition_rating").notNull(),
  photos: text("photos").array().notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 8 }),
  longitude: numeric("longitude", { precision: 11, scale: 8 }),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  isLendable: boolean("is_lendable").default(false),
  isSwappable: boolean("is_swappable").default(false),
  isRentable: boolean("is_rentable").default(false),
  isGift: boolean("is_gift").default(false),
  securityDeposit: decimal("security_deposit"),
  lendingDuration: integer("lending_duration"),
  shareCoinsReward: decimal("share_coins_reward").notNull(),
  shareCoinPrice: decimal("share_coin_price", { precision: 10, scale: 2 }),
  dollarsPrice: decimal("dollars_price", { precision: 10, scale: 2 }),
  estimatedValue: decimal("estimated_value", { precision: 10, scale: 2 }),
  replacementValue: integer("replacement_value"),
  isAvailable: boolean("is_available").default(true),
  isConditionVerified: boolean("is_condition_verified").default(false),
  wasSmartScanned: boolean("was_smart_scanned").default(false),
  swapDesiredItem: text("swap_desired_item"),
  swapNotifyOnMatch: boolean("swap_notify_on_match").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  ownerCreatedIdx: index("items_owner_created_idx").on(table.ownerId, table.createdAt),
  availableCreatedIdx: index("items_available_created_idx").on(table.isAvailable, table.createdAt),
  availableRentableIdx: index("items_available_rentable_idx").on(table.isAvailable, table.isRentable),
  availableLendableIdx: index("items_available_lendable_idx").on(table.isAvailable, table.isLendable),
  availableSwappableIdx: index("items_available_swappable_idx").on(table.isAvailable, table.isSwappable),
  locationIdx: index("items_location_idx").on(table.latitude, table.longitude),
}));

export const itemConditionVerifications = pgTable("item_condition_verifications", {
  id: serial("id").primaryKey(),
  itemId: serial("item_id").references(() => items.id),
  verifierId: serial("verifier_id").references(() => users.id),
  actualConditionRating: integer("actual_condition_rating").notNull(),
  notes: text("notes"),
  photos: text("photos").array(),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  senderId: serial("sender_id").references(() => users.id),
  receiverId: serial("receiver_id").references(() => users.id),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  senderCreatedIdx: index("messages_sender_created_idx").on(table.senderId, table.createdAt),
  receiverCreatedIdx: index("messages_receiver_created_idx").on(table.receiverId, table.createdAt),
}));

export const shareCoinsTransactions = pgTable("share_coins_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  amount: decimal("amount").notNull(),
  description: text("description").notNull(),
  transactionType: text("transaction_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userCreatedIdx: index("share_coins_transactions_user_created_idx").on(table.userId, table.createdAt),
}));

export const platformCommissions = pgTable("platform_commissions", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").references(() => itemRequests.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 4 }).notNull(),
  transactionType: text("transaction_type").notNull(), // 'RENTAL', 'PURCHASE'
  itemId: integer("item_id").references(() => items.id),
  payerId: integer("payer_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const swapCooldowns = pgTable("swap_cooldowns", {
  id: serial("id").primaryKey(),
  userId1: integer("user_id_1").references(() => users.id),
  userId2: integer("user_id_2").references(() => users.id),
  cooldownUntil: timestamp("cooldown_until").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const farmingDetections = pgTable("farming_detections", {
  id: serial("id").primaryKey(),
  userId1: integer("user_id_1").references(() => users.id),
  userId2: integer("user_id_2").references(() => users.id),
  itemId: integer("item_id").references(() => items.id),
  riskLevel: text("risk_level").notNull(), // 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  detectionReason: text("detection_reason").notNull(),
  actionTaken: text("action_taken").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const rentalReturns = pgTable("rental_returns", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").references(() => itemRequests.id),
  itemId: integer("item_id").references(() => items.id),
  renterId: integer("renter_id").references(() => users.id),
  ownerId: integer("owner_id").references(() => users.id),
  returnedAt: timestamp("returned_at").defaultNow(),
  commissionCharged: decimal("commission_charged", { precision: 10, scale: 2 }),
  shareCoinsAwarded: integer("share_coins_awarded").default(0),
  status: text("status").default("RETURNED"), // 'RETURNED', 'DAMAGED', 'LOST'
  notes: text("notes"),
});

export const sponsoredGames = pgTable("sponsored_games", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
  rewardAmount: decimal("reward_amount", { precision: 10, scale: 2 }).notNull(),
  sponsorName: text("sponsor_name").notNull(),
  gameUrl: text("game_url").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const gameSessions = pgTable("game_sessions", {
  id: serial("id").primaryKey(),
  userId: serial("user_id").references(() => users.id),
  gameId: serial("game_id").references(() => sponsoredGames.id),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  score: integer("score"),
  rewardAmount: decimal("reward_amount", { precision: 10, scale: 2 }),
  status: text("status").default("started"),
});

export const communityChallenges = pgTable("community_challenges", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  challengeType: text("challenge_type").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  rewardAmount: decimal("reward_amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").default("upcoming"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const challengeParticipants = pgTable("challenge_participants", {
  id: serial("id").primaryKey(),
  userId: serial("user_id").references(() => users.id),
  challengeId: serial("challenge_id").references(() => communityChallenges.id),
  currentScore: integer("current_score").default(0),
  currentRank: integer("current_rank"),
  rewardClaimed: boolean("reward_claimed").default(false),
  joinedAt: timestamp("joined_at").defaultNow(),
});

export const itemRequests = pgTable("item_requests", {
  id: serial("id").primaryKey(),
  itemId: serial("item_id").references(() => items.id),
  requesterId: serial("requester_id").references(() => users.id),
  requestType: text("request_type").notNull(),
  status: text("status").default("PENDING").notNull(),
  // Extended status for transaction lifecycle:
  // PENDING -> ACCEPTED -> DEPOSIT_PENDING -> DEPOSIT_CONFIRMED -> COURIER_PENDING (if courier) -> 
  // HANDOFF_CONFIRMED -> IN_PROGRESS -> RETURN_REQUESTED -> RETURN_CONFIRMED -> COMPLETED
  // Or: REJECTED, CANCELLED, DEPOSIT_FAILED
  message: text("message"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  matchScore: integer("match_score"), // AI matching score for swap requests
  deliveryMethod: text("delivery_method").default("in_person"), // 'in_person' | 'courier'
  depositMethod: text("deposit_method").default("in_app"), // 'in_app' | 'in_person' (borrow only)
  
  // Terms negotiation tracking
  negotiationStatus: text("negotiation_status").default("pending_owner"), // 'pending_owner' | 'counter_proposed' | 'terms_accepted' | 'terms_declined'
  counterDeliveryMethod: text("counter_delivery_method"), // lender's proposed delivery method
  counterDepositMethod: text("counter_deposit_method"), // lender's proposed deposit method
  counterProposedAt: timestamp("counter_proposed_at"),
  counterProposedBy: integer("counter_proposed_by"), // user ID who proposed the counter
  termsAcceptedAt: timestamp("terms_accepted_at"),
  termsDeclinedAt: timestamp("terms_declined_at"),
  
  deliveryConfirmed: boolean("delivery_confirmed").default(false),
  deliveryConfirmedAt: timestamp("delivery_confirmed_at"),
  courierBookedBy: text("courier_booked_by"), // 'requester' | 'owner' - who booked the courier
  courierIssue: boolean("courier_issue").default(false), // true if item lost/damaged during courier delivery
  courierIssueNote: text("courier_issue_note"), // description of the courier issue
  
  // Deposit tracking
  trustDepositAmount: decimal("trust_deposit_amount", { precision: 10, scale: 2 }), // calculated deposit after trust discount
  trustDepositBaseAmount: decimal("trust_deposit_base_amount", { precision: 10, scale: 2 }), // original deposit before discount
  trustDiscountPercentage: integer("trust_discount_percentage"), // e.g., 20, 40, 60
  requesterTrustScoreSnapshot: integer("requester_trust_score_snapshot"), // trust score at time of request
  depositStatus: text("deposit_status"), // 'pending' | 'authorized' | 'held' | 'released' | 'captured' | 'failed'
  depositPaymentIntentId: text("deposit_payment_intent_id"), // Stripe payment intent ID
  depositAuthorizedAt: timestamp("deposit_authorized_at"),
  depositReleasedAt: timestamp("deposit_released_at"),
  
  // ShareCoin tracking for borrow
  shareCoinAmount: decimal("share_coin_amount", { precision: 10, scale: 2 }), // ShareCoins to be charged
  shareCoinsCharged: boolean("share_coins_charged").default(false),
  shareCoinsChargedAt: timestamp("share_coins_charged_at"),
  
  // Courier booking
  courierAddress: text("courier_address"), // confirmed pickup/delivery address
  courierPickupWindow: text("courier_pickup_window"), // e.g., '9am-12pm', '12pm-3pm', '3pm-6pm'
  courierBookingId: text("courier_booking_id"), // external courier booking reference
  courierBookedAt: timestamp("courier_booked_at"),
  courierStatus: text("courier_status"), // 'pending' | 'booked' | 'picked_up' | 'delivered' | 'cancelled'
  
  // Handoff tracking - dual confirmation
  ownerConfirmedHandoff: boolean("owner_confirmed_handoff").default(false),
  ownerConfirmedHandoffAt: timestamp("owner_confirmed_handoff_at"),
  borrowerConfirmedHandoff: boolean("borrower_confirmed_handoff").default(false),
  borrowerConfirmedHandoffAt: timestamp("borrower_confirmed_handoff_at"),
  handoffConfirmDeadline: timestamp("handoff_confirm_deadline"), // deadline for second party to confirm
  handoffAutoAdvanced: boolean("handoff_auto_advanced").default(false), // true if auto-advanced after timeout
  handoffConfirmedAt: timestamp("handoff_confirmed_at"),
  borrowPeriodStartedAt: timestamp("borrow_period_started_at"),
  
  // Return tracking - dual confirmation
  ownerConfirmedReturn: boolean("owner_confirmed_return").default(false),
  ownerConfirmedReturnAt: timestamp("owner_confirmed_return_at"),
  borrowerConfirmedReturn: boolean("borrower_confirmed_return").default(false),
  borrowerConfirmedReturnAt: timestamp("borrower_confirmed_return_at"),
  returnConfirmDeadline: timestamp("return_confirm_deadline"),
  returnAutoAdvanced: boolean("return_auto_advanced").default(false),
  returnConditionOk: boolean("return_condition_ok"), // true if returned in same condition
  returnDisputeTriggered: boolean("return_dispute_triggered").default(false),
  returnDisputeReason: text("return_dispute_reason"),
  isEarlyReturn: boolean("is_early_return").default(false),
  
  // Return tracking
  returnRequestedAt: timestamp("return_requested_at"),
  returnConfirmedAt: timestamp("return_confirmed_at"),
  returnConditionNotes: text("return_condition_notes"),
  returnConditionRating: integer("return_condition_rating"), // 1-5 rating of return condition
  
  // Delay notification tracking (for avoiding late return penalties when borrower communicates)
  returnDelayNotifiedAt: timestamp("return_delay_notified_at"),
  returnDelayReason: text("return_delay_reason"),
  
  // Rental-specific fields
  rentalAmount: decimal("rental_amount", { precision: 10, scale: 2 }), // rental fee in dollars
  rentalProcessingFee: decimal("rental_processing_fee", { precision: 10, scale: 2 }), // 3% processing fee
  rentalPlatformFee: decimal("rental_platform_fee", { precision: 10, scale: 2 }), // platform commission (0% for 2025)
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  itemIdx: index("item_requests_item_id_idx").on(table.itemId),
  requesterIdx: index("item_requests_requester_id_idx").on(table.requesterId),
  statusIdx: index("item_requests_status_idx").on(table.status),
  createdIdx: index("item_requests_created_at_idx").on(table.createdAt),
}));

export const locationAlerts = pgTable("location_alerts", {
  id: serial("id").primaryKey(),
  userId: serial("user_id").references(() => users.id),
  keywords: text("keywords").array().notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 8 }),
  longitude: numeric("longitude", { precision: 11, scale: 8 }),
  radius: integer("radius").default(10), // in kilometers
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const swapMatches = pgTable("swap_matches", {
  id: serial("id").primaryKey(),
  requestId: serial("request_id").references(() => itemRequests.id),
  matchedItemId: serial("matched_item_id").references(() => items.id),
  matchScore: integer("match_score").notNull(),
  compatibility: text("compatibility").notNull(), // JSON string with matching details
  createdAt: timestamp("created_at").defaultNow(),
});

export const deliveryArrangements = pgTable("delivery_arrangements", {
  id: serial("id").primaryKey(),
  requestId: serial("request_id").references(() => itemRequests.id),
  deliveryType: text("delivery_type").notNull(),
  deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }),
  deliveryAddress: text("delivery_address"),
  deliveryDate: timestamp("delivery_date"),
  returnDate: timestamp("return_date"),
  securityDeposit: decimal("security_deposit", { precision: 10, scale: 2 }),
  depositPaid: boolean("deposit_paid").default(false),
  status: text("status").default("PENDING").notNull(),
  qrCodeData: text("qr_code_data"),
  specialInstructions: text("special_instructions"),
  riskAccepted: boolean("risk_accepted").default(false),
  // New fields for delivery and deposit method choices
  deliveryMethod: text("delivery_method"), // 'self_arrange' or 'shareswap_delivery'
  depositMethod: text("deposit_method"), // 'self_arrange' or 'shareswap_deposit'
  uberDeliveryId: text("uber_delivery_id"), // Uber Direct delivery ID
  uberQuoteId: text("uber_quote_id"), // Uber Direct quote ID
  uberTrackingUrl: text("uber_tracking_url"), // Tracking URL from Uber
  stripePaymentIntentId: text("stripe_payment_intent_id"), // Stripe payment hold ID
  stripeDepositStatus: text("stripe_deposit_status"), // 'authorized', 'captured', 'refunded', 'failed'
  deliveryMargin: decimal("delivery_margin", { precision: 10, scale: 2 }), // $2 margin for ShareSwap Delivery
  depositProcessingFee: decimal("deposit_processing_fee", { precision: 10, scale: 2 }), // 5% fee for ShareSwap Deposit
  uberDeliveryFee: decimal("uber_delivery_fee", { precision: 10, scale: 2 }), // Actual Uber charge
  totalDeliveryFee: decimal("total_delivery_fee", { precision: 10, scale: 2 }), // Uber fee + margin
  createdAt: timestamp("created_at").defaultNow(),
});

// Achievement System
export const achievements = pgTable("achievements", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  badgeIcon: text("badge_icon").notNull(),
  badgeColor: text("badge_color").notNull(),
  pointsRequired: integer("points_required"),
  category: text("category").notNull(), // 'lending', 'borrowing', 'social', 'milestone'
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userAchievements = pgTable("user_achievements", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  achievementId: integer("achievement_id").references(() => achievements.id),
  earnedAt: timestamp("earned_at").defaultNow(),
  progress: integer("progress").default(0),
  isCompleted: boolean("is_completed").default(false),
});

// Item Wishlists
export const wishlists = pgTable("wishlists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  itemName: text("item_name").notNull(),
  description: text("description"),
  category: text("category"),
  needType: text("need_type").default("borrow"), // comma-separated: 'borrow', 'rent', 'swap', 'gift'
  maxShareCoinPrice: decimal("max_share_coin_price", { precision: 10, scale: 2 }),
  maxDollarPrice: decimal("max_dollar_price", { precision: 10, scale: 2 }),
  preferredLocation: text("preferred_location"),
  neededDate: date("needed_date"),
  returnDate: date("return_date"),
  urgency: text("urgency").default("normal"), // 'low', 'normal', 'high', 'urgent'
  isActive: boolean("is_active").default(true),
  isPrivate: boolean("is_private").default(false), // Hide requester identity until they send a request
  createdAt: timestamp("created_at").defaultNow(),
});

// Referral System
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").references(() => users.id),
  referredUserId: integer("referred_user_id").references(() => users.id),
  referralCode: text("referral_code").notNull(),
  rewardAmount: decimal("reward_amount", { precision: 10, scale: 2 }).default("10.00"),
  isRewardClaimed: boolean("is_reward_claimed").default(false),
  completedFirstTransaction: boolean("completed_first_transaction").default(false),
  referrerDeviceFingerprint: text("referrer_device_fingerprint"), // Device fingerprint of the referrer at their last login
  referredDeviceFingerprint: text("referred_device_fingerprint"), // Device fingerprint of referred user at signup
  firstTransactionId: integer("first_transaction_id"), // ID of the qualifying transaction
  firstTransactionType: text("first_transaction_type"), // 'BORROW', 'RENT', 'SWAP', 'GIFT'
  rewardedAt: timestamp("rewarded_at"), // When the bonus was awarded
  createdAt: timestamp("created_at").defaultNow(),
});

// Premium Subscriptions
export const subscriptionPlans = pgTable("subscription_plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  monthlyPrice: decimal("monthly_price", { precision: 10, scale: 2 }).notNull(),
  annualPrice: decimal("annual_price", { precision: 10, scale: 2 }),
  features: text("features").array().notNull(),
  discountPercentage: integer("discount_percentage").default(10),
  priorityAccess: boolean("priority_access").default(true),
  lowerFees: boolean("lower_fees").default(true),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userSubscriptions = pgTable("user_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  planId: integer("plan_id").references(() => subscriptionPlans.id),
  startDate: timestamp("start_date").defaultNow(),
  endDate: timestamp("end_date").notNull(),
  paymentMethod: text("payment_method"), // 'card', 'paypal', etc.
  status: text("status").default("active"), // 'active', 'cancelled', 'expired'
  autoRenew: boolean("auto_renew").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const rentalPayouts = pgTable("rental_payouts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  requestId: integer("request_id").references(() => itemRequests.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  rentalAmount: decimal("rental_amount", { precision: 10, scale: 2 }).notNull(),
  platformFee: decimal("platform_fee", { precision: 10, scale: 2 }).default("0.00"),
  processingFee: decimal("processing_fee", { precision: 10, scale: 2 }).default("0.00"),
  netAmount: decimal("net_amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").default("pending"), // 'pending', 'held', 'released', 'paid_out', 'disputed'
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeTransferId: text("stripe_transfer_id"),
  holdUntil: timestamp("hold_until"),
  releasedAt: timestamp("released_at"),
  paidOutAt: timestamp("paid_out_at"),
  disputeStatus: text("dispute_status"),
  disputeReason: text("dispute_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const rentalPayoutRelations = relations(rentalPayouts, ({ one }) => ({
  user: one(users, {
    fields: [rentalPayouts.userId],
    references: [users.id],
  }),
  request: one(itemRequests, {
    fields: [rentalPayouts.requestId],
    references: [itemRequests.id],
  }),
}));

export const userRelations = relations(users, ({ many }) => ({
  verifications: many(verifications),
  sentMessages: many(messages, { relationName: "sender" }),
  receivedMessages: many(messages, { relationName: "receiver" }),
  items: many(items),
  itemVerifications: many(itemConditionVerifications, { relationName: "verifier" }),
  transactions: many(shareCoinsTransactions),
  challengeParticipations: many(challengeParticipants),
  reputationActivities: many(reputationActivities),
  receivedReviews: many(userReviews, { relationName: "reviewedUser" }),
  givenReviews: many(userReviews, { relationName: "reviewer" }),
}));

export const verificationRelations = relations(verifications, ({ one }) => ({
  user: one(users, {
    fields: [verifications.userId],
    references: [users.id],
  }),
}));

export const messageRelations = relations(messages, ({ one }) => ({
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
    relationName: "sender",
  }),
  receiver: one(users, {
    fields: [messages.receiverId],
    references: [users.id],
    relationName: "receiver",
  }),
}));

export const itemRelations = relations(items, ({ one, many }) => ({
  owner: one(users, {
    fields: [items.ownerId],
    references: [users.id],
  }),
  conditionVerifications: many(itemConditionVerifications),
  requests: many(itemRequests)
}));

export const itemConditionVerificationRelations = relations(itemConditionVerifications, ({ one }) => ({
  item: one(items, {
    fields: [itemConditionVerifications.itemId],
    references: [items.id],
  }),
  verifier: one(users, {
    fields: [itemConditionVerifications.verifierId],
    references: [users.id],
    relationName: "verifier",
  }),
}));

export const sponsoredGameRelations = relations(sponsoredGames, ({ many }) => ({
  sessions: many(gameSessions),
}));

export const gameSessionRelations = relations(gameSessions, ({ one }) => ({
  user: one(users, {
    fields: [gameSessions.userId],
    references: [users.id],
  }),
  game: one(sponsoredGames, {
    fields: [gameSessions.gameId],
    references: [sponsoredGames.id],
  }),
}));

export const userChallengeRelations = relations(users, ({ many }) => ({
  challengeParticipations: many(challengeParticipants),
}));

export const challengeRelations = relations(communityChallenges, ({ many }) => ({
  participants: many(challengeParticipants),
}));

export const challengeParticipantRelations = relations(challengeParticipants, ({ one }) => ({
  user: one(users, {
    fields: [challengeParticipants.userId],
    references: [users.id],
  }),
  challenge: one(communityChallenges, {
    fields: [challengeParticipants.challengeId],
    references: [communityChallenges.id],
  }),
}));

export const itemRequestRelations = relations(itemRequests, ({ one }) => ({
  item: one(items, {
    fields: [itemRequests.itemId],
    references: [items.id],
  }),
  requester: one(users, {
    fields: [itemRequests.requesterId],
    references: [users.id],
  }),
  deliveryArrangement: one(deliveryArrangements, {
    fields: [itemRequests.id],
    references: [deliveryArrangements.requestId],
  }),
}));

export const deliveryArrangementRelations = relations(deliveryArrangements, ({ one }) => ({
  request: one(itemRequests, {
    fields: [deliveryArrangements.requestId],
    references: [itemRequests.id],
  }),
}));

export const reputationActivityRelations = relations(reputationActivities, ({ one }) => ({
  user: one(users, {
    fields: [reputationActivities.userId],
    references: [users.id],
  }),
  item: one(items, {
    fields: [reputationActivities.itemId],
    references: [items.id],
  }),
}));

export const userReviewRelations = relations(userReviews, ({ one }) => ({
  reviewer: one(users, {
    fields: [userReviews.reviewerId],
    references: [users.id],
  }),
  reviewedUser: one(users, {
    fields: [userReviews.reviewedUserId],
    references: [users.id],
  }),
  transaction: one(itemRequests, {
    fields: [userReviews.transactionId],
    references: [itemRequests.id],
  }),
}));


export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect;

export const insertVerificationSchema = createInsertSchema(verifications);
export const selectVerificationSchema = createSelectSchema(verifications);
export type InsertVerification = typeof verifications.$inferInsert;
export type SelectVerification = typeof verifications.$inferSelect;

export const insertMessageSchema = createInsertSchema(messages);
export const selectMessageSchema = createSelectSchema(messages);
export type InsertMessage = typeof messages.$inferInsert;
export type SelectMessage = typeof messages.$inferSelect;

export const insertItemSchema = createInsertSchema(items);
export const selectItemSchema = createSelectSchema(items);
export type InsertItem = typeof items.$inferInsert;
export type SelectItem = typeof items.$inferSelect;

export const insertItemConditionVerificationSchema = createInsertSchema(itemConditionVerifications);
export const selectItemConditionVerificationSchema = createSelectSchema(itemConditionVerifications);
export type InsertItemConditionVerification = typeof itemConditionVerifications.$inferInsert;
export type SelectItemConditionVerification = typeof itemConditionVerifications.$inferSelect;

export const insertShareCoinsTransactionSchema = createInsertSchema(shareCoinsTransactions);
export const selectShareCoinsTransactionSchema = createSelectSchema(shareCoinsTransactions);
export type InsertShareCoinsTransaction = typeof shareCoinsTransactions.$inferInsert;
export type SelectShareCoinsTransaction = typeof shareCoinsTransactions.$inferSelect;

export const insertSponsoredGameSchema = createInsertSchema(sponsoredGames);
export const selectSponsoredGameSchema = createSelectSchema(sponsoredGames);
export type InsertSponsoredGame = typeof sponsoredGames.$inferInsert;
export type SelectSponsoredGame = typeof sponsoredGames.$inferSelect;

export const insertGameSessionSchema = createInsertSchema(gameSessions);
export const selectGameSessionSchema = createSelectSchema(gameSessions);
export type InsertGameSession = typeof gameSessions.$inferInsert;
export type SelectGameSession = typeof gameSessions.$inferSelect;

export const insertCommunityChallengechema = createInsertSchema(communityChallenges);
export const selectCommunityChallengechema = createSelectSchema(communityChallenges);
export type InsertCommunityChallenge = typeof communityChallenges.$inferInsert;
export type SelectCommunityChallenge = typeof communityChallenges.$inferSelect;

export const insertChallengeParticipantSchema = createInsertSchema(challengeParticipants);
export const selectChallengeParticipantSchema = createSelectSchema(challengeParticipants);
export type InsertChallengeParticipant = typeof challengeParticipants.$inferInsert;
export type SelectChallengeParticipant = typeof challengeParticipants.$inferSelect;

export const insertItemRequestSchema = createInsertSchema(itemRequests);
export const selectItemRequestSchema = createSelectSchema(itemRequests);
export type InsertItemRequest = typeof itemRequests.$inferInsert;
export type SelectItemRequest = typeof itemRequests.$inferSelect;

export const insertDeliveryArrangementSchema = createInsertSchema(deliveryArrangements);
export const selectDeliveryArrangementSchema = createSelectSchema(deliveryArrangements);
export type InsertDeliveryArrangement = typeof deliveryArrangements.$inferInsert;
export type SelectDeliveryArrangement = typeof deliveryArrangements.$inferSelect;

export const insertReputationActivitySchema = createInsertSchema(reputationActivities);
export const selectReputationActivitySchema = createSelectSchema(reputationActivities);
export type InsertReputationActivity = typeof reputationActivities.$inferInsert;
export type SelectReputationActivity = typeof reputationActivities.$inferSelect;

export const insertUserReviewSchema = createInsertSchema(userReviews);
export const selectUserReviewSchema = createSelectSchema(userReviews);
export type InsertUserReview = typeof userReviews.$inferInsert;
export type SelectUserReview = typeof userReviews.$inferSelect;


export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  type: varchar("type", { length: 50 }).notNull(), // 'item_request', 'request_accepted', 'request_declined', etc.
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  itemId: integer("item_id").references(() => items.id),
  requestId: integer("request_id").references(() => itemRequests.id),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("notifications_user_id_idx").on(table.userId),
  userReadIdx: index("notifications_user_read_idx").on(table.userId, table.isRead),
  createdIdx: index("notifications_created_at_idx").on(table.createdAt),
}));

export type InsertNotification = typeof notifications.$inferInsert;
export type SelectNotification = typeof notifications.$inferSelect;

