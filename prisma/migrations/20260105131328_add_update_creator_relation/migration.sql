-- AddForeignKey
ALTER TABLE "Update" ADD CONSTRAINT "Update_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
