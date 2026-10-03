import { db, notifications, shareCoinsTransactions, userAchievements, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

type BadgeAward = {
  userId: number;
  achievementId: number;
  title: string;
  description: string;
  reviewId?: number;
};

// The unique badge insert is the claim. Only the transaction that claims it
// can create the corresponding reward and notification.
export async function awardAchievementOnce(award: BadgeAward, reviewTx?: any): Promise<boolean> {
  const apply = async (executor: any) => {
    const [inserted] = await executor.insert(userAchievements).values({
      userId: award.userId,
      achievementId: award.achievementId,
      isCompleted: true,
      progress: 100,
      reviewId: award.reviewId,
    }).onConflictDoNothing({
      target: [userAchievements.userId, userAchievements.achievementId],
    }).returning({ id: userAchievements.id });
    if (!inserted) return false;

    await executor.insert(shareCoinsTransactions).values({
      userId: award.userId,
      amount: "1",
      description: `Badge unlocked: ${award.title}`,
      transactionType: "EARNED",
      reviewId: award.reviewId,
    });
    await executor.update(users).set({ shareCoins: sql`share_coins + 1` }).where(eq(users.id, award.userId));
    await executor.insert(notifications).values({
      userId: award.userId,
      type: "badge_earned",
      title: `🏅 Badge Unlocked: ${award.title}`,
      message: `+1 ShareCoin earned. ${award.description}`,
      link: "/achievements",
      isRead: false,
      reviewId: award.reviewId,
    });
    return true;
  };

  return reviewTx ? apply(reviewTx) : db.transaction(apply);
}