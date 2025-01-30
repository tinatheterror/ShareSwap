import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  isVerified: boolean("is_verified").default(false),
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

export const userRelations = relations(users, ({ many }) => ({
  verifications: many(verifications),
}));

export const verificationRelations = relations(verifications, ({ one }) => ({
  user: one(users, {
    fields: [verifications.userId],
    references: [users.id],
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
