/**
 * A catalogue template's `{name}` placeholders, filled — for words that reach a place `t()` cannot
 * go: a client island handed raw strings, or a pure function handed `t.raw(...)`'s templates
 * (§350). A placeholder with no value stays visible rather than blank, so a missing value is seen.
 */
export function fillIn(template: string, values: Readonly<Record<string, string | number>> = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => (name in values ? String(values[name]) : placeholder));
}
