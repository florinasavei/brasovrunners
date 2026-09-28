/**
 * A message's `{placeholders}` (§364) sent as numbered markers `{0}`, `{1}` so the provider cannot
 * translate or respace them, then restored byte for byte (`DECISIONS.md` §464). A spaced marker
 * (`{ 0 }`) is still found; a dropped one stays absent for the organizer to see.
 * Same pattern as `notifications/domain/email-copy.ts`, so every token the send reads is protected.
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
