import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import { TIER_DESCRIPTION_MAX, TIER_NAME_MAX } from "@/modules/content/member-tiers/fields";
import type { AdminMemberTier } from "@/modules/content/member-tiers/admin-repository";
import { NEW_TIER_ROW_KEY, tierBox } from "@/modules/content/member-tiers/tier-rows";
import TranslateCardButton from "@/modules/translate/ui/TranslateCardButton";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import StatusChip from "@/shared/ui/StatusChip";
import { deleteMemberTierAction, saveMemberTiersAction } from "./actions";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** The id of the small form behind one level's «Șterge nivelul»: the button sits in the level's row, inside the one form, and names this one (`form=`). */
const deleteFormId = (id: string) => `delete-tier-${id}`;

/**
 * «Niveluri de membru» (§811; the owner, 2026-10-18: «Also for the member zone I want member Tiers»): the levels
 * the club names for its members, one fold on «Pagini» → «Membri», closed until opened (§336), the count on its
 * line. A level is the staff's label, never a permission and never shown to a member (§817; the owner: «Doar adminii
 * văd nivelul de membru, scopul e ca să bifăm ce membru poate vedea ce cod de reducere») — the card says what it is for
 * under its title.
 *
 * ONE form, ONE «Salvează toate nivelurile» (§791's roles editor is the model): a row per level — its name and its
 * note for the administrators as one Română | English strip (§572), «Poziția» (the club's order, from 1), «Ascuns» —
 * and the blank row at the end that adds a level. A level that only moved over is never audited as edited. «Șterge
 * nivelul» is its own confirmed action outside the form (forms do not nest): a small hidden form beside the big one
 * that the row's button names (`form=`); refused while a member holds the level or a code is for it alone.
 * «Tradu cardul: RO → EN» translates every English box of the card whose Romanian twin has words
 * (`data-translate-scope`, §514 adapted for a card with no tab row of its own).
 *
 * The Administrator's (`canManageMemberTiers`); the others see the list and the counts, no box — the service asserts
 * the role again (BR-REQ-060-01). Server Component over the house's `Panel`, `LocaleTabPanels`,
 * `CheckboxField`, `StatusChip` and `QuietHelp`: nothing here is new but the card. There is no glyph box: the `glyph`
 * column stays as it was (a later contract migration drops it) and a save leaves it as it is.
 */
export default function TiersCard({
  tiers,
  locale,
  words: t,
  cancel,
  messages,
  mayManage,
  saved,
}: {
  tiers: readonly AdminMemberTier[];
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  mayManage: boolean;
  /** The query's `saved` code: the card opens by itself after its own save (`Panel` `openWhen`, §336). */
  saved?: string;
}) {
  const count = t(`members.tiers.count.${countForm(tiers.length, locale)}`, { count: tiers.length });

  /** One level's row, or the blank one at the end (`tier` null): every box named by its row's key (`tier-rows.ts`), all posted by the card's one form. */
  const rowOf = (tier: AdminMemberTier | null, index: number) => {
    const key = tier ? tier.tier.id : NEW_TIER_ROW_KEY;
    const box = (name: Parameters<typeof tierBox>[1]) => tierBox(key, name);
    // The name in the Administrator's own language, as the read-only list below and the codes card draw it.
    const shownName = tier ? (locale === "en" ? tier.tier.nameEn : tier.tier.nameRo) : "";
    const title = tier ? shownName : t("members.tiers.newRow");
    // One language's name and description, for the strip's panel; the English panel carries «Tradu din română» under each box (§464).
    const languagePanel = (language: "ro" | "en") => {
      const side = language === "ro" ? "Ro" : "En";
      return (
        <Stack spacing={1} sx={{ pt: 0.5 }}>
          <RecallField
            name={box(`name${side}`)}
            label={t(`members.tiers.name${side}`)}
            defaultValue={tier?.tier[`name${side}`] ?? ""}
            // A saved level keeps both names; the blank row is a level only once a name is typed in it.
            required={tier !== null}
            size="small"
            fullWidth
            slotProps={{ htmlInput: { maxLength: TIER_NAME_MAX, lang: language } }}
          />
          {language === "en" && <TranslateFieldButton en={box("nameEn")} />}
          <RecallField
            name={box(`description${side}`)}
            label={t(`members.tiers.description${side}`)}
            defaultValue={tier?.tier[`description${side}`] ?? ""}
            multiline
            minRows={2}
            size="small"
            fullWidth
            helperText={language === "ro" ? t("members.tiers.descriptionHelp", { max: String(TIER_DESCRIPTION_MAX) }) : t("members.tiers.bothOrNeither")}
            slotProps={{ htmlInput: { maxLength: TIER_DESCRIPTION_MAX, lang: language } }}
          />
          {language === "en" && <TranslateFieldButton en={box("descriptionEn")} />}
        </Stack>
      );
    };
    return (
      <Box
        component="li"
        key={key}
        id={tier ? `tier-${tier.tier.id}` : "tier-new"}
        data-testid={tier ? "member-tier" : "member-tier-new"}
        data-tier-id={tier?.tier.id}
        // The name the translate buttons say a box belongs to (`labelOfBox`): the same «Nume (EN)» is in every row.
        data-translate-row={title}
        sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}
      >
        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1, mb: 1.5 }}>
          <Typography component="p" variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
            {title}
          </Typography>
          {tier === null && <QuietHelp text={t("members.tiers.newRowHint")} />}
          {tier && <StatusChip glyph="club" variant="outlined" label={t(`members.tiers.members.${countForm(tier.members, locale)}`, { count: tier.members })} testId="member-tier-members" />}
          {tier?.tier.hidden && <StatusChip glyph="hidden" label={t("members.tiers.hiddenChip")} testId="member-tier-hidden" />}
          {tier && tier.codesForIt > 0 && (
            <StatusChip glyph="link" variant="outlined" label={t(`members.tiers.codes.${countForm(tier.codesForIt, locale)}`, { count: tier.codesForIt })} testId="member-tier-codes" />
          )}
        </Stack>
        {/* What the form was drawn with: the place the level was at, which «Poziția» is compared with — a typed number that differs is a move. */}
        {tier && <input type="hidden" name={box("was")} value={index + 1} />}
        <Stack spacing={1.5} role="group" aria-label={title}>
          {/* «Poziția»: the level's place in the club's list, from 1; the blank row's is the last. */}
          <RecallField
            name={box("position")}
            type="number"
            label={t("members.tiers.position")}
            defaultValue={tier ? String(index + 1) : ""}
            size="small"
            sx={{ maxWidth: { sm: 220 } }}
            slotProps={{ htmlInput: { inputMode: "numeric", step: "any" }, inputLabel: { shrink: true } }}
            placeholder={tier ? undefined : t("members.tiers.positionLast")}
          />
          {/* One strip for the level's words (§572): the name and the administrators' note in Română, then in English — both languages or neither (§352). */}
          <LocaleTabPanels
            idPrefix={`tier-${key}`}
            watch={{ names: [`tiers[${key}].name{Locale}`], rule: tier ? "required" : "parity" }}
            markLabel={t("editor.tabIncomplete")}
            panels={(["ro", "en"] as const).map((language) => ({
              locale: language,
              label: t(`members.tiers.language.${language}`),
              incompleteLabel: undefined,
              content: languagePanel(language),
            }))}
          />
          <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <CheckboxField name={box("hidden")} defaultChecked={tier?.tier.hidden ?? false}>
              {t("members.tiers.hidden")}
            </CheckboxField>
            <QuietHelp text={t("members.tiers.hiddenHelp")} />
            {tier && mayManage && (
              <GlyphButton
                type="submit"
                form={deleteFormId(tier.tier.id)}
                icon="delete"
                color="error"
                variant="outlined"
                size="small"
                sx={{ minHeight: 44, ml: "auto" }}
                aria-label={`${t("members.tiers.delete")}: ${shownName}`}
                data-testid="member-tier-delete"
              >
                {t("members.tiers.delete")}
              </GlyphButton>
            )}
          </Stack>
        </Stack>
      </Box>
    );
  };

  return (
    <Panel
      glyph="memberTiers"
      collapsible
      openWhen={{ saved: saved === "memberTiersSaved" || saved === "memberTierDeleted" }}
      title={t("members.tiers.heading")}
      aside={count}
      intro={t("members.tiers.intro")}
      introMore={t("members.tiers.introMore")}
      id="members-tiers"
      data-testid="members-tiers"
    >
      {tiers.length === 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="member-tiers-empty" sx={{ mb: 1.5 }}>
          {t("members.tiers.empty")}
        </Typography>
      )}
      {mayManage ? (
        <>
          {/* ONE form around every level: its rows, the blank row and the one «Salvează toate nivelurile». «Șterge nivelul» is not in it: each level's delete is a small form beside it. */}
          <ActionForm action={saveMemberTiersAction} scope="tiers" messages={messages} data-testid="member-tiers-form">
            <input type="hidden" name="uiLocale" value={locale} />
            <Box data-translate-scope={t("members.tiers.heading")}>
              <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1, mb: 1.5 }}>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                  {t("members.tiers.rowsIntro")}
                </Typography>
                <TranslateCardButton />
              </Stack>
              <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("members.tiers.listLabel")}>
                {tiers.map((tier, index) => rowOf(tier, index))}
                {rowOf(null, tiers.length)}
              </Stack>
              <Box sx={{ mt: 2 }}>
                <GlyphSubmitButton label={t("members.tiers.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
              </Box>
            </Box>
          </ActionForm>
          {tiers.map((tier) => (
            <ActionForm
              key={tier.tier.id}
              id={deleteFormId(tier.tier.id)}
              action={deleteMemberTierAction}
              hidden
              confirm={{
                title: t("members.tiers.deleteTitle", { name: locale === "en" ? tier.tier.nameEn : tier.tier.nameRo }),
                body: t("members.tiers.deleteBody"),
                confirmLabel: t("members.tiers.delete"),
                cancelLabel: cancel,
                destructive: true,
              }}
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="tierId" value={tier.tier.id} />
            </ActionForm>
          ))}
        </>
      ) : (
        // Read only: the levels and how many members hold each, for a role that does not manage them.
        <Stack component="ol" spacing={1} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("members.tiers.listLabel")}>
          {tiers.map((tier) => (
            <Typography component="li" key={tier.tier.id} variant="body2" data-testid="member-tier-readonly">
              {locale === "en" ? tier.tier.nameEn : tier.tier.nameRo}
              {" · "}
              {t(`members.tiers.members.${countForm(tier.members, locale)}`, { count: tier.members })}
            </Typography>
          ))}
          <Typography variant="body2" color="text.secondary">
            {t("members.tiers.adminOnly")}
          </Typography>
        </Stack>
      )}
    </Panel>
  );
}
