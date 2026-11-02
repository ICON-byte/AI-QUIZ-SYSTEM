-- CreateEnum
CREATE TYPE "QuizMode" AS ENUM ('ASSESSMENT', 'PRACTICE', 'CHALLENGE');

-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Quiz" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "mode" "QuizMode" NOT NULL DEFAULT 'PRACTICE',
    "status" "QuizStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "timeLimitSeconds" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "prompt" VARCHAR(2000) NOT NULL,
    "explanation" VARCHAR(2000) NOT NULL DEFAULT '',

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestionOption" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,

    CONSTRAINT "QuizQuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "score" INTEGER,
    "totalQuestions" INTEGER NOT NULL,
    "durationSeconds" INTEGER,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptAnswer" (
    "attemptId" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "selectedOptionId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptAnswer_pkey" PRIMARY KEY ("attemptId","questionId")
);

-- CreateIndex
CREATE INDEX "Quiz_ownerId_createdAt_idx" ON "Quiz"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestion_id_quizId_key" ON "QuizQuestion"("id", "quizId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestion_quizId_position_key" ON "QuizQuestion"("quizId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestionOption_id_questionId_key" ON "QuizQuestionOption"("id", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestionOption_questionId_position_key" ON "QuizQuestionOption"("questionId", "position");

-- CreateIndex
CREATE INDEX "Attempt_userId_startedAt_idx" ON "Attempt"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "Attempt_status_expiresAt_idx" ON "Attempt"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_id_quizId_key" ON "Attempt"("id", "quizId");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_quizId_userId_attemptNumber_key" ON "Attempt"("quizId", "userId", "attemptNumber");

-- CreateIndex
CREATE INDEX "AttemptAnswer_questionId_quizId_idx" ON "AttemptAnswer"("questionId", "quizId");

-- CreateIndex
CREATE INDEX "AttemptAnswer_selectedOptionId_questionId_idx" ON "AttemptAnswer"("selectedOptionId", "questionId");

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestionOption" ADD CONSTRAINT "QuizQuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_attemptId_quizId_fkey" FOREIGN KEY ("attemptId", "quizId") REFERENCES "Attempt"("id", "quizId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_questionId_quizId_fkey" FOREIGN KEY ("questionId", "quizId") REFERENCES "QuizQuestion"("id", "quizId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_selectedOptionId_questionId_fkey" FOREIGN KEY ("selectedOptionId", "questionId") REFERENCES "QuizQuestionOption"("id", "questionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants not expressible in the Prisma schema.
CREATE UNIQUE INDEX "Attempt_one_active_per_student_quiz" ON "Attempt" ("quizId", "userId") WHERE "status" = 'IN_PROGRESS';
CREATE UNIQUE INDEX "QuizQuestionOption_one_correct" ON "QuizQuestionOption" ("questionId") WHERE "isCorrect";
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_time_limit" CHECK ("timeLimitSeconds" IS NULL OR "timeLimitSeconds" BETWEEN 60 AND 10800);
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_publication" CHECK (("status" = 'DRAFT' AND "publishedAt" IS NULL) OR ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL));
ALTER TABLE "QuizQuestionOption" ADD CONSTRAINT "Option_position" CHECK ("position" BETWEEN 0 AND 3);
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_valid_result" CHECK (
  "totalQuestions" > 0 AND "attemptNumber" > 0 AND
  ("expiresAt" IS NULL OR "expiresAt" > "startedAt") AND
  (("status" = 'IN_PROGRESS' AND "finalizedAt" IS NULL AND "score" IS NULL AND "durationSeconds" IS NULL) OR
   ("status" <> 'IN_PROGRESS' AND "finalizedAt" IS NOT NULL AND "score" IS NOT NULL AND "durationSeconds" IS NOT NULL AND "finalizedAt" >= "startedAt" AND "score" BETWEEN 0 AND "totalQuestions" AND "durationSeconds" >= 0))
);
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "Answer_positive_revision" CHECK ("revision" > 0);

CREATE FUNCTION protect_published_quiz() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE question_count integer; invalid_count integer;
BEGIN
  IF OLD."status" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published quizzes are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."status" = 'PUBLISHED' THEN
    EXECUTE format('SELECT count(*) FROM %I."QuizQuestion" WHERE "quizId"=$1', TG_TABLE_SCHEMA)
      INTO question_count USING NEW."id";
    EXECUTE format('SELECT count(*) FROM (SELECT q."id" FROM %I."QuizQuestion" q LEFT JOIN %I."QuizQuestionOption" o ON o."questionId"=q."id" WHERE q."quizId"=$1 GROUP BY q."id" HAVING count(o."id") <> 4 OR count(o."id") FILTER (WHERE o."isCorrect") <> 1) invalid', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
      INTO invalid_count USING NEW."id";
    IF question_count < 1 OR invalid_count > 0 THEN RAISE EXCEPTION 'Invalid quiz questions'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Quiz_immutable" BEFORE UPDATE OR DELETE ON "Quiz" FOR EACH ROW EXECUTE FUNCTION protect_published_quiz();

CREATE FUNCTION protect_quiz_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quiz_id uuid; question_id uuid; quiz_status text;
BEGIN
  IF TG_TABLE_NAME = 'QuizQuestion' THEN
    IF TG_OP = 'UPDATE' AND (NEW."quizId" <> OLD."quizId" OR NEW."id" <> OLD."id") THEN RAISE EXCEPTION 'Cannot move questions'; END IF;
    IF TG_OP = 'DELETE' THEN quiz_id := OLD."quizId"; ELSE quiz_id := NEW."quizId"; END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND (NEW."questionId" <> OLD."questionId" OR NEW."id" <> OLD."id") THEN RAISE EXCEPTION 'Cannot move options'; END IF;
    IF TG_OP = 'DELETE' THEN question_id := OLD."questionId"; ELSE question_id := NEW."questionId"; END IF;
    EXECUTE format('SELECT "quizId" FROM %I."QuizQuestion" WHERE "id"=$1', TG_TABLE_SCHEMA) INTO quiz_id USING question_id;
  END IF;
  EXECUTE format('SELECT "status"::text FROM %I."Quiz" WHERE "id"=$1 FOR UPDATE', TG_TABLE_SCHEMA) INTO quiz_status USING quiz_id;
  IF quiz_status = 'PUBLISHED' THEN RAISE EXCEPTION 'Published questions are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Question_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "QuizQuestion" FOR EACH ROW EXECUTE FUNCTION protect_quiz_content();
CREATE TRIGGER "Option_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "QuizQuestionOption" FOR EACH ROW EXECUTE FUNCTION protect_quiz_content();

CREATE FUNCTION protect_final_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'Finalized attempts are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Attempt_immutable" BEFORE UPDATE OR DELETE ON "Attempt" FOR EACH ROW EXECUTE FUNCTION protect_final_attempt();

CREATE FUNCTION protect_attempt_answer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt_status text; deadline timestamp(3); attempt_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."attemptId" <> OLD."attemptId" OR NEW."questionId" <> OLD."questionId" OR NEW."quizId" <> OLD."quizId") THEN RAISE EXCEPTION 'Cannot move answers'; END IF;
  IF TG_OP = 'DELETE' THEN attempt_id := OLD."attemptId"; ELSE attempt_id := NEW."attemptId"; END IF;
  EXECUTE format('SELECT "status"::text, "expiresAt" FROM %I."Attempt" WHERE "id"=$1 FOR UPDATE', TG_TABLE_SCHEMA) INTO attempt_status, deadline USING attempt_id;
  IF attempt_status <> 'IN_PROGRESS' OR (deadline IS NOT NULL AND deadline <= clock_timestamp() AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'Attempt is closed'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Answer_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "AttemptAnswer" FOR EACH ROW EXECUTE FUNCTION protect_attempt_answer();
