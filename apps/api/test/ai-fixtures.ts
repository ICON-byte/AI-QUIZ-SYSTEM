import { zipSync, strToU8 } from 'fflate';
import type { GenerationInput } from '../src/modules/ai/validation.js';

export const educationalText =
  'The cell membrane regulates substances entering and leaving a cell. The nucleus contains most cellular DNA. Mitochondria produce ATP through respiration. Ribosomes synthesize proteins.';
export function docxFixture(text = educationalText) {
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      'word/document.xml': strToU8(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
      ),
    }),
  );
}
export function pdfFixture(text = educationalText) {
  const stream = `BT /F1 10 Tf 40 750 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, '0') + ' 00000 n ')
    .join(
      '\n',
    )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}
export function mockQuestions(input: GenerationInput) {
  return {
    questions: Array.from({ length: input.count }, (_, i) => ({
      prompt: `Which cellular structure regulates transport? Variation ${i + 1}`,
      options: ['Cell membrane', 'Nucleus', 'Ribosome', 'Mitochondrion'] as [
        string,
        string,
        string,
        string,
      ],
      correctOption: 0,
      explanation: 'The cell membrane regulates the transport of substances.',
      difficulty: input.difficulty,
      topic: 'Cell biology',
      source:
        input.kind === 'DOCUMENT'
          ? {
              label: input.segments[0]!.label,
              quote: input.segments[0]!.text.slice(0, 80),
            }
          : null,
    })),
  };
}
