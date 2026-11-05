import type { Database } from '../../infrastructure/database.js';
import type {
  QuestionBank,
  Question,
  Prisma,
} from '../../generated/prisma/client.js';
import { HttpError } from '../../middleware/errors.js';
import { lock, databaseNow, type Tx } from '../quizzes/data.js';
import {
  MAX_BANK_QUESTIONS,
  type BankInput,
  type BankQuestionInput,
  type bankListSchema,
  type questionListSchema,
} from './validation.js';
import { importTokens, previewCsv, type confirmImportSchema } from './csv.js';
import type { z } from 'zod';

const missing = () =>
  new HttpError(
    404,
    'BANK_NOT_FOUND',
    'This question bank or question was not found.',
  );
const conflict = () =>
  new HttpError(
    409,
    'BANK_CHANGED',
    'This item changed in another tab. Reload before saving.',
  );
export async function ownedBank(
  tx: Tx,
  userId: string,
  id: string,
  editable = false,
) {
  await lock(tx, `bank:${id}`);
  const bank = await tx.questionBank.findFirst({
    where: { id, ownerId: userId },
  });
  if (!bank) throw missing();
  if (editable && bank.archivedAt)
    throw new HttpError(
      409,
      'BANK_ARCHIVED',
      'Archived banks cannot be changed or selected for quizzes.',
    );
  return bank;
}
const bankDto = (bank: QuestionBank & { _count?: { questions: number } }) => ({
  id: bank.id,
  title: bank.title,
  description: bank.description,
  courseId: bank.courseId,
  revision: bank.revision,
  archivedAt: bank.archivedAt?.toISOString() ?? null,
  createdAt: bank.createdAt.toISOString(),
  questionCount: bank._count?.questions ?? 0,
});
const questionDto = (q: Question) => ({
  id: q.id,
  bankId: q.bankId,
  prompt: q.prompt,
  options: q.options,
  correctOption: q.correctOption,
  explanation: q.explanation,
  difficulty: q.difficulty,
  topic: q.topic,
  revision: q.revision,
  archivedAt: q.archivedAt?.toISOString() ?? null,
});
const activeCount = {
  _count: { select: { questions: { where: { archivedAt: null } } } },
} as const;
async function capacity(tx: Tx, bankId: string, add: number) {
  // Includes archived questions so repeated archiving cannot bypass the storage cap.
  if (
    (await tx.question.count({ where: { bankId } })) + add >
    MAX_BANK_QUESTIONS
  )
    throw new HttpError(
      409,
      'BANK_FULL',
      'A bank can hold at most 1,000 questions, including archived questions. Create another bank.',
    );
}
async function courseAssociation(
  tx: Tx,
  userId: string,
  courseId: string | null,
) {
  if (!courseId) return;
  await lock(tx, `course:${courseId}`);
  if (
    !(await tx.course.findFirst({
      where: {
        id: courseId,
        ownerId: userId,
        archivedAt: null,
        owner: { role: 'LECTURER' },
      },
    }))
  )
    throw new HttpError(
      404,
      'COURSE_NOT_FOUND',
      'Choose an active course you own.',
    );
}

// Used by AI acceptance: ownership, capacity and writes stay in the caller's transaction.
export async function saveAcceptedQuestions(tx: Tx, userId: string, input: {
  questions: BankQuestionInput[]; bankId?: string; newBank?: BankInput;
}) {
  let bankId = input.bankId;
  if (input.newBank) {
    await courseAssociation(tx, userId, input.newBank.courseId);
    const bank = await tx.questionBank.create({ data: { ...input.newBank, ownerId: userId } });
    bankId = bank.id;
  }
  if (!bankId) throw missing();
  await ownedBank(tx, userId, bankId, true);
  await capacity(tx, bankId, input.questions.length);
  await tx.question.createMany({ data: input.questions.map(q => ({ ...q, bankId })) });
  return { bankId, savedCount: input.questions.length };
}
async function ownedQuestion(
  tx: Tx,
  bankId: string,
  id: string,
  revision?: number,
) {
  const q = await tx.question.findFirst({ where: { id, bankId } });
  if (!q) throw missing();
  if (revision !== undefined && q.revision !== revision) throw conflict();
  if (q.archivedAt)
    throw new HttpError(
      409,
      'QUESTION_ARCHIVED',
      'Archived questions cannot be changed or copied.',
    );
  return q;
}
function copyData(q: Question): BankQuestionInput {
  return {
    prompt: q.prompt,
    options: q.options as BankQuestionInput['options'],
    correctOption: q.correctOption,
    explanation: q.explanation,
    difficulty: q.difficulty,
    topic: q.topic,
  };
}

export function createBankService(db: Database, secret: string) {
  const tokens = importTokens(secret);
  return {
    async list(userId: string, input: z.infer<typeof bankListSchema>) {
      const where = {
        ownerId: userId,
        archivedAt: input.archived === 'true' ? { not: null } : null,
        title: { contains: input.search, mode: 'insensitive' as const },
      };
      const [banks, total] = await db.$transaction([
        db.questionBank.findMany({
          where,
          include: activeCount,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * 20,
          take: 20,
        }),
        db.questionBank.count({ where }),
      ]);
      return { banks: banks.map(bankDto), total, page: input.page };
    },
    async create(userId: string, input: BankInput) {
      return db.$transaction(async (tx) => {
        await courseAssociation(tx, userId, input.courseId);
        return bankDto(
          await tx.questionBank.create({
            data: { ...input, ownerId: userId },
            include: activeCount,
          }),
        );
      });
    },
    async get(userId: string, id: string) {
      const bank = await db.questionBank.findFirst({
        where: { id, ownerId: userId },
        include: activeCount,
      });
      if (!bank) throw missing();
      return bankDto(bank);
    },
    async update(
      userId: string,
      id: string,
      input: BankInput & { revision: number },
    ) {
      return db.$transaction(async (tx) => {
        await courseAssociation(tx, userId, input.courseId);
        const bank = await ownedBank(tx, userId, id, true);
        if (bank.revision !== input.revision) throw conflict();
        return bankDto(
          await tx.questionBank.update({
            where: { id },
            data: { ...input, revision: { increment: 1 } },
            include: activeCount,
          }),
        );
      });
    },
    async archive(userId: string, id: string, revision: number) {
      return db.$transaction(async (tx) => {
        const bank = await ownedBank(tx, userId, id);
        if (bank.archivedAt) return bankDto(bank);
        if (bank.revision !== revision) throw conflict();
        return bankDto(
          await tx.questionBank.update({
            where: { id },
            data: {
              archivedAt: await databaseNow(tx),
              revision: { increment: 1 },
            },
            include: activeCount,
          }),
        );
      });
    },
    async duplicate(userId: string, id: string) {
      return db.$transaction(async (tx) => {
        const bank = await ownedBank(tx, userId, id, true);
        const questions = await tx.question.findMany({
          where: { bankId: id, archivedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        // A private copy deliberately has no course association.
        const copy = await tx.questionBank.create({
          data: {
            ownerId: userId,
            title: `${bank.title.slice(0, 143)} (copy)`,
            description: bank.description,
          },
        });
        if (questions.length)
          await tx.question.createMany({
            data: questions.map((q) => ({ ...copyData(q), bankId: copy.id })),
          });
        return bankDto({ ...copy, _count: { questions: questions.length } });
      });
    },
    async questions(
      userId: string,
      bankId: string,
      input: z.infer<typeof questionListSchema>,
    ) {
      return db.$transaction(async (tx) => {
        await ownedBank(tx, userId, bankId);
        const where: Prisma.QuestionWhereInput = {
          bankId,
          archivedAt: input.archived === 'true' ? { not: null } : null,
          difficulty: input.difficulty,
          topic: { contains: input.topic, mode: 'insensitive' },
          OR: [
            { prompt: { contains: input.search, mode: 'insensitive' } },
            { topic: { contains: input.search, mode: 'insensitive' } },
          ],
        };
        const questions = await tx.question.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 20,
          skip: (input.page - 1) * 20,
        });
        return {
          questions: questions.map(questionDto),
          total: await tx.question.count({ where }),
          page: input.page,
        };
      });
    },
    async getQuestion(userId: string, bankId: string, id: string) {
      return db.$transaction(async (tx) => {
        await ownedBank(tx, userId, bankId);
        const q = await tx.question.findFirst({ where: { id, bankId } });
        if (!q) throw missing();
        return questionDto(q);
      });
    },
    async add(userId: string, bankId: string, input: BankQuestionInput) {
      return db.$transaction(async (tx) => {
        await ownedBank(tx, userId, bankId, true);
        await capacity(tx, bankId, 1);
        return questionDto(
          await tx.question.create({ data: { ...input, bankId } }),
        );
      });
    },
    async edit(
      userId: string,
      bankId: string,
      id: string,
      input: BankQuestionInput & { revision: number },
    ) {
      return db.$transaction(async (tx) => {
        await ownedBank(tx, userId, bankId, true);
        await ownedQuestion(tx, bankId, id, input.revision);
        return questionDto(
          await tx.question.update({
            where: { id },
            data: { ...input, revision: { increment: 1 } },
          }),
        );
      });
    },
    async archiveQuestion(
      userId: string,
      bankId: string,
      id: string,
      revision: number,
    ) {
      return db.$transaction(async (tx) => {
        await ownedBank(tx, userId, bankId, true);
        await ownedQuestion(tx, bankId, id, revision);
        return questionDto(
          await tx.question.update({
            where: { id },
            data: {
              archivedAt: await databaseNow(tx),
              revision: { increment: 1 },
            },
          }),
        );
      });
    },
    async transfer(
      userId: string,
      bankId: string,
      id: string,
      input: {
        targetBankId: string;
        action: 'COPY' | 'MOVE';
        revision: number;
      },
    ) {
      return db.$transaction(async (tx) => {
        // Stable order prevents deadlocks when two tabs move questions in opposite directions.
        for (const target of [...new Set([bankId, input.targetBankId])].sort())
          await ownedBank(tx, userId, target, true);
        const q = await ownedQuestion(tx, bankId, id, input.revision);
        if (input.action === 'MOVE' && bankId === input.targetBankId)
          return questionDto(q);
        await capacity(tx, input.targetBankId, 1);
        return questionDto(
          input.action === 'COPY'
            ? await tx.question.create({
                data: { ...copyData(q), bankId: input.targetBankId },
              })
            : await tx.question.update({
                where: { id },
                data: {
                  bankId: input.targetBankId,
                  revision: { increment: 1 },
                },
              }),
        );
      });
    },
    async select(userId: string, ids: string[]) {
      return db.$transaction(async (tx) => {
        const rows = await tx.question.findMany({
          where: {
            id: { in: ids },
            archivedAt: null,
            bank: { ownerId: userId, archivedAt: null },
          },
        });
        for (const bankId of [...new Set(rows.map((q) => q.bankId))].sort())
          await ownedBank(tx, userId, bankId, true);
        const current = await tx.question.findMany({
          where: {
            id: { in: ids },
            archivedAt: null,
            bank: { ownerId: userId, archivedAt: null },
          },
        });
        if (current.length !== ids.length) throw missing();
        const byId = new Map(current.map((q) => [q.id, q]));
        return {
          questions: ids.map((id) => {
            const q = byId.get(id)!;
            return {
              prompt: q.prompt,
              options: q.options,
              correctOption: q.correctOption,
              explanation: q.explanation,
            };
          }),
        };
      });
    },
    async preview(userId: string, bankId: string, csv: string) {
      await db.$transaction((tx) => ownedBank(tx, userId, bankId, true));
      return { ...previewCsv(csv), ...tokens.create(userId, bankId, csv) };
    },
    async confirm(
      userId: string,
      bankId: string,
      input: z.infer<typeof confirmImportSchema>,
    ) {
      const receiptId = tokens.verify(input.token, userId, bankId, input.csv);
      const preview = previewCsv(input.csv);
      if (!preview.validCount || (preview.invalidCount && !input.skipInvalid))
        throw new HttpError(
          400,
          'CSV_INVALID_ROWS',
          'Review the errors and explicitly choose to skip invalid rows, or fix the CSV and preview again.',
        );
      return db.$transaction(async (tx) => {
        await ownedBank(tx, userId, bankId, true);
        const receipt = await tx.csvImportReceipt.findUnique({
          where: { id: receiptId },
        });
        if (receipt)
          return {
            importedCount: receipt.importedCount,
            skippedCount: receipt.skippedCount,
          };
        await capacity(tx, bankId, preview.validCount);
        await tx.question.createMany({
          data: preview.rows.flatMap((row) =>
            row.question ? [{ ...row.question, bankId }] : [],
          ),
        });
        await tx.csvImportReceipt.create({
          data: {
            id: receiptId,
            bankId,
            importedCount: preview.validCount,
            skippedCount: preview.invalidCount,
          },
        });
        return {
          importedCount: preview.validCount,
          skippedCount: preview.invalidCount,
        };
      });
    },
  };
}
