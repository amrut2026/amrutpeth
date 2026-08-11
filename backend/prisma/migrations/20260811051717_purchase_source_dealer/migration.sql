-- DropForeignKey
ALTER TABLE "Purchase" DROP CONSTRAINT "Purchase_supplierId_fkey";

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "sourceDealerId" INTEGER,
ALTER COLUMN "supplierId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_sourceDealerId_fkey" FOREIGN KEY ("sourceDealerId") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
