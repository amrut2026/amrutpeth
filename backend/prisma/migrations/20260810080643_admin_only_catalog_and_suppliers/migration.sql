/*
  Warnings:

  - You are about to drop the column `dealerId` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `ownerType` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `retailerId` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `supplierName` on the `Purchase` table. All the data in the column will be lost.
  - Added the required column `supplierId` to the `Purchase` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_dealerId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_retailerId_fkey";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "dealerId",
DROP COLUMN "ownerType",
DROP COLUMN "retailerId";

-- AlterTable
ALTER TABLE "Purchase" DROP COLUMN "supplierName",
ADD COLUMN     "supplierId" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "gstNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
