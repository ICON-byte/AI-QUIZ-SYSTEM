-- Apply the new relationships, clock correction and guards atomically.
BEGIN;

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'LEFT', 'REMOVED');

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closesAt" TIMESTAMP(3),
ADD COLUMN     "courseId" UUID,
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "opensAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Course" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "enrollmentCodeHash" CHAR(64),
    "archivedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "courseId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("courseId","studentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Course_enrollmentCodeHash_key" ON "Course"("enrollmentCodeHash");

-- CreateIndex
CREATE INDEX "Course_ownerId_createdAt_idx" ON "Course"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Course_ownerId_code_key" ON "Course"("ownerId", "code");

-- CreateIndex
CREATE INDEX "Enrollment_studentId_status_idx" ON "Enrollment"("studentId", "status");

-- CreateIndex
CREATE INDEX "Quiz_courseId_status_idx" ON "Quiz"("courseId", "status");

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stage 2's raw timestamptz clock was decoded as local wall time by the driver.
-- Normalize only existing unfinished attempts using the database's timezone;
-- preserve their timer lengths, saved choices and all finalized historical results.
WITH corrected AS (
  SELECT "id", "startedAt", ("startedAt" AT TIME ZONE current_setting('TimeZone') AT TIME ZONE 'UTC') AS actual_start
  FROM "Attempt" WHERE "status"='IN_PROGRESS'
)
UPDATE "Attempt" a SET "startedAt"=c.actual_start,
  "expiresAt"=CASE WHEN a."expiresAt" IS NULL THEN NULL ELSE a."expiresAt"-(c."startedAt"-c.actual_start) END
FROM corrected c WHERE a."id"=c."id";

ALTER TABLE "Course" ADD CONSTRAINT "Course_code_normalized" CHECK ("code" = upper(trim("code")));
ALTER TABLE "Quiz" ADD CONSTRAINT "Assessment_course" CHECK (("mode" = 'ASSESSMENT') = ("courseId" IS NOT NULL));
ALTER TABLE "Quiz" ADD CONSTRAINT "Assessment_attempt_limit" CHECK ("maxAttempts" BETWEEN 1 AND 10);
-- Early closure/archive may share the start millisecond: a zero-duration final
-- attempt is valid, while negative durations and incomplete final results are not.
ALTER TABLE "Attempt" DROP CONSTRAINT "Attempt_valid_result";
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_valid_result" CHECK (
  "totalQuestions">0 AND "attemptNumber">0 AND
  ("expiresAt" IS NULL OR "expiresAt">="startedAt") AND
  (("status"='IN_PROGRESS' AND "finalizedAt" IS NULL AND "score" IS NULL AND "durationSeconds" IS NULL) OR
   ("status"<>'IN_PROGRESS' AND "finalizedAt" IS NOT NULL AND "score" IS NOT NULL AND "durationSeconds" IS NOT NULL AND "finalizedAt">="startedAt" AND "score" BETWEEN 0 AND "totalQuestions" AND "durationSeconds">=0))
);
ALTER TABLE "Quiz" ADD CONSTRAINT "Assessment_schedule" CHECK (
  ("opensAt" IS NULL OR "closesAt" IS NULL OR "opensAt" < "closesAt") AND
  ("mode" <> 'ASSESSMENT' OR "status" <> 'PUBLISHED' OR "closesAt" IS NOT NULL) AND
  ("closedAt" IS NULL OR ("mode"='ASSESSMENT' AND "status"='PUBLISHED' AND "closedAt">="publishedAt"))
);

CREATE OR REPLACE FUNCTION protect_published_quiz() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE question_count integer; invalid_count integer;
BEGIN
  IF OLD."status" = 'PUBLISHED' THEN
    IF TG_OP='UPDATE' AND OLD."mode"='ASSESSMENT' AND OLD."closedAt" IS NULL AND NEW."closedAt" IS NOT NULL AND
       (to_jsonb(NEW)-'closedAt'-'updatedAt')=(to_jsonb(OLD)-'closedAt'-'updatedAt') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Published quizzes are immutable';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW."status"='PUBLISHED' THEN
    EXECUTE format('SELECT count(*) FROM %I."QuizQuestion" WHERE "quizId"=$1', TG_TABLE_SCHEMA) INTO question_count USING NEW."id";
    EXECUTE format('SELECT count(*) FROM (SELECT q."id" FROM %I."QuizQuestion" q LEFT JOIN %I."QuizQuestionOption" o ON o."questionId"=q."id" WHERE q."quizId"=$1 GROUP BY q."id" HAVING count(o."id")<>4 OR count(o."id") FILTER (WHERE o."isCorrect")<>1) invalid',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA) INTO invalid_count USING NEW."id";
    IF question_count<1 OR invalid_count>0 THEN RAISE EXCEPTION 'Invalid quiz questions'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION protect_course() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approved boolean;
BEGIN
  IF TG_OP='UPDATE' AND (NEW."ownerId"<>OLD."ownerId" OR OLD."archivedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Course ownership and archives are permanent'; END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I."User" u JOIN %I."LecturerVerification" v ON v."userId"=u."id" WHERE u."id"=$1 AND u."role"=''LECTURER'' AND u."status"=''ACTIVE'' AND v."status"=''APPROVED'')',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA) INTO approved USING NEW."ownerId";
  IF NOT approved THEN RAISE EXCEPTION 'Verified lecturer required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Course_verified_owner" BEFORE INSERT OR UPDATE ON "Course" FOR EACH ROW EXECUTE FUNCTION protect_course();

CREATE FUNCTION protect_assessment_course() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; archived timestamp(3);
BEGIN
  IF NEW."mode"<>'ASSESSMENT' THEN RETURN NEW; END IF;
  EXECUTE format('SELECT "ownerId","archivedAt" FROM %I."Course" WHERE "id"=$1',TG_TABLE_SCHEMA) INTO owner_id,archived USING NEW."courseId";
  IF owner_id IS NULL OR owner_id<>NEW."ownerId" THEN RAISE EXCEPTION 'Assessment must belong to the owning lecturer course'; END IF;
  IF TG_OP='INSERT' AND archived IS NOT NULL THEN RAISE EXCEPTION 'Course is archived'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Assessment_course_owner" BEFORE INSERT OR UPDATE ON "Quiz" FOR EACH ROW EXECUTE FUNCTION protect_assessment_course();

CREATE FUNCTION protect_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_student boolean; active_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('course:'||NEW."courseId"::text,0));
  IF TG_OP='UPDATE' AND (NEW."courseId"<>OLD."courseId" OR NEW."studentId"<>OLD."studentId") THEN RAISE EXCEPTION 'Cannot move enrollments'; END IF;
  IF NEW."status"='ACTIVE' THEN
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I."User" WHERE "id"=$1 AND "role"=''STUDENT'' AND "status"=''ACTIVE'')',TG_TABLE_SCHEMA) INTO valid_student USING NEW."studentId";
    IF NOT valid_student THEN RAISE EXCEPTION 'Active student required'; END IF;
  ELSIF TG_OP='UPDATE' AND OLD."status"='ACTIVE' THEN
    EXECUTE format('SELECT count(*) FROM %I."Attempt" a JOIN %I."Quiz" q ON q."id"=a."quizId" WHERE q."courseId"=$1 AND a."userId"=$2 AND a."status"=''IN_PROGRESS''',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA) INTO active_count USING NEW."courseId",NEW."studentId";
    IF active_count>0 THEN RAISE EXCEPTION 'Active course attempt'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Enrollment_valid_student" BEFORE INSERT OR UPDATE ON "Enrollment" FOR EACH ROW EXECUTE FUNCTION protect_enrollment();

CREATE FUNCTION protect_assessment_start() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q record; c record; active_student boolean; used integer; enrollment_status text;
BEGIN
  EXECUTE format('SELECT * FROM %I."Quiz" WHERE "id"=$1',TG_TABLE_SCHEMA) INTO q USING NEW."quizId";
  IF q."mode"<>'ASSESSMENT' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('course:'||q."courseId"::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('quiz:'||NEW."quizId"::text,0));
  EXECUTE format('SELECT * FROM %I."Quiz" WHERE "id"=$1',TG_TABLE_SCHEMA) INTO q USING NEW."quizId";
  EXECUTE format('SELECT * FROM %I."Course" WHERE "id"=$1',TG_TABLE_SCHEMA) INTO c USING q."courseId";
  EXECUTE format('SELECT "status"::text FROM %I."Enrollment" WHERE "courseId"=$1 AND "studentId"=$2',TG_TABLE_SCHEMA) INTO enrollment_status USING q."courseId",NEW."userId";
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I."User" WHERE "id"=$1 AND "role"=''STUDENT'' AND "status"=''ACTIVE'')',TG_TABLE_SCHEMA) INTO active_student USING NEW."userId";
  IF NOT active_student OR enrollment_status IS DISTINCT FROM 'ACTIVE' OR c."archivedAt" IS NOT NULL OR q."status"<>'PUBLISHED' OR q."closedAt" IS NOT NULL OR q."closesAt"<=clock_timestamp() AT TIME ZONE 'UTC' OR q."opensAt">clock_timestamp() AT TIME ZONE 'UTC' THEN RAISE EXCEPTION 'Assessment unavailable'; END IF;
  EXECUTE format('SELECT count(*) FROM %I."Attempt" WHERE "quizId"=$1 AND "userId"=$2',TG_TABLE_SCHEMA) INTO used USING NEW."quizId",NEW."userId";
  IF used>=q."maxAttempts" OR NEW."expiresAt" IS NULL OR NEW."expiresAt">q."closesAt" OR (q."timeLimitSeconds" IS NOT NULL AND NEW."expiresAt">NEW."startedAt"+make_interval(secs=>q."timeLimitSeconds")) THEN RAISE EXCEPTION 'Assessment attempt limit or deadline'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Assessment_start_rules" BEFORE INSERT ON "Attempt" FOR EACH ROW EXECUTE FUNCTION protect_assessment_start();

CREATE OR REPLACE FUNCTION protect_attempt_answer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt_status text; deadline timestamp(3); attempt_id uuid; academic_deadline timestamp(3);
BEGIN
  IF TG_OP='UPDATE' AND (NEW."attemptId"<>OLD."attemptId" OR NEW."questionId"<>OLD."questionId" OR NEW."quizId"<>OLD."quizId") THEN RAISE EXCEPTION 'Cannot move answers'; END IF;
  IF TG_OP='DELETE' THEN attempt_id:=OLD."attemptId"; ELSE attempt_id:=NEW."attemptId"; END IF;
  EXECUTE format('SELECT "status"::text,"expiresAt" FROM %I."Attempt" WHERE "id"=$1 FOR UPDATE',TG_TABLE_SCHEMA) INTO attempt_status,deadline USING attempt_id;
  EXECUTE format('SELECT least(q."closesAt",q."closedAt",c."archivedAt") FROM %I."Attempt" a JOIN %I."Quiz" q ON q."id"=a."quizId" LEFT JOIN %I."Course" c ON c."id"=q."courseId" WHERE a."id"=$1 AND q."mode"=''ASSESSMENT''',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA,TG_TABLE_SCHEMA) INTO academic_deadline USING attempt_id;
  deadline:=least(deadline,academic_deadline);
  IF attempt_status<>'IN_PROGRESS' OR (deadline IS NOT NULL AND deadline<=clock_timestamp() AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'Attempt is closed'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

COMMIT;
