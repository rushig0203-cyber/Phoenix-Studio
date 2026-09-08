ALTER TABLE "ContentManagerState" ADD COLUMN "dailyTarget" INTEGER NOT NULL DEFAULT 28;
ALTER TABLE "ContentManagerState" ADD COLUMN "dailyMinimum" INTEGER NOT NULL DEFAULT 25;
ALTER TABLE "ContentManagerState" ADD COLUMN "dailyMaximum" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "ContentManagerState" ADD COLUMN "boosterDate" TEXT;
ALTER TABLE "ContentManagerState" ADD COLUMN "boosterStartedAt" TIMESTAMP(3);
ALTER TABLE "ContentManagerState" ADD COLUMN "boosterCompletedAt" TIMESTAMP(3);
ALTER TABLE "ContentManagerState" ADD COLUMN "lastCycleAt" TIMESTAMP(3);
ALTER TABLE "ContentManagerState" ADD COLUMN "dailyCreatedCount" INTEGER NOT NULL DEFAULT 0;
