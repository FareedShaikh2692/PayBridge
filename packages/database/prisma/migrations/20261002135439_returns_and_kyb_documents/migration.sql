-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'RETURNED';

-- AlterEnum
ALTER TYPE "ProviderPaymentStatus" ADD VALUE 'RETURNED';

-- AlterTable
ALTER TABLE "kyb_documents" ADD COLUMN     "size_bytes" INTEGER,
ADD COLUMN     "uploaded_by" UUID;
