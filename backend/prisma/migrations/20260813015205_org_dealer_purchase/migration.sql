/*
  Warnings:

  - Added the required column `dealerId` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Dealer" ADD COLUMN     "organizationId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "dealerId" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "Dealer" ADD CONSTRAINT "Dealer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organisation"("orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
