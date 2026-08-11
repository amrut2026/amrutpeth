-- CreateTable
CREATE TABLE "SupplierBankAccount" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,

    CONSTRAINT "SupplierBankAccount_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SupplierBankAccount" ADD CONSTRAINT "SupplierBankAccount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
