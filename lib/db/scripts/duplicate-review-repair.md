# Duplicate review repair

The unique review migration intentionally stops when it finds more than one
review from the same reviewer for the same transaction. Use the repair command
to inspect and reconcile those records before restarting the API.

## 1. Create a read-only report

```sh
pnpm --filter @workspace/api-server run reviews:duplicates report > duplicate-reviews.json
```

The report includes every duplicate review plus conservative candidates for
review-derived reputation activities, level rewards, notifications, and
achievements. Candidate effects are never selected automatically.

## 2. Review and write a repair plan

Choose the review whose content should remain. Include only effect IDs that an
operator has confirmed came from the reviews being removed.

For every user whose selected reputation or ShareCoin effects will be removed,
provide the current value shown in the report and the operator-approved target.
Explicit targets are required because score caps/floors and later ShareCoin
spending make arithmetic reversal unsafe.

```json
{
  "reason": "Legacy retries created duplicate reviews and duplicate effects.",
  "userReconciliations": [
    {
      "userId": 34,
      "expectedReputationScore": 500,
      "targetReputationScore": 500,
      "expectedShareCoins": "2.00",
      "targetShareCoins": "0.00"
    }
  ],
  "repairs": [
    {
      "reviewerId": 12,
      "transactionId": 345,
      "canonicalReviewId": 678,
      "reputationActivityIds": [901, 902],
      "shareCoinTransactionIds": [903],
      "notificationIds": [904, 905],
      "userAchievementIds": []
    }
  ]
}
```

The plan must cover every duplicate group in the current database. This avoids
partially repairing an environment and then assuming the uniqueness migration
can run.

## 3. Apply the reviewed plan

```sh
pnpm --filter @workspace/api-server run reviews:duplicates apply repair-plan.json \
  --operator "operator name"
```

Apply mode:

- locks review submissions while validating the complete plan;
- verifies every selected effect is one of the report candidates;
- rejects effect IDs selected by multiple groups and any stale selected row;
- retains the selected canonical review and snapshots removed content;
- removes only explicitly selected derived effects;
- verifies current totals and sets the approved reputation scores, levels, and
  ShareCoin balances exactly;
- records the operator, reason, removed rows, and adjustments in
  `duplicate_review_repair_audits`;
- verifies no duplicate groups remain and creates the uniqueness index; and
- commits all changes together or rolls everything back.

Running the same reviewed plan again returns `already_repaired` after checking
its audit records and makes no further changes.