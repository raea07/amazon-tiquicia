/**
 * Ends a sentence with one full stop. A time formatted for Costa Rica
 * already ends with one ("12:32 a. m."), so writing `${time}.` showed two.
 */
export function endSentence(text: string): string {
  const trimmed = text.trimEnd();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
