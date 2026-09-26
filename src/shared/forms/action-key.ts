/**
 * A name for a Server Action that the server can print and the browser can look for (§NNN).
 *
 * The fallback of a blocked save (`save-fallback.ts`) re-sends a form as a plain browser POST, and
 * that POST has to name the action the way React's own no-JavaScript form does — hidden
 * `$ACTION_…` fields that only the server's HTML render writes. A form the browser drew itself,
 * after a client-side navigation, has none; the fallback then fetches the page's HTML and takes the
 * fields from the same form there. "The same form" is this key: stamped on the `<form>` by the
 * server in both renders, so the two can be matched without guessing by position alone.
 *
 * On the server a Server Action reference carries its id as `$$id` and its bound arguments as
 * `$$bound` (React's `registerServerReference`). The id is not a secret — the no-JavaScript form
 * prints it in its hidden fields already, and the RSC payload carries it — so it goes out as it
 * is; bound arguments are folded into a short hash, which is all a comparison needs. Anything that
 * is not a Server Action reference (a plain function in a unit test, a client-side call) has no
 * key, and the fallback then relies on the fields the page already holds.
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
    // Bound arguments that do not serialize cannot be compared; no key is the honest answer.
    return undefined;
  }
  return `${reference.$$id}.${fnv1a(bound)}`;
}

/** FNV-1a, 32 bits, as eight hex digits: short, stable, and nothing more is asked of it. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
