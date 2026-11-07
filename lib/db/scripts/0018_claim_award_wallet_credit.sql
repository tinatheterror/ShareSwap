-- A claim award (the retained part of a deposit) is credited to the owner's wallet (users.rental_balance) in the same
-- transaction that marks the settlement operation SETTLED. These two columns record that credit on the operation row,
-- so a settlement is credited at most once and the credit can be told apart from rental earnings. Null = nothing credited
-- (operations from before this, and settlements that retained nothing). Idempotent.
ALTER TABLE deposit_settlement_operations ADD COLUMN IF NOT EXISTS wallet_credited_amount numeric(10, 2);
ALTER TABLE deposit_settlement_operations ADD COLUMN IF NOT EXISTS wallet_credited_at timestamp;
