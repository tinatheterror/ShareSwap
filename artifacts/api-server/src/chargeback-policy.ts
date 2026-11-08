/**
 * Launch policy for chargebacks: ShareSwap absorbs the loss and Stripe's dispute fee. An owner is never charged automatically.
 *
 * The earlier design (wallet-chargebacks.ts: take the owner's share of a disputed payment, and the fee, from the wallet, with the
 * rest as a debt) is kept in the code behind this switch and is OFF unless CHARGEBACK_RECOVERY_FROM_OWNERS is "true". With it off
 * the dispute webhook still records every dispute on the platform side (platform-disputes.ts) and touches no wallet.
 *
 * What stays possible with the switch off is a manual recovery debt an admin records against a member for proven fraud or
 * misconduct (createRecoveryDebt in wallet-chargebacks.ts). That is a decision about a person, never a side effect of a webhook.
 */
export const OWNER_CHARGEBACK_RECOVERY_ENV = "CHARGEBACK_RECOVERY_FROM_OWNERS";

/** Read on every call so a deploy that flips the variable needs no code change, and tests can switch it. */
export function ownerChargebackRecoveryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env[OWNER_CHARGEBACK_RECOVERY_ENV] ?? "").trim().toLowerCase() === "true";
}
