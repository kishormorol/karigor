/** Pure functions live in src/lib and are the easiest things to unit test. */
export function healthMessage(now: Date = new Date()): string {
  return `ok at ${now.toISOString()}`;
}
