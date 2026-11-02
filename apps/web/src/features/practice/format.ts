export function duration(seconds: number) {
  // taste-skill-ignore: zero-padding is for a minutes:seconds clock.
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function timerLabel(seconds: number | null) {
  return seconds === null ? 'No time limit' : `${seconds / 60} minute limit`;
}
export function safeError(error: unknown) {
  return error instanceof Error
    ? error
    : new Error('Something went wrong. Please try again.');
}
