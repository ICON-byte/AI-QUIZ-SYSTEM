BEGIN;
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');
CREATE TABLE "QuestionBank" (
  "id" UUID PRIMARY KEY, "ownerId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "courseId" UUID REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "title" VARCHAR(150) NOT NULL CHECK (length(btrim("title")) > 0),
  "description" VARCHAR(2000) NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "archivedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "QuestionBank_ownerId_archivedAt_createdAt_idx" ON "QuestionBank"("ownerId", "archivedAt", "createdAt");
CREATE INDEX "QuestionBank_courseId_idx" ON "QuestionBank"("courseId");
CREATE FUNCTION valid_bank_options(values_in TEXT[]) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
  SELECT coalesce(array_ndims(values_in) = 1 AND array_lower(values_in, 1) = 1 AND cardinality(values_in) = 4
    AND (SELECT count(DISTINCT lower(btrim(v))) = 4 AND bool_and(v IS NOT NULL AND length(btrim(v)) BETWEEN 1 AND 500) FROM unnest(values_in) v), false)
$$;
CREATE TABLE "Question" (
  "id" UUID PRIMARY KEY, "bankId" UUID NOT NULL REFERENCES "QuestionBank"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "prompt" VARCHAR(2000) NOT NULL CHECK (length(btrim("prompt")) > 0),
  "options" VARCHAR(500)[] NOT NULL CHECK (valid_bank_options("options")),
  "correctOption" INTEGER NOT NULL CHECK ("correctOption" BETWEEN 0 AND 3),
  "explanation" VARCHAR(2000) NOT NULL DEFAULT '', "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
  "topic" VARCHAR(100) NOT NULL DEFAULT '', "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "archivedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Question_bankId_archivedAt_difficulty_createdAt_idx" ON "Question"("bankId", "archivedAt", "difficulty", "createdAt");
CREATE TABLE "CsvImportReceipt" (
  "id" CHAR(64) PRIMARY KEY, "bankId" UUID NOT NULL REFERENCES "QuestionBank"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "importedCount" INTEGER NOT NULL CHECK ("importedCount" BETWEEN 1 AND 200),
  "skippedCount" INTEGER NOT NULL CHECK ("skippedCount" BETWEEN 0 AND 200),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CsvImportReceipt_bankId_createdAt_idx" ON "CsvImportReceipt"("bankId", "createdAt");
CREATE FUNCTION guard_bank_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE allowed BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."ownerId" <> OLD."ownerId" THEN
    RAISE EXCEPTION 'Bank ownership is immutable';
  END IF;
  IF NEW."courseId" IS NOT NULL THEN
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I."Course" c JOIN %I."User" u ON u.id=$1 WHERE c.id=$2 AND c."ownerId"=$1 AND u.role=''LECTURER'')', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
      INTO allowed USING NEW."ownerId", NEW."courseId";
    IF NOT allowed THEN RAISE EXCEPTION 'Course must belong to bank owner'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "QuestionBank_owner_guard" BEFORE INSERT OR UPDATE ON "QuestionBank" FOR EACH ROW EXECUTE FUNCTION guard_bank_owner();
COMMIT;
