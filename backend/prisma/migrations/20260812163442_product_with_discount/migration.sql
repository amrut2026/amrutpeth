/*
  Warnings:

  - Added the required column `dealerCommission` to the `PurchaseItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "dealerCommission" DECIMAL(5,2) NOT NULL;
