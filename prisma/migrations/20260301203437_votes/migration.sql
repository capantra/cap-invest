-- DropForeignKey
ALTER TABLE "VoteResponse" DROP CONSTRAINT "VoteResponse_userId_fkey";

-- AddForeignKey
ALTER TABLE "VoteResponse" ADD CONSTRAINT "VoteResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
