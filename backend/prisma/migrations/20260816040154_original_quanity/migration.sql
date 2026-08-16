-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "originalQuantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "originalQuantity" INTEGER;
