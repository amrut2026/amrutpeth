/*
  Warnings:

  - A unique constraint covering the columns `[productId,ownerType,dealerId,retailerId,batchName]` on the table `Inventory` will be added. If there are existing duplicate values, this will fail.
  - Made the column `batchName` on table `Inventory` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "Inventory_productId_ownerType_dealerId_retailerId_key";

-- AlterTable
ALTER TABLE "Inventory" ALTER COLUMN "batchName" SET NOT NULL,
ALTER COLUMN "batchName" SET DEFAULT '';

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "batchName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_productId_ownerType_dealerId_retailerId_batchName_key" ON "Inventory"("productId", "ownerType", "dealerId", "retailerId", "batchName");
