BEGIN;
ALTER TABLE "User" ADD COLUMN "adultConfirmedAt" TIMESTAMP(3);
CREATE TYPE "AiGenerationStatus" AS ENUM ('QUEUED','RUNNING','READY','FAILED','EXPIRED','DELETED');
CREATE TABLE "AiGeneration" (
 "id" UUID PRIMARY KEY,
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "idempotencyKey" UUID NOT NULL, "requestHash" CHAR(64) NOT NULL,
 "status" "AiGenerationStatus" NOT NULL DEFAULT 'QUEUED', "model" VARCHAR(120) NOT NULL,
 "input" JSONB, "result" JSONB, "acceptance" JSONB, "failureCode" VARCHAR(60),
 "providerAttempts" INTEGER NOT NULL DEFAULT 0 CHECK ("providerAttempts" BETWEEN 0 AND 2),
 "charged" BOOLEAN NOT NULL DEFAULT false, "quotaDay" CHAR(10) NOT NULL,
 "deadlineAt" TIMESTAMP(3) NOT NULL, "resultExpiresAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, "completedAt" TIMESTAMP(3),
 CONSTRAINT "AiGeneration_active_payload" CHECK ("status" NOT IN ('QUEUED','RUNNING') OR "input" IS NOT NULL),
 CONSTRAINT "AiGeneration_terminal_source" CHECK ("status" IN ('QUEUED','RUNNING') OR "input" IS NULL)
);
CREATE UNIQUE INDEX "AiGeneration_userId_idempotencyKey_key" ON "AiGeneration"("userId","idempotencyKey");
CREATE UNIQUE INDEX "AiGeneration_one_active_user" ON "AiGeneration"("userId") WHERE "status" IN ('QUEUED','RUNNING');
CREATE INDEX "AiGeneration_userId_quotaDay_charged_idx" ON "AiGeneration"("userId","quotaDay","charged");
CREATE INDEX "AiGeneration_status_createdAt_idx" ON "AiGeneration"("status","createdAt");
CREATE INDEX "AiGeneration_resultExpiresAt_idx" ON "AiGeneration"("resultExpiresAt");
CREATE TABLE "AiUsageBucket" ("day" CHAR(10) PRIMARY KEY, "providerCalls" INTEGER NOT NULL DEFAULT 0 CHECK ("providerCalls">=0));
CREATE TABLE "AiDispatch" ("id" VARCHAR(20) PRIMARY KEY, "jobId" UUID, "leaseUntil" TIMESTAMP(3), "nextCallAt" TIMESTAMP(3));
COMMIT;
