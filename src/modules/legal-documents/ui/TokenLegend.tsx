import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import FieldLegend from "@/shared/ui/FieldLegend";
import { DECLARATION_TOKENS, type TokenLocale, tokensUsedIn } from "../templates/tokens";

/**
 * What each `{{token}}` in the declaration becomes, with a real example value (§190), in the
 * reader's language first and the other where it differs (§369). Tokens the current draft
 * carries are marked, so a lost one shows before the first signature. Server-rendered; copying
 * a `<code>` token is the browser's job.
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
