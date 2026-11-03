import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { ELITE_NAME_MAX } from "@/db/schema/event-elite-entries";
import { countForm } from "@/i18n/count-form";
import { BIB_IMAGE } from "@/modules/registrations/bib-geometry";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import DetachedActionForm, { DetachedFields, DetachedForm } from "@/shared/forms/DetachedActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import TipSpan from "@/shared/ui/TipSpan";

/** The two small forms the card's controls belong to, by id (`form="…"`). */
export const BIB_ASSIGN_FORM = "bib-assign";
export const BIB_DOWNLOAD_FORM = "bib-download";
/** The print of the desk's spares (§444): a POST that reserves them, then the sheet. */
export const BIB_SPARES_FORM = "bib-spares";
/** «Adaugă pe lista de elită» (§895): a detached form beside the save form (`EliteBibForms`). */
export const BIB_ELITE_ADD_FORM = "bib-elite-add";
/** Each elite line's «Șterge» (§895): one small form per line beside the save form, asked first (`BibPrintForms`). */
export function bibEliteDeleteForm(entryId: string): string {
  return `bib-elite-delete-${entryId}`;
}

type Props = {
  eventId: string;
  /** How many numbers exist, and how many are not printed yet. */
  total: number;
  unprinted: number;
  /** "Alocă numerele" is a write: `assignBibNumbers` refuses anybody below Administrator (§289). */
  mayAssign: boolean;
  /** A queue made only of test rows gets no numbers and never will (`AGENTS.md` §12.6). */
  onlyTest: boolean;
  /** Open by itself: numbers waiting for the printer in race week (§311). */
  attention: boolean;
  /**
   * The desk's spares (§444): what is reserved already and how much of it is free, and the first
   * number the next print would reserve — the number the confirmation names.
   */
  spares?: SpareCard | null;
  /** «Elită — doar numele pe BIB» (§895): the race's elite list, its sheet and its sample; absent where no bib prints. */
  elite?: EliteCard | null;
  /** Back from the elite card's add or delete (`?saved=eliteAdded|eliteDeleted`): this card and the elite fold open by themselves. */
  eliteSaved?: boolean;
};

/** What the elite section shows (§895), read by the page (`elite-list.ts#listEliteEntries`). */
export type EliteCard = {
  /** The names in the order typed, with the number the club gave each, if any. */
  entries: ReadonlyArray<{ id: string; name: string; bibNumber: number | null }>;
  /** The sample elite bib: the preview route with `elite=1` and the stored design (`bib-design-query.ts#bibPreviewUrl`). */
  previewSrc: string;
  /** The sheet of every elite bib: the bibs route with `elite=1`. */
  downloadHref: string;
};

/** What the spares' section shows (§444), read by the page from `bibs.ts#spareCardState`. */
export type SpareCard = {
  /** The reservation so far, both ends included, and how many of it nobody holds; null before the first print. */
  band: { from: number; to: number } | null;
  free: number;
  /** Where the next print starts; null when no number is left under the ceiling. */
  nextFrom: number | null;
  /** At most this many per print. */
  perPrint: number;
};

/**
 * «Numere de rezervă pentru înscrierile de la fața locului» (§444, amending §338): the club types
 * how many and presses «Tipărește». The press is a POST (`BIB_SPARES_FORM`, asked first, §384)
 * that reserves the numbers under the event's lock and comes back with the sheet's link for exactly
 * that range; the reprint of the free ones already reserved is the sheet's own GET. The Organizer
 * reads the section and downloads the sheet; only an Administrator reserves (§289).
 *
 * Not every race prints spares, so it is a part a person may skip: a level-5 fold of the print card
 * (the editor's rule, `EventEditorLayout`; a caption over a divider until then), closed, the band and
 * how many are free on its closed line.
 */
async function SpareBibsSection({ spares, mayReserve }: { spares: SpareCard; mayReserve: boolean }) {
  const t = await getTranslations("Admin");
  const { band } = spares;
  return (
    <Panel
      glyph="bibs"
      collapsible
      level={5}
      title={t("bibs.sparesTitle")}
      aside={band ? t("bibs.sparesLine", { from: band.from, to: band.to, free: spares.free }) : t("bibs.sparesLineNone")}
      data-testid="bib-spares"
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {t("bibs.sparesHelp", { max: spares.perPrint })}
        </Typography>
        {band && (
          <Typography variant="body2" data-testid="bib-spares-state">
            {spares.free > 0
              ? t("bibs.sparesFree", { from: band.from, to: band.to, free: spares.free, total: band.to - band.from + 1 })
              : t("bibs.sparesNone", { from: band.from, to: band.to })}
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          {mayReserve && spares.nextFrom !== null ? (
            <>
              <TextField
                name="count"
                type="number"
                label={t("bibs.sparesCount")}
                size="small"
                defaultValue={Math.min(10, spares.perPrint)}
                required
                slotProps={{ htmlInput: { min: 1, max: spares.perPrint, step: 1, inputMode: "numeric", form: BIB_SPARES_FORM } }}
                sx={{ width: 110 }}
              />
              <GlyphButton icon="print" type="submit" form={BIB_SPARES_FORM} variant="outlined" size="small" sx={{ minHeight: 44 }}>
                {t("bibs.sparesPrint")}
              </GlyphButton>
              <Typography variant="body2" color="text.secondary">
                {t("bibs.sparesNext", { from: spares.nextFrom })}
              </Typography>
            </>
          ) : (
            !mayReserve && (
              <Typography variant="body2" color="text.secondary">
                {t("bibs.sparesReadOnly")}
              </Typography>
            )
          )}
          {band && spares.free > 0 && (
            <GlyphButton icon="pdf" type="submit" form={BIB_DOWNLOAD_FORM} name="spares" value="1" variant="text" size="small" sx={{ minHeight: 44 }}>
              {t("bibs.downloadSpares")}
            </GlyphButton>
          )}
        </Stack>
      </Stack>
    </Panel>
  );
}

/**
 * «Elită — doar numele pe BIB» (§895; the owner, 2026-11-03, «Listă separată»): the race's elite runners as a list
 * of names, each printed with the **name where the number goes** — not registrations: no place, no email, no
 * declaration, no count. Beside the spares, a level-5 fold of the print card, closed, how many on its closed line.
 *
 * The list (each name, its number when it has one), the sheet «Descarcă BIB-urile de elită (N)» and a sample
 * of one elite bib drawn with the saved design (the preview route's `elite=1`) are every reader's of the bibs
 * (the Organizer and above); «Adaugă» and «Șterge» are the Administrator's (`mayEdit`, asserted again by the
 * actions and the service). The card sits inside the event's save form, so its boxes and buttons name forms that
 * stand beside it (`EliteBibForms`, `BibPrintForms`): «Salvează» never posts a name, and a refused add keeps what
 * was typed, said right above the boxes.
 */
async function EliteBibsSection({ elite, mayEdit, saved }: { elite: EliteCard; mayEdit: boolean; saved: boolean }) {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const count = elite.entries.length;
  const aside = count === 0 ? t("bibs.eliteNone") : t(`bibs.eliteCount.${countForm(count, locale)}`, { count });
  return (
    <Panel glyph="bibElite" collapsible level={5} id="bib-elite" title={t("bibs.eliteTitle")} aside={aside} openWhen={{ saved }} data-testid="bib-elite">
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t("bibs.eliteHelp")}
        </Typography>
        {count === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="bib-elite-empty">
            {t("bibs.eliteEmpty")}
          </Typography>
        ) : (
          <Stack component="ol" spacing={0.5} sx={{ m: 0, pl: 3 }} data-testid="bib-elite-list">
            {elite.entries.map((entry) => (
              <Box key={entry.id} component="li" data-testid="bib-elite-entry">
                <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1 }}>
                  <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{entry.name}</Typography>
                  {entry.bibNumber !== null && (
                    <Typography variant="body2" color="text.secondary">
                      {t("bibs.eliteNumberShown", { number: entry.bibNumber })}
                    </Typography>
                  )}
                  {mayEdit && (
                    // The question is the line's own form (`BibPrintForms`, §384); this button only submits it.
                    <GlyphButton icon="delete" type="submit" form={bibEliteDeleteForm(entry.id)} variant="text" color="error" size="small" sx={{ minHeight: 44 }}>
                      {t("bibs.eliteDelete")}
                    </GlyphButton>
                  )}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
        {mayEdit ? (
          <DetachedFields form={BIB_ELITE_ADD_FORM}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { xs: "stretch", sm: "flex-start" } }} data-testid="bib-elite-add">
              <RecallField
                name="eliteName"
                label={t("bibs.eliteName")}
                helperText={t("bibs.eliteNameHelp", { max: ELITE_NAME_MAX })}
                required
                fullWidth
                size="small"
                slotProps={{ htmlInput: { maxLength: ELITE_NAME_MAX, autoComplete: "off" } }}
              />
              <RecallField
                name="eliteNumber"
                label={t("bibs.eliteNumber")}
                helperText={t("bibs.eliteNumberHelp")}
                size="small"
                slotProps={{ htmlInput: { inputMode: "numeric", pattern: "[0-9]*", maxLength: 5, autoComplete: "off" } }}
                sx={{ width: { sm: 200 }, flexShrink: 0 }}
              />
              <Box sx={{ flexShrink: 0 }}>
                <GlyphSubmitButton label={t("bibs.eliteAdd")} pendingLabel={t("bibs.eliteAdding")} icon="add" />
              </Box>
            </Stack>
          </DetachedFields>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("bibs.eliteReadOnly")}
          </Typography>
        )}
        {count > 0 && (
          <Box>
            <GlyphButton icon="pdf" href={elite.downloadHref} variant="outlined" size="small" sx={{ minHeight: 44 }} data-testid="bib-elite-download">
              {t("bibs.eliteDownload", { count })}
            </GlyphButton>
          </Box>
        )}
        {/* One elite bib as it prints, with the saved design and a sample name — never a name of the list. */}
        <Box component="figure" sx={{ m: 0, maxWidth: 320 }} data-testid="bib-elite-sample">
          <Box
            component="img"
            src={elite.previewSrc}
            alt={t("bibs.eliteSampleAlt")}
            width={BIB_IMAGE.width}
            height={BIB_IMAGE.height}
            loading="lazy"
            sx={{ width: "100%", height: "auto", display: "block", border: 1, borderColor: "divider" }}
          />
          <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            {t("bibs.eliteSampleCaption")}
          </Typography>
        </Box>
      </Stack>
    </Panel>
  );
}

/**
 * The detached form behind «Adaugă pe lista de elită» (§895): its state wraps the event's save form, its `<form>`
 * stands right after it (`DetachedActionForm`, as «Puncte pe traseu» does, §763) — HTML forms cannot nest — so the
 * add posts its two boxes and none of the event's, and a refusal keeps them. Only for the Administrator on an
 * event that prints bibs; otherwise the save form alone.
 */
export async function EliteBibForms({
  locale,
  eventId,
  mayEdit,
  eliteAddAction,
  children,
}: {
  locale: string;
  eventId: string;
  mayEdit: boolean;
  /** `addEliteEntryAction`, handed down by the page that owns the actions. */
  eliteAddAction: ActionFormAction;
  children: ReactNode;
}) {
  if (!mayEdit) return children;
  const t = await getTranslations("Admin");
  const messages = await refusalMessages({ eliteName: t("bibs.eliteName"), eliteNumber: t("bibs.eliteNumber") });
  return (
    <DetachedActionForm id={BIB_ELITE_ADD_FORM} action={eliteAddAction} scope="bib-elite" messages={messages}>
      {children}
      <DetachedForm id={BIB_ELITE_ADD_FORM}>
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="eventId" value={eventId} />
      </DetachedForm>
    </DetachedActionForm>
  );
}

/**
 * Sub-sub-card 8.4.2, "Alocare și tipărire" (§350), edit only: the race numbers given out and the
 * sheet to print — the one card for race numbers now holds what they look like and whether they
 * exist, where it used to be a section below the page.
 *
 * **Immediate actions inside the save form.** The card sits in «Participare, înscrieri și regulament» (§760), inside
 * the one `<form>` that saves the event, and HTML forms cannot nest. So every control here names
 * the form it belongs to — `form="bib-assign"` for the POST that gives the numbers, `form=
 * "bib-download"` for the GET that prints them — and those two forms are rendered after the save
 * form, as its siblings (`BibPrintForms`). "Salvează" never posts them, and they never post the
 * event. The line at the top says so.
 */
export async function BibPrintCard({ eventId, total, unprinted, mayAssign, onlyTest, attention, spares = null, elite = null, eliteSaved = false }: Props) {
  const t = await getTranslations("Admin");
  // What «Alocă numerele» does, then when it is needed — two lines, one tooltip (`TOOLTIP_TEXT_SX` keeps the break).
  const assignWords = `${t("bibs.assignHelp")}\n${t("bibs.assignHelpMore")}`;
  return (
    <Panel glyph="print"
      collapsible
      level={4}
      id="box-bib-print"
      title={t("editor.boxes.bibPrint.title")}
      aside={total > 0 ? t("bibs.helpSome", { total }) : undefined}
      openWhen={{ attention, saved: eliteSaved }}
      data-testid="bib-print"
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t("editor.immediateActions")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {total === 0 ? (onlyTest ? t("editor.bibsOnlyTest") : t("bibs.helpNone")) : t("bibs.helpSome", { total })}
          {unprinted > 0 && total > 0 ? ` ${t("editor.boxes.bibPrint.unprinted", { count: unprinted })}` : ""}
          <QuietHelp text={t("bibs.helpMore")} />
        </Typography>
        {/*
          «Alocă numerele» on a row of its own (§759; the owner, 2026-10-13: «nu înțeleg ce face butonul de
          „Alocă numerele"… îmi trebuie ceva tooltip pt el»): what it does in plain words on hover (the
          house's `TipSpan`) and behind the «?» beside it for a thumb (`QuietHelp`).
        */}
        {mayAssign && (
          // A 12-pixel gap: `QuietHelp`'s invisible 44-pixel target reaches 14 pixels out from its glyph, so without it the «?» covered the button's edge.
          <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }} data-testid="bib-assign-row">
            <TipSpan title={assignWords}>
              {/* The question is the assign form's own (`BibPrintForms`, §384); this button only submits it. */}
              <GlyphButton icon="number" type="submit" form={BIB_ASSIGN_FORM} variant="outlined" size="small" sx={{ minHeight: 44 }}>
                {t("bibs.assign")}
              </GlyphButton>
            </TipSpan>
            <QuietHelp text={assignWords} testId="bib-assign-help" />
          </Stack>
        )}
        {/*
          «Tipărește numerele (PDF)» (§759): «De la» and «Până la» belong to the PDF, not to
          the allocation — under a heading that names the print, never «doar» over a button that says «toate»,
          the range in its help, beside the download buttons. The print is what the card is for, so it is
          an open part — a level-5 `Panel variant="section"`, its heading and its boxes, no fold and no
          border (the editor's rule, `EventEditorLayout`; a caption over a divider until then). The
          form wiring is the sheet's own GET (`BIB_DOWNLOAD_FORM`), unchanged.
        */}
        {total > 0 && (
          <Panel variant="section" glyph="print" level={5} title={t("bibs.rangeTitle")} intro={t("bibs.rangeHelp")} data-testid="bib-print-range">
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
              <TextField
                name="from"
                type="number"
                label={t("bibs.from")}
                size="small"
                slotProps={{ htmlInput: { min: 1, form: BIB_DOWNLOAD_FORM } }}
                sx={{ width: 100 }}
              />
              <TextField
                name="to"
                type="number"
                label={t("bibs.to")}
                size="small"
                slotProps={{ htmlInput: { min: 1, form: BIB_DOWNLOAD_FORM } }}
                sx={{ width: 100 }}
              />
              {/* Two submit buttons, one form: the second names the layout it asks for. */}
              <GlyphButton icon="pdf" type="submit" form={BIB_DOWNLOAD_FORM} variant="outlined" size="small" sx={{ minHeight: 44 }}>
                {t("bibs.download")}
              </GlyphButton>
              <GlyphButton icon="print" type="submit" form={BIB_DOWNLOAD_FORM} name="layout" value="one" variant="text" size="small" sx={{ minHeight: 44 }}>
                {t("bibs.downloadOnePerPage")}
              </GlyphButton>
            </Stack>
          </Panel>
        )}
        {spares && <SpareBibsSection spares={spares} mayReserve={mayAssign} />}
        {/* «Elită» (§895) beside the spares: names printed as bibs, never registrations. */}
        {elite && <EliteBibsSection elite={elite} mayEdit={mayAssign} saved={eliteSaved} />}
        {/* Every bib as it will print, on its own page (§94): drawn on request. */}
        {total > 0 && (
          <Box>
            <GlyphButtonLink
              icon="picture"
              href={{ pathname: "/admin/events/[id]/bibs", params: { id: eventId } }}
              variant="text"
              size="small"
              sx={{ minHeight: 44 }}
            >
              {t("bibs.preview", { count: total })}
            </GlyphButtonLink>
          </Box>
        )}
      </Stack>
    </Panel>
  );
}

/**
 * The two forms `BibPrintCard`'s controls post, rendered after the save form (never inside it):
 * the POST that gives the numbers, with its confirmation on the button, and the GET that reads the
 * sheet and writes nothing.
 */
export async function BibPrintForms({
  eventId,
  locale,
  mayAssign,
  assignAction,
  sparesAction,
  sparesFrom = null,
  eliteDeleteAction,
  eliteEntries = [],
  cancelLabel,
}: {
  eventId: string;
  locale: string;
  mayAssign: boolean;
  /** `assignBibNumbersAction`, handed down by the page that owns the actions. */
  assignAction: ActionFormAction;
  /** `reserveSpareBibsAction` (§444), with the first number the question names; absent, no form. */
  sparesAction?: ActionFormAction;
  sparesFrom?: number | null;
  /** `deleteEliteEntryAction` (§895), and the lines it may delete — one small form each; absent, none. */
  eliteDeleteAction?: ActionFormAction;
  eliteEntries?: ReadonlyArray<{ id: string; name: string }>;
  cancelLabel: string;
}) {
  const t = await getTranslations("Admin");
  return (
    <>
      {mayAssign && (
        // The form asks (§384): the card's button submits it, and the question opens from here.
        <ActionForm
          id={BIB_ASSIGN_FORM}
          action={assignAction}
          hidden
          confirm={{ title: t("confirm.bibsTitle"), body: t("confirm.bibsBody"), confirmLabel: t("bibs.assign"), cancelLabel }}
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="eventId" value={eventId} />
        </ActionForm>
      )}
      {mayAssign && sparesAction && sparesFrom !== null && (
        // Reserving changes what online runners can get, so it asks first (§384), naming the start.
        <ActionForm
          id={BIB_SPARES_FORM}
          action={sparesAction}
          hidden
          confirm={{
            title: t("confirm.sparesTitle"),
            body: t("confirm.sparesBody", { from: sparesFrom }),
            confirmLabel: t("bibs.sparesPrint"),
            cancelLabel,
          }}
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="eventId" value={eventId} />
          {/* The start the question named: the service refuses when a registration moved it since. */}
          <input type="hidden" name="expectFrom" value={sparesFrom} />
        </ActionForm>
      )}
      {mayAssign &&
        eliteDeleteAction &&
        eliteEntries.map((entry) => (
          // Deleting a name asks first (§384), naming it; the card's «Șterge» on its line only submits this form.
          <ActionForm
            key={entry.id}
            id={bibEliteDeleteForm(entry.id)}
            action={eliteDeleteAction}
            hidden
            confirm={{
              title: t("bibs.eliteDeleteTitle"),
              body: t("bibs.eliteDeleteBody", { name: entry.name }),
              confirmLabel: t("bibs.eliteDelete"),
              cancelLabel,
              destructive: true,
            }}
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="entryId" value={entry.id} />
          </ActionForm>
        ))}
      <form id={BIB_DOWNLOAD_FORM} action={`/api/admin/events/${eventId}/bibs`} method="get" hidden>
        <input type="hidden" name="locale" value={locale} />
      </form>
    </>
  );
}
