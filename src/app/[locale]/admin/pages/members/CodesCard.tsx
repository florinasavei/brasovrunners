import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import { formatCalendarDay } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import { CODE_DESCRIPTION_MAX, CODE_LINK_MAX, CODE_MAX, CODE_PARTNER_MAX, codeShownToMembers } from "@/modules/content/member-codes/fields";
import type { AdminDiscountCode } from "@/modules/content/member-codes/repository";
import TierChips from "@/modules/content/member-tiers/ui/TierChips";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import DateField from "@/shared/forms/pickers/DateField";
import RecallField, { RecallHidden } from "@/shared/forms/recall";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import StatusChip from "@/shared/ui/StatusChip";
import { FACTS_SX, LINE_SX, PENCIL_SX, ROW_SX, SUMMARY_SX } from "@/shared/ui/row-fold";
import {
  createDiscountCodeAction,
  deleteDiscountCodeAction,
  moveDiscountCodeAction,
  saveDiscountCodeAction,
  setDiscountCodeHiddenAction,
} from "./actions";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** A member tier as the codes' card names it (§811): its id and its name in the reader's language; a hidden one is still named, it may hold a code's limit. */
export type CodeTier = { id: string; name: string; hidden: boolean };

/** The glyph drawn here as a component, by name from the verbs' registry (§318): a Server Component may render one, never pass one. */
const PencilIcon = ACTION_ICONS.edit;

/** A line nobody here may change: the words and the facts, no pencil — nothing on it is a control. */
const READ_LINE_SX = { ...LINE_SX, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) auto" }, gridTemplateAreas: { xs: '"words" "facts"', sm: '"words facts"' } } as const;

/**
 * «Coduri de reducere» (§552): the members' discount codes, one card on «Pagini» → «Membri», closed
 * until opened (§336), the count on its line. Each code is a row fold (§842, `row-fold.ts`): the line
 * says it in words — the partner, the code, its state, its last day, who it is for, a description in
 * one language only — and the pencil; a press opens the code's boxes in place, then its verbs, delete
 * last. «Adaugă un cod» is the blank boxes in a fold of their own at the end, open by itself only
 * while there is no code. Every control is offered only to the role its action asserts, and the
 * service asserts it again (BR-REQ-060-01): adding, the code, hiding, moving and deleting are the
 * Administrator's (`mayManage`); the partner's name and the words are the Redactor's too
 * (`mayEditWords`). Every write that changes what members see asks first (§384) and toasts.
 *
 * Every form sits wholly inside its fold, its submit with it: a required box in a closed fold can
 * never be what a press runs into.
 */
export default function CodesCard({
  codes,
  today,
  locale,
  words: t,
  cancel,
  messages,
  mayManage,
  mayEditWords,
  tiers,
}: {
  codes: readonly AdminDiscountCode[];
  /** The member tiers, in the club's order (§811): the chips «Pentru cine e codul» of each code, and the names of the limit on its line. */
  tiers: readonly CodeTier[];
  /** The club's calendar day, `YYYY-MM-DD`: a code past its last day is marked as not shown. */
  today: string;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  mayManage: boolean;
  mayEditWords: boolean;
}) {
  const count = t(`members.codes.count.${countForm(codes.length, locale)}`, { count: codes.length });
  return (
    <Panel glyph="memberCodes" collapsible id="members-codes" title={t("members.codes.heading")} aside={count} intro={t("members.codes.help")} data-testid="members-codes">
      <Stack spacing={1.5}>
        {!mayManage && mayEditWords && (
          <Typography variant="body2" color="text.secondary">
            {t("members.codes.wordsOnly")}
          </Typography>
        )}

        {codes.length === 0 ? (
          <Typography variant="body2" data-testid="codes-empty">
            {t("members.codes.empty")}
          </Typography>
        ) : (
          <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("members.codes.listLabel")}>
            {codes.map((code, index) => (
              <CodeRow
                key={code.id}
                code={code}
                first={index === 0}
                last={index === codes.length - 1}
                today={today}
                locale={locale}
                words={t}
                cancel={cancel}
                messages={messages}
                mayManage={mayManage}
                mayEditWords={mayEditWords}
                tiers={tiers}
              />
            ))}
          </Box>
        )}

        {/* «Adaugă un cod»: the blank boxes in a fold of their own, like every «Adaugă…» of the backoffice (§842) — open by itself only while there is no code. */}
        {mayManage && (
          <Panel glyph="add" collapsible level={3} title={t("members.codes.add")} openWhen={{ primary: codes.length === 0 }} data-testid="code-add-fold">
            <ActionForm
              action={createDiscountCodeAction}
              messages={messages}
              scope="code-new"
              data-testid="code-create-form"
              confirm={{ title: t("members.codes.createTitle"), body: t("members.codes.createBody"), confirmLabel: t("members.codes.create"), cancelLabel: cancel }}
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <CodeFields code={null} words={t} mayManage tiers={tiers} />
              <Box sx={{ mt: 2, pb: 1.5 }}>
                <GlyphSubmitButton label={t("members.codes.create")} pendingLabel={t("editor.saving")} icon="add" size="medium" />
              </Box>
            </ActionForm>
          </Panel>
        )}
      </Stack>
    </Panel>
  );
}

function CodeRow({
  code,
  first,
  last,
  today,
  locale,
  words: t,
  cancel,
  messages,
  mayManage,
  mayEditWords,
  tiers,
}: {
  code: AdminDiscountCode;
  first: boolean;
  last: boolean;
  today: string;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  mayManage: boolean;
  mayEditWords: boolean;
  tiers: readonly CodeTier[];
}) {
  const shown = codeShownToMembers(code, today);
  // The levels the code is for, named (§811); an id whose level is gone is not named (deleting a level takes it off the codes).
  // A code with no stored limit is «Toți membrii» (§811, amended by §828): its line says so, always.
  // One decision on the stored value, for the line and for the form's tick alike: an empty list is «Toți membrii»; a list that names no level never is.
  const forEveryone = (code.tierIds?.length ?? 0) === 0;
  const limited = (code.tierIds ?? []).flatMap((id) => tiers.find((tier) => tier.id === id)?.name ?? []);
  const gone = (code.tierIds?.length ?? 0) - limited.length;
  const audience = forEveryone ? t("members.codes.forEveryone") : t("members.codes.forTiersChip", { tiers: [...limited, ...(gone > 0 ? [t("members.codes.tiersGone", { count: gone })] : [])].join(", ") });
  const expired = !code.hidden && !shown;
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="codeId" value={code.id} />
    </>
  );

  /** The line's words: the partner, then the code as the member types it. */
  const wordsBlock = (
    <Box sx={{ gridArea: "words", minWidth: 0 }}>
      <Typography component="span" sx={{ fontWeight: 600, overflowWrap: "anywhere" }} data-testid="code-partner">
        {code.partnerName}
      </Typography>
      <Typography component="span" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
        {" · "}
        <Box component="span" sx={{ fontFamily: "monospace" }} data-testid="code-code">
          {code.code}
        </Box>
      </Typography>
    </Box>
  );

  /** The line's facts: whether members see it, its last day, who it is for (§811, amended by §828: always), a description in one language. */
  const facts = (
    <Box sx={FACTS_SX}>
      <StatusChip
        glyph={shown ? "visible" : "hidden"}
        color={shown ? "success" : "default"}
        label={shown ? t("members.codes.shown") : expired ? t("members.codes.expired") : t("members.codes.hidden")}
        testId="code-state-chip"
      />
      {code.validUntil && (
        <StatusChip glyph="planned" variant="outlined" label={t("members.codes.until", { day: formatCalendarDay(code.validUntil, { locale, position: "inline" }) })} testId="code-until-chip" />
      )}
      <StatusChip glyph="club" variant="outlined" label={audience} testId="code-tiers-chip" />
      {(code.descriptionRo === null) !== (code.descriptionEn === null) && (
        <StatusChip glyph="language" variant="outlined" color="warning" label={t("members.codes.oneLanguage")} testId="code-one-language-chip" />
      )}
    </Box>
  );

  // A role that may change nothing on a code reads its line, with no pencil and no fold that opens onto nothing.
  if (!mayEditWords && !mayManage) {
    return (
      <Box component="li" id={`code-${code.id}`} data-testid="code-row" data-code-id={code.id} sx={{ ...ROW_SX, scrollMarginTop: 16 }}>
        <Box sx={READ_LINE_SX}>
          {wordsBlock}
          {facts}
        </Box>
      </Box>
    );
  }

  return (
    <Box component="li" id={`code-${code.id}`} data-testid="code-row" data-code-id={code.id} sx={{ ...ROW_SX, scrollMarginTop: 16 }}>
      {/* The line is the summary of the code's boxes: a press anywhere on it, or on the pencil, opens them in place. Keyed on the
          code's version, so a save draws the fold closed. */}
      <Box component="details" key={code.version} data-testid="code-row-edit">
        <Box component="summary" title={t("members.codes.edit")} data-testid="code-row-toggle" sx={SUMMARY_SX}>
          {wordsBlock}
          {facts}
          <PencilIcon aria-hidden fontSize="small" sx={PENCIL_SX} />
        </Box>
        <Stack spacing={1.5} sx={{ pb: 1.5, pt: 0.5 }}>
          {mayEditWords && (
            <ActionForm
              action={saveDiscountCodeAction}
              messages={messages}
              scope={`c${code.id.slice(0, 8)}`}
              data-testid={`code-save-${code.id}`}
              confirm={{ title: t("members.codes.saveTitle", { partner: code.partnerName }), body: t("members.codes.saveBody"), confirmLabel: t("editor.save"), cancelLabel: cancel }}
            >
              {hidden}
              <RecallHidden name="expectedVersion" value={code.version} />
              <CodeFields code={code} words={t} mayManage={mayManage} tiers={tiers} />
              <Box sx={{ mt: 2 }}>
                <GlyphSubmitButton label={t("editor.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
              </Box>
            </ActionForm>
          )}

          {mayManage && (
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
              {!first && (
                <Box component="form" action={moveDiscountCodeAction}>
                  {hidden}
                  <input type="hidden" name="direction" value="up" />
                  <GlyphSubmitButton icon="moveUp" label={t("members.codes.moveUpWord")} pendingLabel={t("members.codes.moveUpWord")} tooltip={t("members.codes.moveUpTip")} variant="outlined" ariaLabel={t("members.codes.moveUp", { partner: code.partnerName })} />
                </Box>
              )}
              {!last && (
                <Box component="form" action={moveDiscountCodeAction}>
                  {hidden}
                  <input type="hidden" name="direction" value="down" />
                  <GlyphSubmitButton icon="moveDown" label={t("members.codes.moveDownWord")} pendingLabel={t("members.codes.moveDownWord")} tooltip={t("members.codes.moveDownTip")} variant="outlined" ariaLabel={t("members.codes.moveDown", { partner: code.partnerName })} />
                </Box>
              )}
              <ActionForm
                action={setDiscountCodeHiddenAction}
                confirm={
                  code.hidden
                    ? { title: t("members.codes.showTitle", { partner: code.partnerName }), body: t("members.codes.showBody"), confirmLabel: t("members.codes.show"), cancelLabel: cancel }
                    : { title: t("members.codes.hideTitle", { partner: code.partnerName }), body: t("members.codes.hideBody"), confirmLabel: t("members.codes.hide"), cancelLabel: cancel, destructive: true }
                }
              >
                {hidden}
                <input type="hidden" name="expectedVersion" value={code.version} />
                <input type="hidden" name="hidden" value={code.hidden ? "false" : "true"} />
                <GlyphButton icon={code.hidden ? "publish" : "unpublish"} type="submit" variant="outlined" color={code.hidden ? "primary" : "warning"} sx={{ minHeight: 44 }}>
                  {code.hidden ? t("members.codes.show") : t("members.codes.hide")}
                </GlyphButton>
              </ActionForm>
            </Stack>
          )}

          {/* Delete last, apart from the verbs that keep the code. */}
          {mayManage && (
            <ActionForm
              action={deleteDiscountCodeAction}
              confirm={{ title: t("members.codes.deleteTitle", { partner: code.partnerName }), body: t("members.codes.deleteBody"), confirmLabel: t("members.codes.delete"), cancelLabel: cancel, destructive: true }}
            >
              {hidden}
              <GlyphButton icon="delete" type="submit" variant="outlined" color="error" sx={{ minHeight: 44 }} data-testid="code-delete">
                {t("members.codes.delete")}
              </GlyphButton>
            </ActionForm>
          )}
        </Stack>
      </Box>
    </Box>
  );
}

/**
 * The boxes of a code, for adding one and for writing one: the partner and the code, the description
 * Română and English side by side from `sm` — both or neither (§352) — the link, the last day and the
 * chips «Pentru cine e codul» (§811, amended by §828): «Toți membrii» or the levels, chosen — a new code starts with
 * nothing ticked, an older one with no limit shows «Toți membrii» ticked. A role that writes the words alone sees the code as
 * text, and the link, the day and the chips not at all: the service keeps them as stored whatever is posted.
 */
function CodeFields({ code, words: t, mayManage, tiers }: { code: AdminDiscountCode | null; words: Words; mayManage: boolean; tiers: readonly CodeTier[] }) {
  const pairSx = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 } as const;
  return (
    <Stack spacing={2}>
      <RecallField
        name="partnerName"
        label={t("members.codes.partner")}
        required
        fullWidth
        defaultValue={code?.partnerName ?? ""}
        helperText={t("members.codes.partnerHelp")}
        slotProps={{ htmlInput: { maxLength: CODE_PARTNER_MAX } }}
      />
      {mayManage ? (
        <RecallField
          name="code"
          label={t("members.codes.code")}
          required
          fullWidth
          defaultValue={code?.code ?? ""}
          helperText={t("members.codes.codeHelp")}
          slotProps={{ htmlInput: { maxLength: CODE_MAX, autoCapitalize: "characters", spellCheck: false } }}
        />
      ) : (
        <Typography variant="body2">
          {t("members.codes.code")}: <Box component="span" sx={{ fontFamily: "monospace" }}>{code?.code}</Box>
        </Typography>
      )}
      <Box sx={pairSx}>
        <RecallField
          name="descriptionRo"
          label={t("members.codes.descriptionRo")}
          fullWidth
          multiline
          minRows={2}
          defaultValue={code?.descriptionRo ?? ""}
          helperText={t("members.codes.descriptionHelp")}
          slotProps={{ htmlInput: { maxLength: CODE_DESCRIPTION_MAX, lang: "ro" } }}
        />
        <RecallField
          name="descriptionEn"
          label={t("members.codes.descriptionEn")}
          fullWidth
          multiline
          minRows={2}
          defaultValue={code?.descriptionEn ?? ""}
          helperText={t("members.codes.bothOrNeither")}
          slotProps={{ htmlInput: { maxLength: CODE_DESCRIPTION_MAX, lang: "en" } }}
        />
      </Box>
      {mayManage && (
        <>
          <RecallField
            name="link"
            label={t("members.codes.link")}
            type="url"
            fullWidth
            defaultValue={code?.link ?? ""}
            helperText={t("members.codes.linkHelp")}
            slotProps={{ htmlInput: { maxLength: CODE_LINK_MAX } }}
          />
          <DateField name="validUntil" label={t("members.codes.validUntil")} defaultValue={code?.validUntil ?? ""} helperText={t("members.codes.validUntilHelp")} />
          {/* «Pentru cine e codul» (§811, amended by §828): chips with the native tick, «Toți membrii» first, exclusive with the levels. Before the club named a level there is nothing to choose between: the code is for «Toți membrii» and the form posts it. */}
          {tiers.length > 0 ? (
            <TierChips
              name="tierIds"
              allName="forAll"
              legend={t("members.codes.forTiers")}
              hint={t("members.codes.forTiersHelp")}
              allLabel={t("members.codes.forAllMembers")}
              noneMessage={t("members.codes.forTiersNone")}
              bothMessage={t("members.codes.forTiersBoth")}
              tiers={tiers.map((tier) => ({ id: tier.id, label: tier.hidden ? t("members.tiers.hiddenOption", { name: tier.name }) : tier.name }))}
              checkedIds={code?.tierIds ?? []}
              allChecked={code !== null && (code.tierIds?.length ?? 0) === 0}
            />
          ) : (
            <input type="hidden" name="forAll" value="1" />
          )}
        </>
      )}
    </Stack>
  );
}
