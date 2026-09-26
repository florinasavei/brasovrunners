import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import Panel from "@/shared/ui/Panel";

/** The two small forms the card's controls belong to, by id (`form="…"`). */
export const BIB_ASSIGN_FORM = "bib-assign";
export const BIB_DOWNLOAD_FORM = "bib-download";
/** The print of the desk's spares (§444): a POST that reserves them, then the sheet. */
export const BIB_SPARES_FORM = "bib-spares";

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
 */
async function SpareBibsSection({ spares, mayReserve }: { spares: SpareCard; mayReserve: boolean }) {
  const t = await getTranslations("Admin");
  const { band } = spares;
  return (
    <Stack spacing={1} data-testid="bib-spares" sx={{ pt: 1, borderTop: 1, borderColor: "divider" }}>
      <Typography variant="subtitle2" component="h5">
        {t("bibs.sparesTitle")}
      </Typography>
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
  );
}

/**
 * Sub-sub-card 8.4.2, "Alocare și tipărire" (§350), edit only: the race numbers given out and the
 * sheet to print — the one card for race numbers now holds what they look like and whether they
 * exist, where it used to be a section below the page.
 *
 * **Immediate actions inside the save form.** The card sits in "Participare și înscrieri", inside
 * the one `<form>` that saves the event, and HTML forms cannot nest. So every control here names
 * the form it belongs to — `form="bib-assign"` for the POST that gives the numbers, `form=
 * "bib-download"` for the GET that prints them — and those two forms are rendered after the save
 * form, as its siblings (`BibPrintForms`). "Salvează" never posts them, and they never post the
 * event. The line at the top says so.
 */
export async function BibPrintCard({ eventId, total, unprinted, mayAssign, onlyTest, attention, spares = null }: Props) {
  const t = await getTranslations("Admin");
  return (
    <Panel
      collapsible
      level={4}
      id="box-bib-print"
      title={t("editor.boxes.bibPrint.title")}
      aside={total > 0 ? t("bibs.helpSome", { total }) : undefined}
      openWhen={{ attention }}
      data-testid="bib-print"
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t("editor.immediateActions")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {total === 0 ? (onlyTest ? t("editor.bibsOnlyTest") : t("bibs.helpNone")) : t("bibs.helpSome", { total })}
          {unprinted > 0 && total > 0 ? ` ${t("editor.boxes.bibPrint.unprinted", { count: unprinted })}` : ""}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" }, flexWrap: "wrap", rowGap: 1 }}>
          {mayAssign && (
            <Box>
              {/* The question is the assign form's own (`BibPrintForms`, §384); this button only submits it. */}
              <GlyphButton icon="number" type="submit" form={BIB_ASSIGN_FORM} variant="outlined" size="small" sx={{ minHeight: 44 }}>
                {t("bibs.assign")}
              </GlyphButton>
            </Box>
          )}
          {total > 0 && (
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
          )}
        </Stack>
        {spares && <SpareBibsSection spares={spares} mayReserve={mayAssign} />}
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
      <form id={BIB_DOWNLOAD_FORM} action={`/api/admin/events/${eventId}/bibs`} method="get" hidden>
        <input type="hidden" name="locale" value={locale} />
      </form>
    </>
  );
}
