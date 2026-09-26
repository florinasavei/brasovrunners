import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import GlyphButton from "@/shared/ui/GlyphButton";
import Hint from "@/shared/ui/Hint";
import { actionKeyOf } from "@/shared/forms/action-key";

type Action = (form: FormData) => Promise<void>;

/** A confirming button's words, already translated by the page. */
type Confirmed = { label: string; confirmTitle: string; confirmBody: string; confirmLabel: string };

/**
 * "1 dată nouă, creată automat, nu e pe site: lun., 16 nov. [Publică] [Publică automat de acum]"
 * — the series row's line for the dates the site is missing (`DECISIONS.md` §341, §351).
 *
 * The owner, of the line it replaced and its "?": "tot nu e clar ce e cu data asta în ciornă… ai
 * pus grămadă de text degeaba în tooltip… practic asta e data din aia de viitor generată
 * automat?". It was: the newest date the standing job made (§122), a draft because the series'
 * rule does not publish. So the words now say what the date *is* — created by the series itself,
 * not on the site — and the line carries the fix instead of a paragraph describing where the fix
 * is (`draftRemedies`):
 *
 * - **Publică** — publishes exactly the drafts this line counts, every one of them and not only
 *   the linked ones, through the list's own bulk verb (`bulkPublishEventsAction`), so the role,
 *   the version guard and the both-languages rule (BR-REQ-040-02) are the ones publication
 *   always has. It asks first: publishing puts the dates on the site and opens their
 *   registration.
 * - **Publică automat de acum** — switches the series' rule on (`setRepeatPublishAction`, aimed at
 *   the source, `returnTo=list`) and comes back to this list. Its confirmation says it acts on the
 *   dates the series creates from now on, and that the ones listed still need "Publică".
 * - **Deschide seria** — for a series whose source is not published: the source's editor, where it
 *   is published. The switch is not offered there, because it cannot take effect until then.
 *
 * Each remedy is null when the viewer's role may not use it — the page asks the same questions
 * the server asks again (BR-REQ-060-01). A Server Component: the words, the dates' labels and the
 * addresses arrive as strings (§324, no client island formats a date), and the islands — the "?",
 * the confirming buttons — are handed strings and a glyph's name (§318).
 *
 * The mark is a warning-coloured rule down the left, not warning-coloured text: MUI's orange on
 * white is about 3:1, under what small body text needs, and the words are the part to read.
 */
export type SeriesDraftLineProps = {
  uiLocale: string;
  /** "2 date noi, create automat, nu sunt pe site:", already counted and translated. */
  text: string;
  /** The drafts to link, in the order `seriesDrafts` gave them; the page caps how many. */
  dates: ReadonlyArray<{ id: string; label: string; href: string }>;
  /** "și încă 3", for the drafts past the cap — the folded list below has every date. */
  more: string | null;
  /** One short sentence behind a "?", or null when the words already say it. */
  hint: string | null;
  /** Every draft the line counts, as `id:version` — not only the linked ones. */
  publish: (Confirmed & { action: Action; refs: readonly string[] }) | null;
  /** The series' own rule, switched on from its source. */
  autoPublish: (Confirmed & { action: ActionFormAction; sourceId: string }) | null;
  openSource: { href: string; label: string } | null;
  cancelLabel: string;
};

export default function SeriesDraftLine({ uiLocale, text, dates, more, hint, publish, autoPublish, openSource, cancelLabel }: SeriesDraftLineProps) {
  const anyRemedy = publish !== null || autoPublish !== null || openSource !== null;
  return (
    // Left-aligned even in the phone layout, whose value column aligns right: a sentence that
    // wraps reads from the rule down its left edge, not from a ragged left margin.
    <Box data-testid="series-drafts" sx={{ borderLeft: 3, borderColor: "warning.main", pl: 1, textAlign: "left" }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1 }}>
        <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
          {text}
        </Typography>
        {dates.map((date) => (
          <Typography key={date.id} component="span" variant="body2">
            <Link href={date.href}>
              {/* The span sizes the link: 44 px tall on a phone, where a thumb presses it, and a
                  line's height on a desktop, where the row should stay a row. */}
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", minHeight: { xs: 44, md: 0 } }}>
                {date.label}
              </Box>
            </Link>
          </Typography>
        ))}
        {more && (
          <Typography component="span" variant="body2" color="text.secondary">
            {more}
          </Typography>
        )}
        {hint && <Hint text={hint} />}
      </Box>
      {/* The fixes, on a row of their own under the words so each wraps whole at 320 px. Each
          button is its own small form: the line is drawn twice (the wide table and the phone
          list), and a form it contains needs no id to be told apart. Sentence case, as the
          list's own buttons ("shouting is not a size"). */}
      {anyRemedy && (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, mt: 0.5, "& .MuiButton-root": { textTransform: "none" } }}>
          {publish && (
            <form action={publish.action} data-action-key={actionKeyOf(publish.action)}>
              <input type="hidden" name="uiLocale" value={uiLocale} />
              {publish.refs.map((ref) => (
                <input key={ref} type="hidden" name="eventRef" value={ref} />
              ))}
              <ConfirmSubmitButton
                label={publish.label}
                title={publish.confirmTitle}
                body={publish.confirmBody}
                confirmLabel={publish.confirmLabel}
                cancelLabel={cancelLabel}
                icon="publish"
                variant="contained"
              />
            </form>
          )}
          {autoPublish && (
            <ActionForm
              action={autoPublish.action}
              confirm={{ title: autoPublish.confirmTitle, body: autoPublish.confirmBody, confirmLabel: autoPublish.confirmLabel, cancelLabel }}
            >
              <input type="hidden" name="uiLocale" value={uiLocale} />
              <input type="hidden" name="eventId" value={autoPublish.sourceId} />
              <input type="hidden" name="publish" value="on" />
              <input type="hidden" name="returnTo" value="list" />
              <GlyphButton icon="turnOn" type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }}>
                {autoPublish.label}
              </GlyphButton>
            </ActionForm>
          )}
          {openSource && (
            <GlyphButton icon="edit" href={openSource.href} variant="outlined" size="small" sx={{ minHeight: 44 }}>
              {openSource.label}
            </GlyphButton>
          )}
        </Stack>
      )}
    </Box>
  );
}
