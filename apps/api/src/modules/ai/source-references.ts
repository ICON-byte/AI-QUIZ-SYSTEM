type Segment = { label: string; text: string };

// IDs are ordinals within the immutable reviewed input, never global document IDs.
// Rebuilding this map from the same job input gives identical IDs on every call.
export function documentSources(segments: readonly Segment[]) {
  return segments.map((segment, index) => ({ ...segment, id: index + 1 }));
}

// Comparison copies only: never alter reviewed content, punctuation, case or math.
export function normalizeExcerpt(text: string) {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function containsExcerpt(text: string, quote: string) {
  const normalized = normalizeExcerpt(quote);
  return normalized.length > 0 && normalizeExcerpt(text).includes(normalized);
}
