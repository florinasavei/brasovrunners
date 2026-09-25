import Box from "@mui/material/Box";

/**
 * The one styling of a repository document's rendered HTML (`repo-docs.ts`), shared by
 * `/devs/docs/[name]` and `/admin/tasks`'s "Aplicația" / "The app" panel (`DECISIONS.md` §88,
 * §397) — a single place that knows what `marked` writes, rather than two copies drifting apart.
 *
 * Task lists (`- [ ]` / `- [x]`) are GFM, which `marked` already renders as a `<li>` holding a
 * disabled `<input type="checkbox">` and the item's text — no extension needed. This is the one
 * rule that draws it: the checkbox sits inline with its text at a readable size, never the
 * browser's tiny default next to a full line of copy.
 */
export const REPO_DOC_HTML_SX = {
  maxWidth: 900,
  "& h1": { fontSize: "1.75rem", mt: 4 },
  "& h2": { fontSize: "1.375rem", mt: 4, borderBottom: 1, borderColor: "divider", pb: 0.5 },
  "& h3": { fontSize: "1.125rem", mt: 3 },
  "& h4": { fontSize: "1rem", mt: 2 },
  "& p, & li": { lineHeight: 1.6 },
  "& pre": { overflowX: "auto", p: 2, bgcolor: "action.hover", borderRadius: 1, fontSize: "0.8125rem" },
  "& code": { fontFamily: "monospace", fontSize: "0.875em" },
  "& table": { borderCollapse: "collapse", my: 2, display: "block", overflowX: "auto" },
  "& th, & td": { border: 1, borderColor: "divider", px: 1, py: 0.5, textAlign: "left", verticalAlign: "top" },
  "& blockquote": { borderLeft: 3, borderColor: "divider", pl: 2, ml: 0, color: "text.secondary" },
  "& a": { color: "primary.main" },
  "& input[type='checkbox']": { width: 16, height: 16, mr: 1, verticalAlign: "middle" },
} as const;

/**
 * `html` is the repository's own Markdown, rendered server-side by `renderRepoDoc` — written by
 * the people who deploy this and read by the roles that can already read `/devs`, never user
 * input.
 */
export default function RepoDocHtml({ html }: { html: string }) {
  return <Box dangerouslySetInnerHTML={{ __html: html }} sx={REPO_DOC_HTML_SX} />;
}
