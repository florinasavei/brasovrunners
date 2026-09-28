/**
 * A Server Action's key, stamped on its `<form>` so the blocked-save fallback can find the same
 * form in the server's HTML (§436, `save-fallback.ts`).
 *
 * `$$id` (React's `registerServerReference`) is no secret — the no-JavaScript form prints it — and
 * `$$bound` is folded into a short hash. Not a Server Action reference: no key.
 */
export function actionKeyOf(action: unknown): string | undefined {
  if (typeof action !== "function") return undefined;
  const reference = action as { $$id?: unknown; $$bound?: unknown };
  if (typeof reference.$$id !== "string" || reference.$$id === "") return undefined;
  if (reference.$$bound === null || reference.$$bound === undefined) return reference.$$id;
  let bound: string;
  try {
    bound = JSON.stringify(reference.$$bound) ?? "";
  } catch {
    // Unserializable bound arguments cannot be compared.
    return undefined;
  }
  return `${reference.$$id}.${fnv1a(bound)}`;
}

/** FNV-1a, 32 bits, as eight hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
