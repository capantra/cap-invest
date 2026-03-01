-- CreateEnum
CREATE TYPE "PreInvestorInstrument" AS ENUM ('NONE', 'SAFE', 'NOTE');

-- CreateEnum
CREATE TYPE "InvestorInstrumentType" AS ENUM ('SAFE', 'NOTE');

-- CreateEnum
CREATE TYPE "InvestorInstrumentStatus" AS ENUM ('OUTSTANDING', 'CONVERTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preInvestorInstrument" "PreInvestorInstrument" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "preInvestorNotes" TEXT;

-- CreateTable
CREATE TABLE "InvestorInstrument" (
    "id" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "type" "InvestorInstrumentType" NOT NULL,
    "status" "InvestorInstrumentStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "instrumentRef" TEXT NOT NULL,
    "refYear" INTEGER NOT NULL,
    "refSeq" INTEGER NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "purchaseAmountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "discountPercent" INTEGER,
    "convertedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestorInstrument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvestorInstrument_instrumentRef_key" ON "InvestorInstrument"("instrumentRef");

-- CreateIndex
CREATE INDEX "InvestorInstrument_investorId_type_idx" ON "InvestorInstrument"("investorId", "type");

-- CreateIndex
CREATE INDEX "InvestorInstrument_status_signedAt_idx" ON "InvestorInstrument"("status", "signedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvestorInstrument_type_refYear_refSeq_key" ON "InvestorInstrument"("type", "refYear", "refSeq");

-- AddForeignKey
ALTER TABLE "InvestorInstrument" ADD CONSTRAINT "InvestorInstrument_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
