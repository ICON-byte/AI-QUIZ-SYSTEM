BEGIN;
ALTER TABLE "AiGeneration"
  ADD COLUMN "summary" JSONB,
  ADD COLUMN "summaryExpiresAt" TIMESTAMP(3),
  ADD COLUMN "diagnostics" JSONB,
  ADD COLUMN "phase" VARCHAR(30) NOT NULL DEFAULT 'QUEUED';
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_phase_check"
 CHECK ("phase" IN ('QUEUED', 'PACING', 'CALLING', 'RECOVERING'));
COMMIT;
