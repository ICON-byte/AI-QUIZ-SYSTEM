import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  generationInputSchema,
  validateOutput,
} from '../src/modules/ai/validation.js';
import { extractContent } from '../src/modules/ai/extract-content.js';
import { createExtractor } from '../src/modules/ai/extraction.js';
import { loadConfig } from '../src/config/env.js';
import {
  docxFixture,
  pdfFixture,
  pdfWhitespaceFixture,
  educationalText,
  mockQuestions,
} from './ai-fixtures.js';

const input = () =>
  generationInputSchema.parse({
    idempotencyKey: randomUUID(),
    kind: 'TOPIC',
    topic: 'Cell biology',
    difficulty: 'MEDIUM',
    count: 5,
    nonSensitiveConfirmed: true,
  });
describe('AI schemas and document extraction', () => {
  it('requires privacy confirmation and supported quantities', () => {
    expect(() =>
      generationInputSchema.parse({ ...input(), nonSensitiveConfirmed: false }),
    ).toThrow();
    expect(() =>
      generationInputSchema.parse({ ...input(), count: 6 }),
    ).toThrow();
  });
  it('validates complete question sets and rejects malformed or repeated output', () => {
    const request = input();
    const valid = mockQuestions(request);
    expect(
      validateOutput(JSON.stringify(valid), request).questions,
    ).toHaveLength(5);
    expect(() => validateOutput('not JSON', request)).toThrow();
    expect(() =>
      validateOutput(
        JSON.stringify({ questions: valid.questions.slice(1) }),
        request,
      ),
    ).toThrow();
    valid.questions[1]!.prompt = valid.questions[0]!.prompt;
    expect(() => validateOutput(JSON.stringify(valid), request)).toThrow();
  });
  it('rejects invalid options, wrong answers and missing explanations', () => {
    for (const patch of [
      { options: ['a', 'a', 'b', 'c'] },
      { correctOption: 4 },
      { explanation: '' },
      { difficulty: 'HARD' },
    ]) {
      const request = input();
      const output = mockQuestions(request);
      Object.assign(output.questions[0]!, patch);
      expect(() => validateOutput(JSON.stringify(output), request)).toThrow();
    }
  });
  it('resolves document IDs to public labels and checks supporting quotes', () => {
    const request = {
      ...input(),
      kind: 'DOCUMENT' as const,
      topic: '',
      segments: [{ label: 'Page 1', text: educationalText }],
    };
    const output = mockQuestions(request);
    expect(
      validateOutput(JSON.stringify(output), request).questions[0]!.source
        ?.label,
    ).toBe('Page 1');
    output.questions[0]!.source!.quote = 'Invented reference';
    expect(() => validateOutput(JSON.stringify(output), request)).toThrow();
  });
  it('extracts UTF-8 TXT and DOCX paragraphs without executing document instructions', async () => {
    const limits = { characters: 40000, pages: 100 };
    expect(
      (await extractContent(Buffer.from(educationalText), 'TXT', limits))[0]!
        .text,
    ).toContain('nucleus');
    expect(
      (await extractContent(docxFixture(), 'DOCX', limits))[0]!.label,
    ).toBe('Paragraph 1');
  });
  it('extracts text-based PDF with page references', async () => {
    const result = await extractContent(pdfFixture(), 'PDF', {
      characters: 40000,
      pages: 100,
    });
    expect(result[0]!.label).toBe('Page 1');
    expect(result[0]!.text).toContain('mitochondria'.replace('m', 'M'));
  }, 20000);
  it('rejects empty, malformed, binary, unsupported and excessive documents', async () => {
    const limits = { characters: 40000, pages: 100 };
    for (const [kind, buffer] of [
      ['TXT', Buffer.alloc(0)],
      ['TXT', Buffer.from([0xff, 0xff])],
      ['TXT', Buffer.from('a\0'.repeat(100))],
      ['PDF', Buffer.from('fake PDF')],
      ['DOCX', Buffer.from('not a ZIP')],
      ['OTHER', Buffer.from(educationalText)],
    ] as const)
      await expect(extractContent(buffer, kind, limits)).rejects.toThrow();
    await expect(
      extractContent(Buffer.from(educationalText), 'TXT', {
        ...limits,
        characters: 100,
      }),
    ).rejects.toThrow('character limit');
    await expect(
      extractContent(pdfFixture(), 'PDF', { ...limits, pages: 0 }),
    ).rejects.toThrow('page limit');
  });
  it('rejects ZIP bombs before parsing DOCX XML', async () => {
    const archive = Buffer.from(
      zipSync({
        'word/document.xml': strToU8('a'.repeat(21 * 1024 * 1024)),
        '[Content_Types].xml': strToU8('types'),
      }),
    );
    await expect(
      extractContent(archive, 'DOCX', { characters: 40000, pages: 100 }),
    ).rejects.toThrow();
  });
  it('validates upload extension/type and enforces isolated extraction timeout', async () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://localhost/test',
      JWT_SECRET: 'x'.repeat(48),
    });
    const extract = createExtractor(config);
    await expect(
      extract(Buffer.from(educationalText), 'notes.exe', 'text/plain'),
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
    await expect(
      extract(Buffer.from(educationalText), 'notes.txt', 'image/png'),
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
    const result = await extract(
      Buffer.from(educationalText),
      'notes.txt',
      'text/plain',
    );
    expect(result.segments[0]!.text).toBe(educationalText);
  }, 20000);
});

describe('official Gemini adapter with mocked SDK', () => {
  it('sends no tools, disables hidden retries/continuation and sanitizes provider errors', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: '{}',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 240,
        totalTokenCount: 360,
      },
    });
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: class {
        models = { generateContent };
      },
    }));
    const { createGeminiProvider } = await import(
      '../src/modules/ai/provider.js'
    );
    const cfg = loadConfig({
      DATABASE_URL: 'postgresql://localhost/test',
      JWT_SECRET: 'x'.repeat(48),
      GEMINI_API_KEY: 'mock-key',
      GEMINI_MODEL: 'mock-model',
    });
    const provider = createGeminiProvider(cfg);
    const response = await provider.generate(
      input(),
      'mock-model',
      new AbortController().signal,
    );
    expect(response).toEqual({
      text: '{}',
      metadata: {
        finishReason: 'STOP',
        inputTokens: 120,
        outputTokens: 240,
        totalTokens: 360,
      },
    });
    const sent = generateContent.mock.calls[0]![0];
    expect(sent.model).toBe('mock-model');
    expect(sent.config.tools).toBeUndefined();
    expect(sent.config.automaticContinuation).toBe(false);
    expect(sent.config.httpOptions.retryOptions.attempts).toBe(1);
    expect(sent.config.responseMimeType).toBe('application/json');
    expect(sent.config.responseJsonSchema.properties.questions.minItems).toBe(
      5,
    );
    const document = {
      ...input(),
      kind: 'DOCUMENT' as const,
      topic: '',
      textReviewed: true,
      segments: [
        { label: 'Page 3', text: educationalText },
        { label: 'Page 7', text: 'Photosynthesis converts light energy.' },
      ],
    };
    const original = structuredClone(document);
    await provider.generate(
      document,
      'mock-model',
      new AbortController().signal,
    );
    await provider.generate(
      document,
      'mock-model',
      new AbortController().signal,
      {
        category: 'SOURCE_EXCERPT_MISMATCH',
        fields: ['questions.0.source.quote'],
      },
    );
    const documentCalls = generateContent.mock.calls
      .slice(-2)
      .map((call) => call[0]);
    for (const call of documentCalls) {
      expect(JSON.parse(call.contents).material).toEqual([
        { id: 1, text: educationalText },
        { id: 2, text: 'Photosynthesis converts light energy.' },
      ]);
      expect(
        call.config.responseJsonSchema.properties.questions.items.properties
          .source,
      ).toEqual({
        type: 'object',
        additionalProperties: false,
        required: ['id', 'quote'],
        properties: {
          id: { type: 'integer', minimum: 1, maximum: 2 },
          quote: { type: 'string' },
        },
      });
      expect(call.config.maxOutputTokens).toBe(cfg.AI_MAX_OUTPUT_TOKENS);
    }
    expect(document).toEqual(original);
    generateContent.mockRejectedValue({
      status: 404,
      message: 'private-provider-detail',
    });
    await expect(
      provider.generate(input(), 'mock-model', new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      message: 'MODEL_UNAVAILABLE',
    });
    generateContent.mockRejectedValue({ status: 429 });
    await expect(
      provider.generate(input(), 'mock-model', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PROVIDER_QUOTA', retryable: false });
    for (const [finishReason, code, retryable] of [
      ['MAX_TOKENS', 'OUTPUT_TRUNCATED', true],
      ['SAFETY', 'OUTPUT_BLOCKED', false],
      ['UNKNOWN_PRIVATE_REASON', 'OUTPUT_BLOCKED', false],
    ] as const) {
      generateContent.mockResolvedValue({
        text: 'private text',
        candidates: [{ finishReason }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          totalTokenCount: 30,
        },
      });
      await expect(
        provider.generate(input(), 'mock-model', new AbortController().signal),
      ).rejects.toMatchObject({
        code,
        retryable,
        metadata: {
          finishReason:
            finishReason === 'UNKNOWN_PRIVATE_REASON'
              ? 'UNKNOWN'
              : finishReason,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      });
    }
    for (const [status, code, retryable] of [
      [401, 'PROVIDER_CONFIGURATION', false],
      [403, 'PROVIDER_CONFIGURATION', false],
      [400, 'PROVIDER_REQUEST', false],
      [503, 'PROVIDER_TEMPORARY', true],
    ] as const) {
      generateContent.mockRejectedValue({ status, message: 'private detail' });
      await expect(
        provider.generate(input(), 'mock-model', new AbortController().signal),
      ).rejects.toMatchObject({ code, retryable, message: code });
    }
    generateContent.mockResolvedValue({
      text: '{}',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: -1,
        candidatesTokenCount: NaN,
        totalTokenCount: 30,
      },
    });
    const withoutInvalidCounts = await provider.generate(
      input(),
      'mock-model',
      new AbortController().signal,
      { category: 'INVALID_FIELDS', fields: ['questions.0.explanation'] },
    );
    expect(JSON.stringify(withoutInvalidCounts)).not.toContain('inputTokens');
    expect(JSON.stringify(withoutInvalidCounts)).not.toContain('outputTokens');
    const recoveryPayload = JSON.parse(
      generateContent.mock.calls.at(-1)![0].contents,
    );
    expect(recoveryPayload.recovery).toMatchObject({
      category: 'INVALID_FIELDS',
      fields: ['questions.0.explanation'],
    });
    expect(recoveryPayload.recovery).not.toHaveProperty('rawResponse');
    vi.doUnmock('@google/genai');
  });
});

describe('conservative response normalization and diagnostics', () => {
  it('normalizes only case, surrounding whitespace and explicit A-D labels', () => {
    const request = input();
    const output = mockQuestions(request);
    Object.assign(output.questions[0]!, {
      difficulty: ' medium ',
      correctOption: ' a ',
      prompt: '  A valid prompt  ',
    });
    const result = validateOutput(JSON.stringify(output), request);
    expect(result.questions[0]).toMatchObject({
      difficulty: 'MEDIUM',
      correctOption: 0,
      prompt: 'A valid prompt',
    });
  });
  it('never guesses numeric strings, fills explanations, drops invalid questions or invents sources', () => {
    for (const patch of [
      { correctOption: '1' },
      { correctOption: 'Answer A' },
      { explanation: undefined },
      { options: ['a', 'b', 'c'] },
      { source: { label: 'Page 1', quote: 'invented' } },
    ]) {
      const request = input();
      const output = mockQuestions(request);
      Object.assign(output.questions[0]!, patch);
      expect(() => validateOutput(JSON.stringify(output), request)).toThrow();
    }
  });
  it('identifies malformed, count, duplicate and source failures without retaining content', () => {
    const request = input();
    const output = mockQuestions(request);
    const check = (raw: string, code: string) => {
      try {
        validateOutput(raw, request);
        throw new Error('Expected failure');
      } catch (error) {
        expect(error).toMatchObject({ code, message: code });
        expect(JSON.stringify(error)).not.toContain('private-content');
      }
    };
    check('{private-content', 'MALFORMED_JSON');
    check(
      JSON.stringify({ questions: output.questions.slice(1) }),
      'QUESTION_COUNT',
    );
    output.questions[1]!.prompt = output.questions[0]!.prompt;
    check(JSON.stringify(output), 'DUPLICATE_QUESTIONS');
    Object.assign(output.questions[0]!, { correctOption: 'private-content' });
    check(JSON.stringify(output), 'INVALID_FIELDS');
  });
});

describe('hybrid document source references', () => {
  const document = (text = educationalText) =>
    generationInputSchema.parse({
      ...input(),
      kind: 'DOCUMENT',
      topic: '',
      textReviewed: true,
      segments: [
        { label: 'Page 1', text },
        {
          label: 'Page 2',
          text: 'Photosynthesis converts light energy into chemical energy in chloroplasts.',
        },
      ],
    });
  it('resolves the last source ID only within the current reviewed document', () => {
    const request = document();
    const response = mockQuestions(request);
    const quote = request.segments[1]!.text;
    response.questions[0]!.source = { id: 2, quote };
    expect(
      validateOutput(JSON.stringify(response), request).questions[0]!.source,
    ).toEqual({ label: 'Page 2', quote });
    const otherDocument = structuredClone(request);
    otherDocument.segments[1]!.text =
      'A different reviewed passage about nuclear DNA.';
    expect(() =>
      validateOutput(JSON.stringify(response), otherDocument),
    ).toThrowError(
      expect.objectContaining({ code: 'SOURCE_EXCERPT_MISMATCH' }),
    );
  });
  it.each([
    [
      'The cell  membrane regulates transport.',
      'The cell membrane regulates transport.',
    ],
    [
      'The cell\r\nmembrane regulates transport.',
      'The cell membrane regulates transport.',
    ],
    [
      'The cell\u00a0membrane regulates transport.',
      'The cell membrane regulates transport.',
    ],
    [
      'The cell\tmembrane regulates transport.',
      'The cell membrane regulates transport.',
    ],
    ['A caf\u0065\u0301 contains cells.', 'A caf\u00e9 contains cells.'],
  ])('accepts only equivalent Unicode and whitespace: %s', (text, quote) => {
    const request = document(text + ' ' + educationalText);
    const original = structuredClone(request);
    const response = mockQuestions(request);
    response.questions[0]!.source = { id: 1, quote };
    const result = validateOutput(JSON.stringify(response), request);
    expect(result.questions[0]!.source).toEqual({ label: 'Page 1', quote });
    expect(result.questions[0]!.source).not.toHaveProperty('id');
    expect(request).toEqual(original);
  });
  it.each([
    ['The rate is -2.', 'The rate is 2.'],
    ['The charge is \u22122.', 'The charge is -2.'],
    ['The rate is 10.', 'The rate is 100.'],
    ['Transport does not require ATP.', 'Transport does require ATP.'],
    [
      'A cell\u2019s membrane controls transport.',
      "A cell's membrane controls transport.",
    ],
    ['The mem-\nbrane controls transport.', 'The membrane controls transport.'],
    [
      'The mem\u00adbrane controls transport.',
      'The membrane controls transport.',
    ],
    ['A \ufb01lter controls transport.', 'A filter controls transport.'],
    ['x\u00b2 is a square.', 'x2 is a square.'],
    [
      'The cell membrane regulates transport.',
      'Cell membranes control transport.',
    ],
  ])(
    'rejects punctuation, mathematical, hyphenation and wording changes: %s',
    (text, quote) => {
      const request = document(text + ' ' + educationalText);
      const response = mockQuestions(request);
      response.questions[0]!.source = { id: 1, quote };
      expect(() =>
        validateOutput(JSON.stringify(response), request),
      ).toThrowError(
        expect.objectContaining({
          code: 'SOURCE_EXCERPT_MISMATCH',
          fields: ['questions.0.source.quote'],
        }),
      );
    },
  );
  it.each([
    [null, 'SOURCE_MISSING', 'questions.0.source'],
    [undefined, 'SOURCE_MISSING', 'questions.0.source'],
    [{ quote: 'A copied excerpt' }, 'SOURCE_MISSING', 'questions.0.source.id'],
    [{ id: 1 }, 'SOURCE_MISSING', 'questions.0.source.quote'],
    [
      { id: 999, quote: educationalText.slice(0, 30) },
      'SOURCE_ID_UNKNOWN',
      'questions.0.source.id',
    ],
    [
      { id: '1', quote: educationalText.slice(0, 30) },
      'SOURCE_ID_UNKNOWN',
      'questions.0.source.id',
    ],
    [
      { id: 1.5, quote: educationalText.slice(0, 30) },
      'SOURCE_ID_UNKNOWN',
      'questions.0.source.id',
    ],
    [
      { id: 0, quote: educationalText.slice(0, 30) },
      'SOURCE_ID_UNKNOWN',
      'questions.0.source.id',
    ],
    [
      { id: 2, quote: educationalText.slice(0, 30) },
      'SOURCE_EXCERPT_MISMATCH',
      'questions.0.source.quote',
    ],
    [
      { id: 1, quote: 'invented-private-content' },
      'SOURCE_EXCERPT_MISMATCH',
      'questions.0.source.quote',
    ],
    [
      { id: 1, quote: '   ' },
      'SOURCE_EXCERPT_MISMATCH',
      'questions.0.source.quote',
    ],
  ])(
    'reports safe source failures without retaining invalid values: %j',
    (source, code, path) => {
      const request = document();
      const response = mockQuestions(request);
      Object.assign(response.questions[0]!, { source });
      try {
        validateOutput(JSON.stringify(response), request);
        expect.fail('Expected validation failure');
      } catch (error) {
        expect(error).toMatchObject({
          code,
          fields: [path],
          counts: {
            requestedCount: 5,
            returnedCount: 5,
            sourceCount: 2,
            sourceCharacters: request.segments.reduce(
              (n, s) => n + s.text.length,
              0,
            ),
          },
        });
        expect(JSON.stringify(error)).not.toContain('invented-private-content');
        expect(JSON.stringify(error)).not.toContain(educationalText);
      }
    },
  );
  it('reproduces a real PDF extraction line break and accepts the matching single-space excerpt', async () => {
    const segments = await extractContent(pdfWhitespaceFixture(), 'PDF', {
      characters: 40000,
      pages: 100,
    });
    expect(segments[0]!.text).toContain('cell\nmembrane');
    const request = generationInputSchema.parse({ ...document(), segments });
    const response = mockQuestions(request);
    for (const q of response.questions)
      q.source = { id: 1, quote: 'The cell membrane regulates transport.' };
    expect(
      validateOutput(JSON.stringify(response), request).questions,
    ).toHaveLength(5);
    expect(segments[0]!.text).toContain('cell\nmembrane');
  });
  it('rejects oversized excerpts and extra reference fields', () => {
    for (const source of [
      { id: 1, quote: 'x'.repeat(301) },
      { id: 1, quote: educationalText.slice(0, 20), label: 'Page 1' },
    ]) {
      const request = document();
      const response = mockQuestions(request);
      Object.assign(response.questions[0]!, { source });
      expect(() =>
        validateOutput(JSON.stringify(response), request),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_FIELDS' }));
    }
  });
  it('matches a late excerpt in a long document without increasing limits or changing text', () => {
    const text = 'Public educational notes. '.repeat(1500) + educationalText;
    const request = document(text);
    const response = mockQuestions(request);
    response.questions[0]!.source = {
      id: 1,
      quote: educationalText.slice(-65),
    };
    expect(
      validateOutput(JSON.stringify(response), request).questions[0]!.source!
        .quote,
    ).toBe(educationalText.slice(-65));
  });
});
