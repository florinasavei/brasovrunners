/**
 * A page address from a title (§350): "Crosul Tâmpei 2026" → `crosul-tampei-2026`. Diacritics
 * dropped (comma and cedilla forms alike), runs of anything else one hyphen, at most the 120
 * characters `fields.ts` allows. The server still validates what is posted.
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
