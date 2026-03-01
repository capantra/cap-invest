-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_updateId_fkey";

-- DropForeignKey
ALTER TABLE "UpdateTag" DROP CONSTRAINT "UpdateTag_tagId_fkey";

-- DropForeignKey
ALTER TABLE "UpdateTag" DROP CONSTRAINT "UpdateTag_updateId_fkey";

-- AddForeignKey
ALTER TABLE "UpdateTag" ADD CONSTRAINT "UpdateTag_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "Update"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateTag" ADD CONSTRAINT "UpdateTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "Update"("id") ON DELETE CASCADE ON UPDATE CASCADE;
