-- CreateEnum
CREATE TYPE "ShareholdingType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateTable
CREATE TABLE "ShareholdingProfile" (
    "userId" TEXT NOT NULL,
    "shareholdingType" "ShareholdingType" NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "contactFirstName" TEXT,
    "contactLastName" TEXT,
    "businessName" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "suburbOrCity" TEXT NOT NULL,
    "stateOrRegion" TEXT,
    "postcode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'AU',
    "sharesTotal" INTEGER NOT NULL DEFAULT 0,
    "pricePerShare" DECIMAL(18,6) NOT NULL,
    "unpaidPerShare" DECIMAL(18,6),
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareholdingProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "ShareholdingProfile_shareholdingType_idx" ON "ShareholdingProfile"("shareholdingType");

-- CreateIndex
CREATE INDEX "ShareholdingProfile_country_idx" ON "ShareholdingProfile"("country");

-- AddForeignKey
ALTER TABLE "ShareholdingProfile" ADD CONSTRAINT "ShareholdingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
