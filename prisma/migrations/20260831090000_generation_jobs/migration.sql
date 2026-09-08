CREATE TABLE "GenerationJob" ("id" TEXT NOT NULL,"userId" TEXT NOT NULL,"projectId" TEXT NOT NULL,"providerTaskId" TEXT,"status" TEXT NOT NULL DEFAULT 'QUEUED',"progress" INTEGER NOT NULL DEFAULT 0,"requestJson" TEXT NOT NULL,"error" TEXT,"outputS3Key" TEXT,"thumbnailS3Key" TEXT,"duration" DOUBLE PRECISION NOT NULL DEFAULT 0,"retryCount" INTEGER NOT NULL DEFAULT 0,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "GenerationJob_projectId_key" ON "GenerationJob"("projectId");
CREATE UNIQUE INDEX "GenerationJob_providerTaskId_key" ON "GenerationJob"("providerTaskId");
CREATE INDEX "GenerationJob_userId_status_createdAt_idx" ON "GenerationJob"("userId","status","createdAt");
CREATE INDEX "GenerationJob_status_updatedAt_idx" ON "GenerationJob"("status","updatedAt");
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
