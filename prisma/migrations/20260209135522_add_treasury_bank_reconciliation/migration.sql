-- CreateEnum
CREATE TYPE "BankAccountProvider" AS ENUM ('BASIQ');

-- CreateEnum
CREATE TYPE "TransactionReconciliationStatus" AS ENUM ('UNRECONCILED', 'RECONCILED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "provider" "BankAccountProvider" NOT NULL DEFAULT 'BASIQ',
    "basiqAccountId" TEXT NOT NULL,
    "basiqConnectionId" TEXT,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT,
    "bsb" TEXT,
    "institution" TEXT,
    "accountType" TEXT,
    "currentBalanceCents" INTEGER,
    "availableBalanceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "lastSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "basiqTransactionId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "transactionType" "TransactionType" NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "postDate" TIMESTAMP(3),
    "category" TEXT,
    "merchant" TEXT,
    "reference" TEXT,
    "balance" INTEGER,
    "isReconciled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionReconciliation" (
    "id" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "status" "TransactionReconciliationStatus" NOT NULL DEFAULT 'UNRECONCILED',
    "expectedAmountCents" INTEGER NOT NULL,
    "actualAmountCents" INTEGER NOT NULL,
    "varianceCents" INTEGER NOT NULL,
    "instrumentId" TEXT,
    "shareholdingId" TEXT,
    "notes" TEXT,
    "reconciledBy" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "disputeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_basiqAccountId_key" ON "BankAccount"("basiqAccountId");

-- CreateIndex
CREATE INDEX "BankAccount_provider_basiqAccountId_idx" ON "BankAccount"("provider", "basiqAccountId");

-- CreateIndex
CREATE INDEX "BankAccount_isActive_idx" ON "BankAccount"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_basiqTransactionId_key" ON "BankTransaction"("basiqTransactionId");

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_transactionDate_idx" ON "BankTransaction"("bankAccountId", "transactionDate");

-- CreateIndex
CREATE INDEX "BankTransaction_isReconciled_idx" ON "BankTransaction"("isReconciled");

-- CreateIndex
CREATE INDEX "BankTransaction_transactionDate_idx" ON "BankTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX "TransactionReconciliation_investorId_status_idx" ON "TransactionReconciliation"("investorId", "status");

-- CreateIndex
CREATE INDEX "TransactionReconciliation_status_idx" ON "TransactionReconciliation"("status");

-- CreateIndex
CREATE INDEX "TransactionReconciliation_bankTransactionId_idx" ON "TransactionReconciliation"("bankTransactionId");

-- CreateIndex
CREATE INDEX "TransactionReconciliation_reconciledAt_idx" ON "TransactionReconciliation"("reconciledAt");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionReconciliation" ADD CONSTRAINT "TransactionReconciliation_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionReconciliation" ADD CONSTRAINT "TransactionReconciliation_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionReconciliation" ADD CONSTRAINT "TransactionReconciliation_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionReconciliation" ADD CONSTRAINT "TransactionReconciliation_reconciledBy_fkey" FOREIGN KEY ("reconciledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
