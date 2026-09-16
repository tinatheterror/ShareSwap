type TransactionRunner = {
  transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
};

export function persistReviewAtomically<T>(
  database: TransactionRunner,
  callback: (tx: any) => Promise<T>,
): Promise<T> {
  return database.transaction(callback);
}

export async function runNonCriticalReviewSideEffect(
  name: string,
  callback: () => Promise<void>,
): Promise<void> {
  try {
    await callback();
  } catch (error) {
    console.error(`Non-critical review side effect failed (${name}):`, error);
  }
}

export async function applyRequiredLowReviewPenalty<T>({
  rating,
  cleanedTags,
  applyPenalty,
}: {
  rating: number;
  cleanedTags: string[];
  applyPenalty: (rating: 1 | 2, negativeTags: string[]) => Promise<T>;
}): Promise<T | null> {
  const negativeTags = cleanedTags.filter((tag) =>
    ["late_return", "issue_reported"].includes(tag),
  );
  if ((rating !== 1 && rating !== 2) || negativeTags.length === 0) {
    return null;
  }
  return applyPenalty(rating, negativeTags);
}