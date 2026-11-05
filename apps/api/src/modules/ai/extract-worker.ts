import { extractContent, type ExtractionLimits } from './extract-content.js';

process.once(
  'message',
  (message: { base64: string; kind: string; limits: ExtractionLimits }) => {
    void extractContent(
      Buffer.from(message.base64, 'base64'),
      message.kind,
      message.limits,
    )
      .then((segments) => process.send?.({ segments }))
      .catch(() => process.send?.({ error: true }))
      .finally(() => process.disconnect());
  },
);
