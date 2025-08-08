import { pgTable, text, serial, boolean, timestamp, integer, decimal, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  isVerified: boolean("is_verified").default(false),
  shareCoins: decimal("share_coins", { precision: 10, scale: 2 }).default("0.00"),
  reputationScore: integer("reputation_score").default(0),
  reputationLevel: text("reputation_level").default("Newcomer"),
  isPremium: boolean("is_premium").default(false),
  premiumExpiresAt: timestamp("premium_expires_at"),
  referralCode: text("referral_code").unique(),
  referredBy: integer("referred_by"),
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
  transactionId: integer("transaction_id").references(() => itemRequests.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: serial("id").primaryKey(),
  userId: serial("user_id").references(() => users.id),
  fullName: text("full_name").notNull(),
  idNumber: text("id_number").notNull(),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").references(() => users.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
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
  securityDeposit: decimal("security_deposit"),
  lendingDuration: integer("lending_duration"),
  shareCoinsReward: decimal("share_coins_reward").notNull(),
  shareCoinPrice: decimal("share_coin_price", { precision: 10, scale: 2 }),
  dollarsPrice: decimal("dollars_price", { precision: 10, scale: 2 }),
  isAvailable: boolean("is_available").default(true),
  isConditionVerified: boolean("is_condition_verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

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
  createdAt: timestamp("created_at").defaultNow(),
});

export const shareCoinsTransactions = pgTable("share_coins_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  amount: decimal("amount").notNull(),
  description: text("description").notNull(),
  transactionType: text("transaction_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

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
  message: text("message"),
  matchScore: integer("match_score"), // AI matching score for swap requests
  createdAt: timestamp("created_at").defaultNow(),
});

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
  maxShareCoinPrice: decimal("max_share_coin_price", { precision: 10, scale: 2 }),
  maxDollarPrice: decimal("max_dollar_price", { precision: 10, scale: 2 }),
  preferredLocation: text("preferred_location"),
  urgency: text("urgency").default("normal"), // 'low', 'normal', 'high', 'urgent'
  isActive: boolean("is_active").default(true),
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