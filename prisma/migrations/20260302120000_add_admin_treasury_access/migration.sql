-- Add treasury access flag to users and invites
ALTER TABLE "User" ADD COLUMN "canViewTreasury" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invite" ADD COLUMN "canViewTreasury" BOOLEAN NOT NULL DEFAULT false;
