/**
 * A message's `{placeholders}` kept out of the provider's hands (`DECISIONS.md` §464).
 *
 * The participant message (§364) may carry `{participantName}`, `{eventTitle}` and the rest of its
 * closed set. Sent as words, a provider may translate one, change its case or put a space inside
 * the braces — and the send then refuses an unknown placeholder instead of the draft coming back
 * intact. So each `{name}` travels as a numbered marker, `{0}`, `{1}`, which carries no word to
 * translate, and is put back byte for byte from the original afterwards. A marker the provider
 * spaced (`{ 0 }`) is still found; one it dropped is simply absent, and the organizer sees the
 * sentence without it before anything is sent.
 *
 * The same pattern as `notifications/domain/email-copy.ts`, so every token the send would read
 * is one this protects — including a literal `{3}` somebody typed, which is swapped like the rest.
 */
const PLACEHOLDER = /\{[A-Za-z0-9_]*\}/g;
const MARKER = /\{\s*(\d+)\s*\}/g;

export type ProtectedText = { text: string; tokens: string[] };

export function protectPlaceholders(text: string): ProtectedText {
  const tokens: string[] = [];
  const protectedText = text.replace(PLACEHOLDER, (token) => {
    tokens.push(token);
    return `{${tokens.length - 1}}`;
  });
  return { text: protectedText, tokens };
}

export function restorePlaceholders(text: string, tokens: readonly string[]): string {
  if (tokens.length === 0) return text;
  return text.replace(MARKER, (marker, index: string) => tokens[Number(index)] ?? marker);
}
