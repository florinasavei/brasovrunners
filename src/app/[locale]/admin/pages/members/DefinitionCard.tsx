import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import {
  DEFAULT_MEMBER_DEFINITION,
  MEMBER_DEFINITION_MAX,
  type MemberDefinition,
  memberDefinitionFor,
} from "@/modules/content/members/member-definition";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import Panel from "@/shared/ui/Panel";
import { saveMemberDefinitionAction } from "./actions";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** The two boxes of the sentence, in the site's order: the tab's code, the posted name's part (as the page's other texts). */
const LANGUAGES = [
  { locale: "ro", code: "RO", suffix: "Ro" },
  { locale: "en", code: "EN", suffix: "En" },
] as const;

/**
 * «Cine e membru» (§NNN; the owner, 2026-10-16: «asta ar trebui configurabil în back-office ce înseamnă
 * să fii membru»): the club's one sentence, in both languages or neither, behind the «?» after the tick
 * «Sunt membru al grupului» on the registration form and on the volunteers' form. Nothing is checked
 * against it: the tick stays a claim (§48). Written, or left empty — the forms then say the platform's own
 * words, which the empty boxes show as their placeholder. The house's `Panel` (closed until opened, its
 * state on the line) with the page's own `LocaleTabPanels` tabs «RO» | «EN», each box a `RecallField`
 * (§315) and, under the English one, «Tradu din română» (§464). Saved by its own form, never through the
 * members' page's switch.
 */
export default function DefinitionCard({
  definition,
  platformWords,
  locale,
  words: t,
  messages,
  mayEdit,
}: {
  definition: MemberDefinition;
  platformWords: Record<"ro" | "en", string>;
  locale: Locale;
  words: Words;
  messages: RefusalMessages;
  mayEdit: boolean;
}) {
  const written = definition.ro !== null && definition.en !== null;
  const inForce = memberDefinitionFor(locale, written ? definition : DEFAULT_MEMBER_DEFINITION) ?? platformWords[locale];
  return (
    <Panel
      glyph="memberDefinition"
      collapsible
      title={t("members.definition.heading")}
      aside={written ? t("members.definition.asideWritten") : t("members.definition.asideDefault")}
      intro={t("members.definition.intro")}
      id="members-definition"
      data-testid="members-definition"
    >
      {mayEdit ? (
        <ActionForm action={saveMemberDefinitionAction} messages={messages} scope="definition" data-testid="members-definition-form">
          <input type="hidden" name="uiLocale" value={locale} />
          <Stack spacing={1.5}>
            <LocaleTabPanels
              idPrefix="members-definition"
              watch={{ names: ["memberDefinition{Locale}"], rule: "parity" }}
              markLabel={t("members.tabEmpty")}
              panels={LANGUAGES.map((language) => {
                const other = language.locale === "ro" ? definition.en : definition.ro;
                const own = definition[language.locale];
                return {
                  locale: language.locale,
                  label: language.code,
                  incompleteLabel: own === null && other !== null ? t("members.tabEmpty") : undefined,
                  content: (
                    <Stack spacing={1}>
                      <RecallField
                        name={`memberDefinition${language.suffix}`}
                        label={t(`members.definition.${language.locale}`)}
                        placeholder={platformWords[language.locale]}
                        defaultValue={own ?? ""}
                        fullWidth
                        multiline
                        minRows={2}
                        slotProps={{ htmlInput: { maxLength: MEMBER_DEFINITION_MAX, lang: language.locale } }}
                      />
                      {/* «Tradu din română» (§464): the English sentence from the Romanian one. */}
                      {language.locale === "en" && <TranslateFieldButton en="memberDefinitionEn" />}
                    </Stack>
                  ),
                };
              })}
            />
            <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
              {t("members.definition.help", { max: MEMBER_DEFINITION_MAX })}
            </Typography>
          </Stack>
          <Box sx={{ mt: 2 }}>
            <GlyphSubmitButton label={t("editor.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
          </Box>
        </ActionForm>
      ) : (
        <Typography variant="body2" data-testid="members-definition-words">
          {inForce}
        </Typography>
      )}
    </Panel>
  );
}
