import { pgTable, text, serial, boolean, timestamp, integer, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  isVerified: boolean("is_verified").default(false),
  shareCoins: decimal("share_coins").default("0"),
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
  ownerId: serial("owner_id").references(() => users.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  conditionRating: integer("condition_rating").notNull(),
  photos: text("photos").array().notNull(),
  securityDeposit: decimal("security_deposit").notNull(),
  lendingDuration: integer("lending_duration").notNull(), // in days
  shareCoinsReward: decimal("share_coins_reward").notNull(),
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
  status: text("status").default("pending"), // pending, approved, rejected
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
  userId: serial("user_id").references(() => users.id),
  amount: decimal("amount").notNull(),
  description: text("description").notNull(),
  transactionType: text("transaction_type").notNull(), // "EARNED" or "SPENT"
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const userRelations = relations(users, ({ many }) => ({
  verifications: many(verifications),
  sentMessages: many(messages, { relationName: "sender" }),
  receivedMessages: many(messages, { relationName: "receiver" }),
  items: many(items),
  itemVerifications: many(itemConditionVerifications, { relationName: "verifier" }),
  transactions: many(shareCoinsTransactions),
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

// Schemas
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