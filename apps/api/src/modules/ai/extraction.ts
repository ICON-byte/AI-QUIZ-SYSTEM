import { fork } from 'node:child_process';
import type { Config } from '../../config/env.js';
import { HttpError } from '../../middleware/errors.js';
import { z } from 'zod';
import { segmentSchema } from './validation.js';

export function createExtractor(config: Config) {
  let busy = false;
  return async (buffer: Buffer, filename: string, mime: string) => {
    const extension = filename.toLowerCase().split('.').pop();
    const kinds: Record<string, { kind: string; mimes: string[] }> = {
      pdf: { kind: 'PDF', mimes: ['application/pdf'] },
      docx: {
        kind: 'DOCX',
        mimes: [
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
      },
      txt: { kind: 'TXT', mimes: ['text/plain'] },
    };
    const format = kinds[extension ?? ''];
    if (
      !format ||
      (!format.mimes.includes(mime) && mime !== 'application/octet-stream') ||
      !buffer.length ||
      buffer.length > config.AI_DOCUMENT_MAX_BYTES
    )
      throw new HttpError(
        400,
        'INVALID_DOCUMENT',
        'Choose a supported, nonempty PDF, DOCX or UTF-8 TXT file within the size limit.',
      );
    if (busy)
      throw new HttpError(
        429,
        'EXTRACTION_BUSY',
        'A document is being processed. Please try again shortly.',
      );
    busy = true;
    try {
      return await new Promise<{ segments: z.infer<typeof segmentSchema>[] }>(
        (resolve, reject) => {
          const child = fork(
            new URL(
              import.meta.url.endsWith('.ts')
                ? './extract-worker.ts'
                : './extract-worker.js',
              import.meta.url,
            ),
            [],
            {
              execArgv: [
                '--max-old-space-size=256',
                ...(import.meta.url.endsWith('.ts') ? ['--import', 'tsx'] : []),
              ],
              env: {
                NODE_ENV: 'production',
                ...(process.env.SystemRoot
                  ? { SystemRoot: process.env.SystemRoot }
                  : {}),
              },
              stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
              windowsHide: true,
            },
          );
          let settled = false;
          const finish = (segments?: z.infer<typeof segmentSchema>[]) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.kill();
            if (segments) resolve({ segments });
            else
              reject(
                new HttpError(
                  400,
                  'EXTRACTION_FAILED',
                  'Could not extract usable text within the document limits. Use a smaller, text-based, unencrypted document; scanned PDFs and OCR are not supported.',
                ),
              );
          };
          const timer = setTimeout(
            () => finish(),
            config.AI_EXTRACTION_TIMEOUT_SECONDS * 1000,
          );
          child.once('error', () => finish());
          child.once('exit', () => finish());
          child.once('message', (message) => {
            const parsed = z
              .object({ segments: z.array(segmentSchema).min(1).max(200) })
              .safeParse(message);
            finish(
              parsed.success &&
                parsed.data.segments.reduce((n, s) => n + s.text.length, 0) <=
                  config.AI_DOCUMENT_MAX_CHARACTERS
                ? parsed.data.segments
                : undefined,
            );
          });
          child.send(
            {
              base64: buffer.toString('base64'),
              kind: format.kind,
              limits: {
                characters: config.AI_DOCUMENT_MAX_CHARACTERS,
                pages: config.AI_DOCUMENT_MAX_PAGES,
              },
            },
            (error) => {
              if (error) finish();
            },
          );
        },
      );
    } finally {
      busy = false;
    }
  };
}
