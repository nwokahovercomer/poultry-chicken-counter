/**
 * Rounded mean of the per-image counts in one set, e.g. [14, 15, 14] -> 14.
 * With 3 integer counts the mean can never land exactly on .5, so JS
 * Math.round matches the desktop app's Python round() here.
 */
export function roundedMeanVote(counts: number[]): number {
  if (counts.length === 0) return 0;
  return Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
}
