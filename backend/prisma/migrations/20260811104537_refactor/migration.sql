/*
  Warnings:

  - You are about to drop the column `batchName` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `costPrice` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `discount` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `expiryDate` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `manufacturingDate` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `mrp` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `sellingPrice` on the `Product` table. All the data in the column will be lost.
  - Added the required column `batchName` to the `PurchaseItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `expiryDate` to the `PurchaseItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `manufacturingDate` to the `PurchaseItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mrp` to the `PurchaseItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sellingPrice` to the `PurchaseItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "batchName",
DROP COLUMN "costPrice",
DROP COLUMN "discount",
DROP COLUMN "expiryDate",
DROP COLUMN "manufacturingDate",
DROP COLUMN "mrp",
DROP COLUMN "sellingPrice";

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "batchName" TEXT NOT NULL,
ADD COLUMN     "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "expiryDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "manufacturingDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "mrp" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "sellingPrice" DECIMAL(10,2) NOT NULL;
