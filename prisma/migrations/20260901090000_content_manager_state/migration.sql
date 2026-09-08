CREATE TABLE "ContentManagerState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "minReady" INTEGER NOT NULL DEFAULT 10,
  "targetReady" INTEGER NOT NULL DEFAULT 12,
  "maxReady" INTEGER NOT NULL DEFAULT 14,
  "maxConcurrent" INTEGER NOT NULL DEFAULT 3,
  "theme" TEXT NOT NULL DEFAULT 'business-money',
  "lastPlannedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "pausedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentManagerState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContentManagerState_userId_key" ON "ContentManagerState"("userId");
ALTER TABLE "ContentManagerState" ADD CONSTRAINT "ContentManagerState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
