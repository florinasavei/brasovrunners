/**
 * A page address from a title (§350): "Crosul Tâmpei 2026" → `crosul-tampei-2026`. Lowercase,
 * the diacritics dropped (ș, ț, ă, â, î — both the comma and the cedilla forms decompose), every
 * run of anything else one hyphen, none at either end, at most the 120 characters `fields.ts`
 * allows. The server still validates what is posted; this only saves typing it.
 */
export function slugFromTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}
