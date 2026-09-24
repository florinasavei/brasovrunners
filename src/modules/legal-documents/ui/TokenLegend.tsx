import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import FieldLegend from "@/shared/ui/FieldLegend";
import { DECLARATION_TOKENS, type TokenLocale, tokensUsedIn } from "../templates/tokens";

/**
 * What each `{{token}}` in the declaration becomes, beside the box where the text is written
 * (`DECISIONS.md` §190).
 *
 * The list was already in the body field's helper text — one long sentence under a twelve-row
 * textarea, which is where a reader's eye does not go. As a table it answers the two questions
 * somebody writing a declaration actually has: *is this token real*, and *what will a runner see
 * in its place*. The example is a real value rather than a description, because "the participant's
 * registered name" and "Ana Popescu" are not equally easy to check against a draft.
 *
 * A Server Component, and each token is plain text inside a `<code>`: selecting and copying one
 * is the browser's job, and a click-to-insert control would be a client island owning a textarea
 * this form deliberately keeps native. The rows are `shared/ui/FieldLegend`, the layout the
 * emails' legend shares (§NNN, email follow-up).
 *
 * `usedIn` marks the ones the current draft already carries — so a text that lost `{{eventDate}}`
 * in an edit says so on the page rather than at the first signature.
 *
 * The example is in both languages where they differ (§369): the form writes the Romanian and
 * the English text on one screen, and each becomes its own words at a signature. The reader's
 * language first, the other after it, each marked with its `lang`.
 */
export default async function TokenLegend({ body }: { body?: string }) {
  const t = await getTranslations("Admin.legal");
  const locale = await getLocale();
  const first: TokenLocale = locale === "en" ? "en" : "ro";
  const second: TokenLocale = first === "ro" ? "en" : "ro";
  const used = body ? tokensUsedIn(body) : null;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {t("tokens.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t("tokens.intro")}
      </Typography>
      <FieldLegend
        rows={DECLARATION_TOKENS.map((entry) => ({
          token: entry.token,
          meaning: t(`tokens.${entry.messageKey}`),
          example: (
            <>
              <span lang={first}>{entry.example[first]}</span>
              {entry.example[second] !== entry.example[first] && (
                <>
                  {" / "}
                  <span lang={second}>{entry.example[second]}</span>
                </>
              )}
            </>
          ),
          marks: used?.has(entry.token) ? [{ label: t("tokens.inText"), tone: "success" as const }] : undefined,
        }))}
      />
    </Paper>
  );
}
