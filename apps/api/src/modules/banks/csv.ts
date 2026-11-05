import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { HttpError } from '../../middleware/errors.js';
import { bankQuestionSchema } from './validation.js';

export const CSV_BYTES = 1024 * 1024;
export const CSV_ROWS = 200;
export const headers = [
  'Question',
  'Option A',
  'Option B',
  'Option C',
  'Option D',
  'Correct Answer',
  'Explanation',
  'Difficulty',
  'Topic',
];
export const csvBodySchema = z
  .object({
    csv: z
      .string()
      .min(1)
      .refine(
        (value) => Buffer.byteLength(value, 'utf8') <= CSV_BYTES,
        'CSV files must be at most 1 MiB.',
      ),
  })
  .strict();
export const confirmImportSchema = csvBodySchema.extend({
  token: z.string().max(1500),
  confirmed: z.literal(true),
  skipInvalid: z.boolean(),
});
const claimsSchema = z
  .object({
    userId: z.uuid(),
    bankId: z.uuid(),
    digest: z.string().length(64),
    expires: z.number(),
    nonce: z.string(),
  })
  .strict();
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

// Formula escaping belongs at the export boundary, never in stored question text.
export function csvCell(value: string) {
  const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(value)
    ? `'${value}`
    : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export const csvTemplate = () =>
  [
    headers,
    [
      'Which organelle produces ATP?',
      'Nucleus',
      'Mitochondrion',
      'Ribosome',
      'Golgi apparatus',
      'B',
      'Mitochondria produce ATP through respiration.',
      'MEDIUM',
      'Cell biology',
    ],
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n') + '\r\n';

export function previewCsv(csv: string) {
  csvBodySchema.parse({ csv });
  if (csv.includes('\0') || csv.includes('\uFFFD'))
    throw new HttpError(
      400,
      'INVALID_CSV',
      'Use a UTF-8 CSV file without binary content.',
    );
  let records: string[][];
  try {
    let count = 0;
    records = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      max_record_size: 12000,
      on_record(record: string[]) {
        if (++count > CSV_ROWS + 1)
          throw new HttpError(
            400,
            'CSV_ROW_LIMIT',
            'Include between 1 and 200 question rows.',
          );
        return record;
      },
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const line =
      typeof error === 'object' &&
      error !== null &&
      'lines' in error &&
      typeof error.lines === 'number'
        ? ` near line ${error.lines}`
        : '';
    throw new HttpError(
      400,
      'MALFORMED_CSV',
      `Malformed CSV${line}. Check quotes and field lengths; no rows were imported.`,
    );
  }
  const header = records.shift()?.map((value) => value.trim().toLowerCase());
  if (
    !header ||
    header.length !== headers.length ||
    headers.some((name) => !header.includes(name.toLowerCase()))
  )
    throw new HttpError(
      400,
      'CSV_HEADERS',
      'Use each of the nine template headers exactly once. Header order may vary.',
    );
  if (!records.length || records.length > CSV_ROWS)
    throw new HttpError(
      400,
      'CSV_ROW_LIMIT',
      'Include between 1 and 200 question rows.',
    );
  const rows = records.map((record, index) => {
    const read = (name: string) =>
      record[header.indexOf(name.toLowerCase())]?.trim() ?? '';
    const result = bankQuestionSchema.safeParse({
      prompt: read('Question'),
      options: ['A', 'B', 'C', 'D'].map((letter) => read(`Option ${letter}`)),
      correctOption: ['A', 'B', 'C', 'D'].indexOf(
        read('Correct Answer').toUpperCase(),
      ),
      explanation: read('Explanation'),
      difficulty: read('Difficulty').toUpperCase(),
      topic: read('Topic'),
    });
    const errors = record.length !== 9 ? ['Expected nine fields.'] : [];
    if (!result.success)
      errors.push(
        ...result.error.issues.map((issue) => {
          const field = issue.path[0];
          if (field === 'correctOption')
            return 'Correct Answer: Use A, B, C or D.';
          if (field === 'difficulty')
            return 'Difficulty: Use EASY, MEDIUM or HARD.';
          const label =
            field === 'prompt'
              ? 'Question'
              : field === 'explanation'
                ? 'Explanation'
                : field === 'topic'
                  ? 'Topic'
                  : field === 'options' && typeof issue.path[1] === 'number'
                    ? `Option ${String.fromCharCode(65 + issue.path[1])}`
                    : 'Options';
          return `${label}: ${issue.message}`;
        }),
      );
    return {
      row: index + 2,
      prompt: read('Question'),
      errors,
      question: result.success && !errors.length ? result.data : null,
    };
  });
  return {
    rows,
    validCount: rows.filter((row) => row.question).length,
    invalidCount: rows.filter((row) => !row.question).length,
  };
}

export function importTokens(secret: string) {
  const signature = (value: string) =>
    createHmac('sha256', secret).update(`csv-import:${value}`).digest();
  return {
    create(userId: string, bankId: string, csv: string) {
      const expires = Date.now() + 15 * 60_000;
      const encoded = Buffer.from(
        JSON.stringify({
          userId,
          bankId,
          digest: digest(csv),
          expires,
          nonce: randomBytes(16).toString('hex'),
        }),
      ).toString('base64url');
      return {
        token: `${encoded}.${signature(encoded).toString('base64url')}`,
        expiresAt: new Date(expires).toISOString(),
      };
    },
    verify(token: string, userId: string, bankId: string, csv: string) {
      try {
        const [encoded, signed, extra] = token.split('.');
        if (!encoded || !signed || extra) throw new Error();
        const actual = Buffer.from(signed, 'base64url');
        const expected = signature(encoded);
        if (
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        )
          throw new Error();
        const claims = claimsSchema.parse(
          JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
        );
        if (
          claims.userId !== userId ||
          claims.bankId !== bankId ||
          claims.digest !== digest(csv) ||
          claims.expires <= Date.now()
        )
          throw new Error();
        return digest(token);
      } catch {
        throw new HttpError(
          400,
          'IMPORT_PREVIEW_EXPIRED',
          'This preview expired or changed. Preview the CSV again before importing.',
        );
      }
    },
  };
}
