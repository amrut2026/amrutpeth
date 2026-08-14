/*
  Warnings:

  - Added the required column `retailerSellingPrice` to the `PurchaseItem` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'CONFIRMED', 'RECEIVED');

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "retailerSellingPrice" DECIMAL(10,2) NOT NULL;
