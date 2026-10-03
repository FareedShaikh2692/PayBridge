-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "persistent" BOOLEAN NOT NULL DEFAULT true;

-- Human-readable, sequential payment references: PB-<year>-<6 digits>.
CREATE SEQUENCE IF NOT EXISTS payment_reference_seq START WITH 400;
