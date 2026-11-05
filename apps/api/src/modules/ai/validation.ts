import { z } from 'zod';
import { bankQuestionSchema, bankSchema } from '../banks/validation.js';

export const segmentSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(100000),
  })
  .strict();
export const generationInputSchema = z
  .object({
    idempotencyKey: z.uuid(),
    kind: z.enum(['TOPIC', 'DOCUMENT']),
    topic: z.string().trim().max(500).default(''),
    segments: z.array(segmentSchema).max(200).default([]),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
    count: z.union([
      z.literal(5),
      z.literal(10),
      z.literal(15),
      z.literal(20),
      z.literal(30),
    ]),
    nonSensitiveConfirmed: z.literal(true),
    textReviewed: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'TOPIC' && (v.topic.length < 3 || v.segments.length))
      ctx.addIssue({
        code: 'custom',
        message:
          'Enter a topic of at least three characters without document text.',
        path: ['topic'],
      });
    if (
      v.kind === 'DOCUMENT' &&
      (!v.textReviewed ||
        !v.segments.length ||
        v.segments.reduce((n, s) => n + s.text.length, 0) < 100)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Review at least 100 characters of extracted educational text.',
        path: ['segments'],
      });
    if (new Set(v.segments.map((s) => s.label)).size !== v.segments.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Use unique source labels.',
        path: ['segments'],
      });
  });
export const generatedQuestionSchema = bankQuestionSchema.extend({
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  topic: z.string().trim().max(100),
  explanation: z.string().trim().min(1).max(1500),
  source: z
    .object({ label: z.string().max(80), quote: z.string().min(1).max(300) })
    .strict()
    .nullable(),
});
export const generatedOutputSchema = z
  .object({ questions: z.array(generatedQuestionSchema).min(1).max(30) })
  .strict();
export const reviewSchema = z
  .object({
    questions: z
      .array(
        bankQuestionSchema.extend({
          explanation: z.string().trim().min(1).max(2000),
        }),
      )
      .min(1)
      .max(30),
  })
  .strict();
export const acceptSchema = z
  .object({
    questions: reviewSchema.shape.questions,
    bankId: z.uuid().optional(),
    newBank: bankSchema.optional(),
  })
  .strict()
  .refine(
    (v) => !!v.bankId !== !!v.newBank,
    'Choose an existing bank or create a new bank.',
  );
export const eligibilitySchema = z
  .object({ ageConfirmed: z.literal(true) })
  .strict();
export type GenerationInput = z.infer<typeof generationInputSchema>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

// Only known contract paths/codes are retained; never retain invalid values or Zod messages.
export class OutputFailure extends Error {
  constructor(
    public code: string,
    public fields: string[] = [],
  ) {
    super(code);
  }
}
export function validateOutput(raw: string, input: GenerationInput) {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new OutputFailure('MALFORMED_JSON');
  }
  if (
    value &&
    typeof value === 'object' &&
    'questions' in value &&
    Array.isArray(value.questions)
  ) {
    if (value.questions.length !== input.count)
      throw new OutputFailure('QUESTION_COUNT');
    for (const q of value.questions) {
      if (!q || typeof q !== 'object') continue;
      if (typeof q.difficulty === 'string')
        q.difficulty = q.difficulty.trim().toUpperCase();
      if (
        typeof q.correctOption === 'string' &&
        /^[A-D]$/i.test(q.correctOption.trim())
      )
        q.correctOption =
          q.correctOption.trim().toUpperCase().charCodeAt(0) - 65;
    }
  }
  const checked = generatedOutputSchema.safeParse(value);
  if (!checked.success) {
    const allowed = new Set([
      'questions',
      'prompt',
      'options',
      'correctOption',
      'explanation',
      'difficulty',
      'topic',
      'source',
      'label',
      'quote',
    ]);
    const fields = [
      ...new Set(
        checked.error.issues
          .slice(0, 12)
          .map(
            (issue) =>
              issue.path
                .filter(
                  (part) =>
                    typeof part === 'number' || allowed.has(String(part)),
                )
                .join('.') || '$',
          ),
      ),
    ];
    throw new OutputFailure('INVALID_FIELDS', fields);
  }
  const parsed = checked.data;
  if (parsed.questions.length !== input.count)
    throw new OutputFailure('QUESTION_COUNT');
  const prompts = new Set<string>();
  for (const q of parsed.questions) {
    const normalized = q.prompt.toLowerCase().replace(/\s+/g, ' ').trim();
    if (prompts.has(normalized)) throw new OutputFailure('DUPLICATE_QUESTIONS');
    if (q.difficulty !== input.difficulty)
      throw new OutputFailure('DIFFICULTY_MISMATCH');
    prompts.add(normalized);
    if (input.kind === 'DOCUMENT') {
      const segment = input.segments.find((s) => s.label === q.source?.label);
      if (!q.source || !segment || !segment.text.includes(q.source.quote))
        throw new OutputFailure('SOURCE_REFERENCE');
    } else if (q.source) throw new OutputFailure('SOURCE_REFERENCE');
  }
  return parsed;
}
