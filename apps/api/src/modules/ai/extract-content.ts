import { Unzip, UnzipInflate } from 'fflate';
import mammoth from 'mammoth';

export type ExtractionLimits = { characters: number; pages: number };
export type Segment = { label: string; text: string };

// Inflate in bounded chunks before Mammoth sees the archive, including unused entries.
function validateDocxArchive(bytes: Uint8Array) {
  let total = 0;
  let entries = 0;
  let document = false;
  let types = false;
  const unzip = new Unzip((file) => {
    if (
      ++entries > 1000 ||
      (file.originalSize ?? 0) > 20 * 1024 * 1024 ||
      /(^|\/)\.\.(\/|$)/.test(file.name)
    )
      throw new Error('Unsupported DOCX archive');
    if (file.name === 'word/document.xml') document = true;
    if (file.name === '[Content_Types].xml') types = true;
    file.ondata = (error, chunk) => {
      if (error) throw error;
      total += chunk.length;
      if (total > 20 * 1024 * 1024) {
        file.terminate();
        throw new Error('DOCX expansion limit');
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let at = 0; at < bytes.length; at += 4096)
    unzip.push(bytes.subarray(at, at + 4096), at + 4096 >= bytes.length);
  if (!document || !types) throw new Error('Not a DOCX document');
}
export async function extractContent(
  buffer: Buffer,
  kind: string,
  limits: ExtractionLimits,
): Promise<Segment[]> {
  let segments: Segment[] = [];
  const bounded = (text: string) => {
    if (text.length > limits.characters)
      throw new Error(
        'Extracted text exceeds the character limit. Split the document and try again.',
      );
    return text;
  };
  if (kind === 'TXT') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (code < 32 && ![9, 10, 13].includes(code))
        throw new Error('Use a UTF-8 text document without binary content.');
    }
    segments = bounded(text)
      .split(/\n\s*\n/)
      .filter((s) => s.trim())
      .map((text, i) => ({ label: `Paragraph ${i + 1}`, text: text.trim() }));
  } else if (kind === 'DOCX') {
    if (buffer.readUInt32LE(0) !== 0x04034b50)
      throw new Error('Invalid DOCX document.');
    validateDocxArchive(buffer);
    // Raw-text extraction does not resolve external resources; only the in-memory ZIP is supplied.
    const result = await mammoth.extractRawText({ buffer });
    segments = bounded(result.value)
      .split(/\n\s*\n/)
      .filter((s) => s.trim())
      .map((text, i) => ({ label: `Paragraph ${i + 1}`, text: text.trim() }));
  } else if (kind === 'PDF') {
    if (buffer.subarray(0, 5).toString() !== '%PDF-')
      throw new Error('Invalid PDF document.');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      stopAtErrors: true,
      verbosity: 0,
    });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > limits.pages)
        throw new Error(
          'The PDF exceeds the page limit. Split it and try again.',
        );
      let length = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) =>
            'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '',
          )
          .join('')
          .trim();
        length += text.length;
        if (length > limits.characters)
          throw new Error(
            'Extracted text exceeds the character limit. Split the document and try again.',
          );
        if (text) segments.push({ label: `Page ${i}`, text });
        page.cleanup();
      }
    } finally {
      await task.destroy();
    }
  } else throw new Error('Unsupported document type.');
  const length = segments.reduce((n, s) => n + s.text.length, 0);
  if (length < 100)
    throw new Error(
      'Not enough readable text. Use a text-based document with at least 100 characters; OCR is not supported.',
    );
  if (segments.length > 200)
    throw new Error(
      'Too many text sections. Split the document and try again.',
    );
  return segments;
}
