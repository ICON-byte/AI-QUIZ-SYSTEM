BEGIN;
CREATE TABLE "Challenge" (
 "quizId" UUID PRIMARY KEY REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "closesAt" TIMESTAMP(3), "closedAt" TIMESTAMP(3),
 "inviteCodeHash" CHAR(64) UNIQUE, "inviteCodeSealed" TEXT,
 CHECK (("inviteCodeHash" IS NULL) = ("inviteCodeSealed" IS NULL))
);
CREATE INDEX "Challenge_closesAt_idx" ON "Challenge"("closesAt");
CREATE TABLE "ChallengeParticipant" (
 "quizId" UUID NOT NULL REFERENCES "Challenge"("quizId") ON DELETE RESTRICT ON UPDATE CASCADE,
 "studentId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("quizId","studentId")
);
CREATE INDEX "ChallengeParticipant_studentId_joinedAt_idx" ON "ChallengeParticipant"("studentId","joinedAt");
CREATE INDEX "Attempt_challenge_results_idx" ON "Attempt"("quizId","score" DESC,"finalizedAt") WHERE "status"<>'IN_PROGRESS';

CREATE FUNCTION protect_challenge_quiz() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid boolean; c record;
BEGIN
 IF TG_OP='UPDATE' AND (OLD."mode"='CHALLENGE' OR NEW."mode"='CHALLENGE') AND
   (NEW."mode"<>OLD."mode" OR NEW."ownerId"<>OLD."ownerId") THEN RAISE EXCEPTION 'Cannot move challenges'; END IF;
 IF NEW."mode"<>'CHALLENGE' THEN RETURN NEW; END IF;
 IF NEW."courseId" IS NOT NULL OR NEW."opensAt" IS NOT NULL OR NEW."closesAt" IS NOT NULL OR NEW."closedAt" IS NOT NULL OR NEW."maxAttempts"<>1 THEN RAISE EXCEPTION 'Invalid challenge settings'; END IF;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I."User" WHERE "id"=$1 AND "role"=''STUDENT'' AND "status"=''ACTIVE'')',TG_TABLE_SCHEMA) INTO valid USING NEW."ownerId";
 IF NOT valid THEN RAISE EXCEPTION 'Active student creator required'; END IF;
 IF NEW."status"='PUBLISHED' THEN
  EXECUTE format('SELECT * FROM %I."Challenge" WHERE "quizId"=$1',TG_TABLE_SCHEMA) INTO c USING NEW."id";
  IF c."quizId" IS NULL OR c."inviteCodeHash" IS NULL OR (c."closesAt" IS NOT NULL AND c."closesAt"<=clock_timestamp() AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'Challenge publication unavailable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Challenge_quiz_rules" BEFORE INSERT OR UPDATE ON "Quiz" FOR EACH ROW EXECUTE FUNCTION protect_challenge_quiz();

CREATE FUNCTION protect_challenge_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q record;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Challenge history is retained'; END IF;
 EXECUTE format('SELECT * FROM %I."Quiz" WHERE "id"=$1',TG_TABLE_SCHEMA) INTO q USING NEW."quizId";
 IF q."mode"<>'CHALLENGE' THEN RAISE EXCEPTION 'Challenge quiz required'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW."quizId"<>OLD."quizId" OR OLD."closedAt" IS NOT NULL THEN RAISE EXCEPTION 'Challenge identity and closure are immutable'; END IF;
  IF q."status"='PUBLISHED' AND (to_jsonb(NEW)-'closedAt')<>(to_jsonb(OLD)-'closedAt') THEN RAISE EXCEPTION 'Published challenge settings are immutable'; END IF;
 END IF;
 IF NEW."closedAt" IS NOT NULL AND (q."status"<>'PUBLISHED' OR NEW."closedAt"<q."publishedAt" OR NEW."closedAt">clock_timestamp() AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'Invalid closure cutoff'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Challenge_metadata_rules" BEFORE INSERT OR UPDATE OR DELETE ON "Challenge" FOR EACH ROW EXECUTE FUNCTION protect_challenge_metadata();

CREATE FUNCTION protect_challenge_participant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q record; c record; valid boolean;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Challenge membership is immutable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('quiz:'||NEW."quizId"::text,0));
 EXECUTE format('SELECT * FROM %I."Quiz" WHERE "id"=$1',TG_TABLE_SCHEMA) INTO q USING NEW."quizId";
 EXECUTE format('SELECT * FROM %I."Challenge" WHERE "quizId"=$1',TG_TABLE_SCHEMA) INTO c USING NEW."quizId";
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I."User" WHERE "id"=$1 AND "role"=''STUDENT'' AND "status"=''ACTIVE'')',TG_TABLE_SCHEMA) INTO valid USING NEW."studentId";
 IF NOT valid OR q."ownerId"=NEW."studentId" OR q."status"<>'PUBLISHED' OR c."closedAt" IS NOT NULL OR c."closesAt"<=clock_timestamp() AT TIME ZONE 'UTC' THEN RAISE EXCEPTION 'Challenge joining unavailable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Challenge_participant_rules" BEFORE INSERT OR UPDATE OR DELETE ON "ChallengeParticipant" FOR EACH ROW EXECUTE FUNCTION protect_challenge_participant();

CREATE FUNCTION protect_challenge_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q record; c record; valid boolean; deadline timestamp(3);
BEGIN
 IF TG_OP='UPDATE' AND (OLD."quizId"<>NEW."quizId" OR OLD."userId"<>NEW."userId" OR OLD."attemptNumber"<>NEW."attemptNumber" OR OLD."startedAt"<>NEW."startedAt") THEN
  EXECUTE format('SELECT "mode" FROM %I."Quiz" WHERE "id"=$1',TG_TABLE_SCHEMA) INTO q USING OLD."quizId";
  IF q."mode"='CHALLENGE' THEN RAISE EXCEPTION 'Challenge attempt identity is immutable'; END IF;
 END IF;
 EXECUTE format('SELECT * FROM %I."Quiz" WHERE "id"=$1',TG_TABLE_SCHEMA) INTO q USING NEW."quizId";
 IF q."mode"<>'CHALLENGE' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('quiz:'||NEW."quizId"::text,0));
 IF NEW."attemptNumber"<>1 THEN RAISE EXCEPTION 'One challenge attempt only'; END IF;
 IF TG_OP='INSERT' THEN
  EXECUTE format('SELECT * FROM %I."Challenge" WHERE "quizId"=$1',TG_TABLE_SCHEMA) INTO c USING NEW."quizId";
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I."ChallengeParticipant" p JOIN %I."User" u ON u."id"=p."studentId" WHERE p."quizId"=$1 AND p."studentId"=$2 AND u."role"=''STUDENT'' AND u."status"=''ACTIVE'')',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA) INTO valid USING NEW."quizId",NEW."userId";
  IF NOT valid OR q."ownerId"=NEW."userId" OR q."status"<>'PUBLISHED' OR c."closedAt" IS NOT NULL OR c."closesAt"<=clock_timestamp() AT TIME ZONE 'UTC' THEN RAISE EXCEPTION 'Challenge attempt unavailable'; END IF;
  deadline:=least(c."closesAt",CASE WHEN q."timeLimitSeconds" IS NOT NULL THEN NEW."startedAt"+make_interval(secs=>q."timeLimitSeconds") END);
  IF deadline IS NOT NULL AND (NEW."expiresAt" IS NULL OR NEW."expiresAt">deadline) THEN RAISE EXCEPTION 'Invalid challenge deadline'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Challenge_attempt_rules" BEFORE INSERT OR UPDATE ON "Attempt" FOR EACH ROW EXECUTE FUNCTION protect_challenge_attempt();

CREATE OR REPLACE FUNCTION protect_attempt_answer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt_status text; deadline timestamp(3); attempt_id uuid; academic_deadline timestamp(3); challenge_quiz uuid; challenge_deadline timestamp(3);
BEGIN
  IF TG_OP='UPDATE' AND (NEW."attemptId"<>OLD."attemptId" OR NEW."questionId"<>OLD."questionId" OR NEW."quizId"<>OLD."quizId") THEN RAISE EXCEPTION 'Cannot move answers'; END IF;
  IF TG_OP='DELETE' THEN attempt_id:=OLD."attemptId"; ELSE attempt_id:=NEW."attemptId"; END IF;
  EXECUTE format('SELECT a."quizId" FROM %I."Attempt" a JOIN %I."Quiz" q ON q."id"=a."quizId" WHERE a."id"=$1 AND q."mode"=''CHALLENGE''',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA) INTO challenge_quiz USING attempt_id;
  IF challenge_quiz IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('quiz:'||challenge_quiz::text,0));
    EXECUTE format('SELECT least("closesAt","closedAt") FROM %I."Challenge" WHERE "quizId"=$1',TG_TABLE_SCHEMA) INTO challenge_deadline USING challenge_quiz;
  END IF;
  EXECUTE format('SELECT "status"::text,"expiresAt" FROM %I."Attempt" WHERE "id"=$1 FOR UPDATE',TG_TABLE_SCHEMA) INTO attempt_status,deadline USING attempt_id;
  EXECUTE format('SELECT least(q."closesAt",q."closedAt",c."archivedAt") FROM %I."Attempt" a JOIN %I."Quiz" q ON q."id"=a."quizId" LEFT JOIN %I."Course" c ON c."id"=q."courseId" WHERE a."id"=$1 AND q."mode"=''ASSESSMENT''',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA,TG_TABLE_SCHEMA) INTO academic_deadline USING attempt_id;
  deadline:=least(deadline,academic_deadline,challenge_deadline);
  IF attempt_status<>'IN_PROGRESS' OR (deadline IS NOT NULL AND deadline<=clock_timestamp() AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'Attempt is closed'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

COMMIT;
