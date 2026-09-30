# Reconcile duplicate badge awards

The `0006_unique_user_achievements.sql` startup migration refuses to create the unique index while any user/achievement pair has multiple rows. **Do not delete badges or rewards just to get the server running.** Take a database backup before repair, and arrange a maintenance window: application writes should be stopped until the report, repair, and index creation finish. This process is for the database the API actually uses; confirm the connection target before running it. Do not point a development command at production without the owner's authorization and a production backup. For Replit-managed production schema changes, use the Publish flow; do not run schema pushes against production.

1. On the affected database, run `pnpm --filter @workspace/api-server badges:duplicates report > badge-report.json`. Reporting is read-only and lists every duplicate group, full badge rows, the account balance, and *candidate* badge reward ledger rows and notifications for the account (including other achievements). Match candidates to the award using title, review attribution, and timestamps; a candidate is **not** automatically proof. Check other account ledger activity and possible spending before deciding whether a duplicate credit should be reversed.
2. Have an operator review **all** duplicate groups, select one canonical badge ID per pair, list *every* other badge ID, and explicitly identify confirmed reward and notification IDs. Empty lists mean the operator checked and found none attributable. No coin or notification row is removed. Determine the account's current expected balance and desired target balance; do not blindly subtract one per badge (balances may have been spent or changed by other awards). If several groups belong to one account, use the same expected and target balance in every group. Record the reasoning in the plan's `reason`.
3. Example `badge-plan.json` (use IDs and balances from your report, not these examples):

   ```json
   {
     "reason": "Reviewed both badge awards and account ledger; second credit was spent, so preserve balance.",
     "groups": [{
       "userId": 42,
       "achievementId": 7,
       "canonicalBadgeId": 101,
       "duplicateBadgeIds": [102],
       "rewardTransactionIds": [203, 204],
       "notificationIds": [301, 302],
       "expectedShareCoins": "5.00",
       "targetShareCoins": "5.00"
     }]
   }
   ```

4. Run `pnpm --filter @workspace/api-server badges:duplicates apply badge-plan.json --operator <operator-name>`. The repair checks that the plan covers **all** live duplicate groups, all listed badge IDs still match, selected effects still belong to the account and match the report, and each account balance still matches. It locks badge writes and affected accounts, and does everything in one transaction. A mismatch rolls the whole transaction back. Removed badge rows are preserved in `duplicate_badge_reconciliation_audits` along with the kept badge, confirmed ledger/notification snapshots, operator, reason, and balances. Original rewards and notifications remain in their tables. If the target differs, a signed `ADJUSTMENT` ledger entry records the difference and the balance is set to the reviewed target. Finally it creates the unique index in the same transaction. Re-running an old plan fails closed because the duplicate groups no longer exist; inspect the audit instead.
5. Re-run `badges:duplicates report` (expect zero groups), inspect the audit and the preserved ledger/notifications, then restart the API or proceed with normal schema publication. The startup migration is still a backstop against unreconciled data. Do not edit the audit or discard the backup until the reconciled balances and badge history have been reviewed.

The ledger has no badge ID column. The report searches badge reward descriptions and review IDs across the account, plus all badge notifications for the account; old descriptions that do not start with `Badge unlocked: ` or use an attributed review ID require a separate ledger investigation. It cannot uniquely assign older same-title effects to one of several duplicate rows. The audit records **reviewed effects for the group**, not a claim that a particular reward belongs to a particular badge row.