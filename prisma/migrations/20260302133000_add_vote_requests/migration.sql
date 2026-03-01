-- Create enums
CREATE TYPE "VoteStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "VoteChoice" AS ENUM ('FOR', 'AGAINST', 'ABSTAIN');

-- Vote requests
CREATE TABLE "VoteRequest" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "VoteStatus" NOT NULL DEFAULT 'OPEN',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closesAt" TIMESTAMP(3),

  CONSTRAINT "VoteRequest_pkey" PRIMARY KEY ("id")
);

-- Vote attachments
CREATE TABLE "VoteAttachment" (
  "id" TEXT NOT NULL,
  "voteRequestId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VoteAttachment_pkey" PRIMARY KEY ("id")
);

-- Vote responses
CREATE TABLE "VoteResponse" (
  "id" TEXT NOT NULL,
  "voteRequestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "choice" "VoteChoice" NOT NULL,
  "legalName" TEXT NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VoteResponse_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "VoteRequest_status_idx" ON "VoteRequest"("status");
CREATE INDEX "VoteRequest_createdAt_idx" ON "VoteRequest"("createdAt");
CREATE INDEX "VoteAttachment_voteRequestId_idx" ON "VoteAttachment"("voteRequestId");
CREATE INDEX "VoteResponse_userId_idx" ON "VoteResponse"("userId");

-- Unique constraint
CREATE UNIQUE INDEX "VoteResponse_voteRequestId_userId_key" ON "VoteResponse"("voteRequestId", "userId");

-- Foreign keys
ALTER TABLE "VoteRequest" ADD CONSTRAINT "VoteRequest_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VoteAttachment" ADD CONSTRAINT "VoteAttachment_voteRequestId_fkey" FOREIGN KEY ("voteRequestId") REFERENCES "VoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoteResponse" ADD CONSTRAINT "VoteResponse_voteRequestId_fkey" FOREIGN KEY ("voteRequestId") REFERENCES "VoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoteResponse" ADD CONSTRAINT "VoteResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
