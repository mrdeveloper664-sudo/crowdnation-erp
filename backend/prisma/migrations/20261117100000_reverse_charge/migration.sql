-- UAE VAT reverse charge
ALTER TABLE "tax_rates" ADD COLUMN "is_reverse_charge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tax_transactions" ADD COLUMN "is_reverse_charge" BOOLEAN NOT NULL DEFAULT false;
