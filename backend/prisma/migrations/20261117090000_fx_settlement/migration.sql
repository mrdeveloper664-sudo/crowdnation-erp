-- Foreign-currency settlement (realised FX gain/loss)
ALTER TABLE "settlements" ADD COLUMN "currency" VARCHAR(3),
ADD COLUMN "exchange_rate" DECIMAL(19,8) NOT NULL DEFAULT 1,
ADD COLUMN "fx_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN "fx_journal_entry_id" UUID;

ALTER TABLE "settlement_allocations" ADD COLUMN "base_amount" DECIMAL(19,4);

-- NULL base_amount means a base-currency allocation: it clears exactly its own amount (no backfill needed;
-- an UPDATE here would also be filtered out by row level security).
