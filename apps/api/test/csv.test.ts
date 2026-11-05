import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  csvCell,
  csvTemplate,
  headers,
  importTokens,
  previewCsv,
} from '../src/modules/banks/csv.js';

const header = headers.join(',');
const row = 'Which is prime?,2,4,6,8,A,Two factors.,EASY,Numbers';
describe('CSV parsing and import confirmation', () => {
  it('parses the template, BOM, CRLF, quoted commas, quotes and multiline explanations', () => {
    expect(previewCsv(csvTemplate()).validCount).toBe(1);
    const parsed = previewCsv(
      `\uFEFF${header}\r\n"Which, exactly?",2,4,6,8,a,"Two\r\nfactors and ""one"" prime.",easy,Numbers\r\n`,
    );
    expect(parsed.rows[0]?.question?.prompt).toBe('Which, exactly?');
    expect(parsed.rows[0]?.question?.explanation).toContain('"one"');
    expect(parsed.rows[0]?.row).toBe(2);
  });
  it('supports reordered headers without losing fields', () => {
    const parsed = previewCsv(
      `${[...headers].reverse().join(',')}\n${row.split(',').reverse().join(',')}`,
    );
    expect(parsed.rows[0]?.question?.correctOption).toBe(0);
    expect(parsed.rows[0]?.question?.topic).toBe('Numbers');
  });
  it('reports every invalid record and missing fields rather than silently dropping rows', () => {
    const parsed = previewCsv(
      `${header}\n${row}\n,2,2,,8,F,,impossible,Numbers\nOnly a question`,
    );
    expect(parsed.validCount).toBe(1);
    expect(parsed.invalidCount).toBe(2);
    expect(parsed.rows[1]?.row).toBe(3);
    expect(parsed.rows[1]?.errors.length).toBeGreaterThanOrEqual(4);
    expect(parsed.rows[2]?.errors).toContain('Expected nine fields.');
  });
  it('rejects malformed quotes, binary data and duplicate/missing headers', () => {
    expect(() => previewCsv(`${header}\n"unterminated`)).toThrow(
      'Malformed CSV',
    );
    expect(() => previewCsv(`${header}\n${row}\0`)).toThrow('UTF-8');
    expect(() =>
      previewCsv(`${header.replace('Topic', 'Question')}\n${row}`),
    ).toThrow('nine template headers');
  });
  it('enforces byte, record size and row limits including empty input', () => {
    expect(() => previewCsv('a'.repeat(1024 * 1024 + 1))).toThrow();
    expect(() =>
      previewCsv(`${header}\n${Array(201).fill(row).join('\n')}`),
    ).toThrow('200');
    expect(() => previewCsv(`${header}\n`)).toThrow('1 and 200');
    expect(() => previewCsv(`${header}\n${'x'.repeat(13000)}`)).toThrow(
      'Malformed CSV',
    );
  });
  it('escapes formula cells when exporting without altering ordinary text', () => {
    for (const input of ['=SUM(1,2)', '+1', '-2', '@a', '\tdata', '  =1'])
      expect(csvCell(input).startsWith('"\'')).toBe(true);
    expect(csvCell('A "quoted" value')).toBe('"A ""quoted"" value"');
    expect(csvTemplate()).not.toMatch(/"[=+@-]/);
  });
  it('binds previews to the user, bank, exact CSV and expiry with a tamper-proof signature', () => {
    const tokens = importTokens('test-secret');
    const userId = randomUUID();
    const bankId = randomUUID();
    const preview = tokens.create(userId, bankId, row);
    expect(tokens.verify(preview.token, userId, bankId, row)).toHaveLength(64);
    expect(() =>
      tokens.verify(preview.token, randomUUID(), bankId, row),
    ).toThrow('expired or changed');
    expect(() =>
      tokens.verify(preview.token, userId, randomUUID(), row),
    ).toThrow();
    expect(() =>
      tokens.verify(preview.token, userId, bankId, row + ' '),
    ).toThrow();
    expect(() =>
      tokens.verify(preview.token + 'x', userId, bankId, row),
    ).toThrow();
    expect(() =>
      importTokens('other').verify(preview.token, userId, bankId, row),
    ).toThrow();
  });
});
