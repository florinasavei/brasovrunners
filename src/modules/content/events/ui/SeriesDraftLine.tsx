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
 * The series row's line for dates the site is missing (§341, §351): "1 dată nouă, creată automat,
 * nu e pe site: …" with its remedies — «Publică» (every counted draft, through the bulk verb, so
 * the usual publication guards apply, BR-REQ-040-02), «Publică automat de acum» (switches the
 * series' rule on) or «Deschide seria» (when the source is unpublished). A remedy is null when the
 * role may not use it; the server asks again (BR-REQ-060-01). Strings only cross to the islands
 * (§318, §324). The warning is a left rule, not orange text, which is ~3:1 on white.
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
    // Left-aligned even in the phone layout: a wrapped sentence reads from the rule's edge.
    <Box data-testid="series-drafts" sx={{ borderLeft: 3, borderColor: "warning.main", pl: 1, textAlign: "left" }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1 }}>
        <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
          {text}
        </Typography>
        {dates.map((date) => (
          <Typography key={date.id} component="span" variant="body2">
            <Link href={date.href}>
              {/* 44 px tall on a phone for the thumb; a line's height on a desktop. */}
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
      {/* The fixes on their own row so each wraps whole at 320 px. Each button is its own small
          form: the line is drawn twice (table and phone list), so a contained form needs no id. */}
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
