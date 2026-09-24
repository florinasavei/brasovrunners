import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import Panel from "@/shared/ui/Panel";

/** The two small forms the card's controls belong to, by id (`form="…"`). */
export const BIB_ASSIGN_FORM = "bib-assign";
export const BIB_DOWNLOAD_FORM = "bib-download";

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
};

/**
 * Sub-sub-card 8.4.2, "Alocare și tipărire" (§NNN), edit only: the race numbers given out and the
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
export async function BibPrintCard({ eventId, total, unprinted, mayAssign, onlyTest, attention }: Props) {
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
              <ConfirmSubmitButton
                form={BIB_ASSIGN_FORM}
                label={t("bibs.assign")}
                icon="number"
                title={t("confirm.bibsTitle")}
                body={t("confirm.bibsBody")}
                confirmLabel={t("bibs.assign")}
                cancelLabel={t("confirm.cancel")}
              />
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
export function BibPrintForms({
  eventId,
  locale,
  mayAssign,
  assignAction,
}: {
  eventId: string;
  locale: string;
  mayAssign: boolean;
  /** `assignBibNumbersAction`, handed down by the page that owns the actions. */
  assignAction: (form: FormData) => Promise<void>;
}) {
  return (
    <>
      {mayAssign && (
        <form id={BIB_ASSIGN_FORM} action={assignAction} hidden>
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="eventId" value={eventId} />
        </form>
      )}
      <form id={BIB_DOWNLOAD_FORM} action={`/api/admin/events/${eventId}/bibs`} method="get" hidden>
        <input type="hidden" name="locale" value={locale} />
      </form>
    </>
  );
}
