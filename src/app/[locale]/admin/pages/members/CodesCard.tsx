import AddCircleIcon from "@mui/icons-material/AddCircle";
import EditIcon from "@mui/icons-material/Edit";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import { formatCalendarDay } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import { CODE_DESCRIPTION_MAX, CODE_LINK_MAX, CODE_MAX, CODE_PARTNER_MAX, codeShownToMembers } from "@/modules/content/member-codes/fields";
import type { AdminDiscountCode } from "@/modules/content/member-codes/repository";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import DateField from "@/shared/forms/pickers/DateField";
import RecallField, { RecallHidden } from "@/shared/forms/recall";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import SubmitButton from "@/shared/ui/SubmitButton";
import {
  createDiscountCodeAction,
  deleteDiscountCodeAction,
  moveDiscountCodeAction,
  saveDiscountCodeAction,
  setDiscountCodeHiddenAction,
} from "./actions";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/**
 * «Coduri de reducere» (§NNN): the members' discount codes, one fold on «Pagini» → «Membri», closed
 * until opened (§336), the count on its line. Each code is a row with its state and its verbs, and
 * its boxes in a fold of their own. Every control is offered only to the role its action asserts,
 * and the service asserts it again (BR-REQ-060-01): adding, the code, hiding, moving and deleting
 * are the Administrator's (`mayManage`); the partner's name and the words are the Redactor's too
 * (`mayEditWords`). Every write that changes what members see asks first (§384) and toasts.
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
}: {
  codes: readonly AdminDiscountCode[];
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
    <Box component="details" id="members-codes" sx={{ ...BOXED_DISCLOSURE_SX, scrollMarginTop: 16 }} data-testid="members-codes">
      <summary>
        <LocalOfferIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
        {t("members.codes.heading")} · {count}
      </summary>
      <Stack spacing={2} sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {t("members.codes.help")}
        </Typography>
        {!mayManage && mayEditWords && (
          <Typography variant="body2" color="text.secondary">
            {t("members.codes.wordsOnly")}
          </Typography>
        )}

        {mayManage && (
          <Box component="details" sx={BOXED_DISCLOSURE_SX}>
            <summary>
              <AddCircleIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
              {t("members.codes.add")}
            </summary>
            <ActionForm
              action={createDiscountCodeAction}
              messages={messages}
              scope="code-new"
              data-testid="code-create-form"
              confirm={{ title: t("members.codes.createTitle"), body: t("members.codes.createBody"), confirmLabel: t("members.codes.create"), cancelLabel: cancel }}
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <CodeFields code={null} words={t} mayManage />
              <Box sx={{ mt: 2 }}>
                <GlyphSubmitButton label={t("members.codes.create")} pendingLabel={t("editor.saving")} icon="add" size="medium" />
              </Box>
            </ActionForm>
          </Box>
        )}

        {codes.length === 0 ? (
          <Typography variant="body2" data-testid="codes-empty">
            {t("members.codes.empty")}
          </Typography>
        ) : (
          <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("members.codes.listLabel")}>
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
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
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
}) {
  const shown = codeShownToMembers(code, today);
  const expired = !code.hidden && !shown;
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="codeId" value={code.id} />
    </>
  );
  return (
    <Box component="li" id={`code-${code.id}`} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
        {code.partnerName}
      </Typography>
      <Typography component="p" sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>
        {code.code}
      </Typography>
      <Stack direction="row" sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
        <Chip
          size="small"
          color={shown ? "success" : "default"}
          label={shown ? t("members.codes.shown") : expired ? t("members.codes.expired") : t("members.codes.hidden")}
        />
        {code.validUntil && (
          <Chip size="small" variant="outlined" label={t("members.codes.until", { day: formatCalendarDay(code.validUntil, { locale }) })} />
        )}
        {(code.descriptionRo === null) !== (code.descriptionEn === null) && (
          <Chip size="small" variant="outlined" color="warning" label={t("members.codes.oneLanguage")} />
        )}
      </Stack>

      {mayManage && (
        <Stack direction="row" sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
          {!first && (
            <Box component="form" action={moveDiscountCodeAction}>
              {hidden}
              <input type="hidden" name="direction" value="up" />
              <SubmitButton label="↑" pendingLabel="↑" variant="outlined" ariaLabel={t("members.codes.moveUp", { partner: code.partnerName })} />
            </Box>
          )}
          {!last && (
            <Box component="form" action={moveDiscountCodeAction}>
              {hidden}
              <input type="hidden" name="direction" value="down" />
              <SubmitButton label="↓" pendingLabel="↓" variant="outlined" ariaLabel={t("members.codes.moveDown", { partner: code.partnerName })} />
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
          <ActionForm
            action={deleteDiscountCodeAction}
            confirm={{ title: t("members.codes.deleteTitle", { partner: code.partnerName }), body: t("members.codes.deleteBody"), confirmLabel: t("members.codes.delete"), cancelLabel: cancel, destructive: true }}
          >
            {hidden}
            <GlyphButton icon="delete" type="submit" variant="outlined" color="error" sx={{ minHeight: 44 }}>
              {t("members.codes.delete")}
            </GlyphButton>
          </ActionForm>
        </Stack>
      )}

      {mayEditWords && (
        <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, mt: 1.5 }}>
          <summary>
            <EditIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
            {t("members.codes.edit")}
          </summary>
          <ActionForm
            action={saveDiscountCodeAction}
            messages={messages}
            scope={`c${code.id.slice(0, 8)}`}
            data-testid={`code-save-${code.id}`}
            confirm={{ title: t("members.codes.saveTitle", { partner: code.partnerName }), body: t("members.codes.saveBody"), confirmLabel: t("editor.save"), cancelLabel: cancel }}
          >
            {hidden}
            <RecallHidden name="expectedVersion" value={code.version} />
            <CodeFields code={code} words={t} mayManage={mayManage} />
            <Box sx={{ mt: 2 }}>
              <GlyphSubmitButton label={t("editor.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
            </Box>
          </ActionForm>
        </Box>
      )}
    </Box>
  );
}

/**
 * The boxes of a code, for adding one and for writing one: the partner and the code, the description
 * Română and English side by side from `sm` — both or neither (§352) — the link and the last day. A
 * role that writes the words alone sees the code, the link and the day as text, not as boxes: the
 * service keeps them as stored whatever is posted.
 */
function CodeFields({ code, words: t, mayManage }: { code: AdminDiscountCode | null; words: Words; mayManage: boolean }) {
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
        </>
      )}
    </Stack>
  );
}
