import { z } from 'zod';
import { documentSources, containsExcerpt } from './source-references.js';
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

// Check common question fields first; resolve references separately so failures
// can identify a safe source field without retaining the provider's invalid values.
const providerOutputSchema = generatedOutputSchema.extend({
  questions: z
    .array(generatedQuestionSchema.extend({ source: z.unknown().optional() }))
    .min(1)
    .max(30),
});
const documentReferenceSchema = z
  .object({
    id: z.number().int().positive(),
    quote: z.string().min(1).max(300),
  })
  .strict();
export interface ValidationCounts {
  requestedCount: number;
  returnedCount?: number;
  sourceCount: number;
  sourceCharacters: number;
}
// Only known contract paths/codes are retained; never retain invalid values or Zod messages.
export class OutputFailure extends Error {
  constructor(
    public code: string,
    public fields: string[] = [],
    public counts?: ValidationCounts,
  ) {
    super(code);
  }
}
export function validateOutput(raw: string, input: GenerationInput) {
  const counts: ValidationCounts = {
    requestedCount: input.count,
    sourceCount: input.segments.length,
    sourceCharacters: input.segments.reduce(
      (n, segment) => n + segment.text.length,
      0,
    ),
  };
  try {
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
      counts.returnedCount = value.questions.length;
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
    const checked = providerOutputSchema.safeParse(value);
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
        'id',
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
    const sources = documentSources(input.segments);
    const questions: GeneratedQuestion[] = [];
    for (const [index, q] of parsed.questions.entries()) {
      const normalized = q.prompt.toLowerCase().replace(/\s+/g, ' ').trim();
      if (prompts.has(normalized))
        throw new OutputFailure('DUPLICATE_QUESTIONS');
      if (q.difficulty !== input.difficulty)
        throw new OutputFailure('DIFFICULTY_MISMATCH');
      prompts.add(normalized);
      const path = `questions.${index}.source`;
      if (input.kind === 'DOCUMENT') {
        if (q.source === null || q.source === undefined)
          throw new OutputFailure('SOURCE_MISSING', [path]);
        if (typeof q.source !== 'object' || Array.isArray(q.source))
          throw new OutputFailure('INVALID_FIELDS', [path]);
        if (!('id' in q.source))
          throw new OutputFailure('SOURCE_MISSING', [path + '.id']);
        if (!('quote' in q.source))
          throw new OutputFailure('SOURCE_MISSING', [path + '.quote']);
        const reference = documentReferenceSchema.safeParse(q.source);
        if (!reference.success) {
          if (reference.error.issues.some((issue) => issue.path[0] === 'id'))
            throw new OutputFailure('SOURCE_ID_UNKNOWN', [path + '.id']);
          throw new OutputFailure('INVALID_FIELDS', [path]);
        }
        const source = sources[reference.data.id - 1];
        if (!source)
          throw new OutputFailure('SOURCE_ID_UNKNOWN', [path + '.id']);
        if (!containsExcerpt(source.text, reference.data.quote))
          throw new OutputFailure('SOURCE_EXCERPT_MISMATCH', [path + '.quote']);
        questions.push({
          ...q,
          source: { label: source.label, quote: reference.data.quote },
        });
      } else {
        if (q.source !== null)
          throw new OutputFailure('SOURCE_REFERENCE', [path]);
        questions.push({ ...q, source: null });
      }
    }
    return { questions };
  } catch (error) {
    if (error instanceof OutputFailure) error.counts = counts;
    throw error;
  }
}
