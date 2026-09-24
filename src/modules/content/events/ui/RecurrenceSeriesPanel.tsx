import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import CheckboxField from "@/shared/ui/CheckboxField";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type DateLink = { id: string; label: string };

type Props = {
  locale: string;
  /** The date whose editor is open. */
  eventId: string;
  /** The series' first event, which holds the rule — this one, or the one it was copied from. */
  sourceId: string;
  seriesTitle: string;
  /** 1-based, among the dates that exist. */
  position: number;
  count: number;
  previous: DateLink | null;
  next: DateLink | null;
  /** The rule in words with its end ("… — la nesfârșit"), or null once the series is stopped. */
  ruleSentence: string | null;
  /** The rule's own flag: whether the dates made from now on go live by themselves. */
  publish: boolean;
  /** Whether the source is live — the dates of a draft stay drafts whatever the flag says. */
  sourceLive: boolean;
  ended: boolean;
  /** The next few dates from today, the open one marked. */
  upcoming: readonly (DateLink & { current: boolean })[];
  /** "ultima creată: …", the last date that exists. */
  lastCreated: string | null;
  /** Creating, stopping and switching the flag: `canCreateEvent`, asked again by the service. */
  mayChange: boolean;
  actions: {
    setRepeatPublish: (form: FormData) => Promise<void>;
    stopRepeat: (form: FormData) => Promise<void>;
  };
};

/**
 * The Recurență box for a date of a series (§NNN, "state B") — the source or **any** copied date:
 * a copied date showed nothing of its series but a 2-pixel box with the way back, and whoever
 * opened next Monday's run could not see the rule, stop it or switch its publication without first
 * finding the first date. Every question about the series is answered here, from any of its dates:
 *
 * - where this date sits ("Seria „…” · data 3 din 8"), the dates on either side, the first one;
 * - the rule in words, read from the source; the next five dates as links; how the series renews
 *   itself (the job keeps eight weeks created, §122), or that it is stopped;
 * - "Publică datele noi automat" with its own "Salvează setarea" (`setRepeatPublish`, on the
 *   source's rule, from any date) — its own form, because it changes the rule at the press;
 * - "Oprește recurența", aimed at the source from any date (`stopRepeat` resolves it).
 *
 * Each control is rendered only for the role the service allows; everyone else reads.
 */
export default async function RecurrenceSeriesPanel(props: Props) {
  const t = await getTranslations("Admin");
  const { locale, eventId, sourceId, seriesTitle, position, count, previous, next, ruleSentence, publish, sourceLive, ended, upcoming, lastCreated, mayChange, actions } =
    props;
  const running = ruleSentence !== null && !ended;
  const publishState = publish ? (sourceLive ? t("editor.repeatPublishOn") : t("editor.repeatPublishWaiting")) : t("editor.repeatPublishOff");

  return (
    <Panel collapsible openWhen={{ inUse: true }} id="box-recurrence" title={t("editor.boxes.recurrence.title")} aside={ruleSentence ?? t("editor.repeatStopped")} data-testid="recurrence-series">
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600 }}>
            {t("editor.series.kicker", { title: seriesTitle })} · {t("editor.series.positionShort", { position: String(position), count: String(count) })}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2 }}>
            {previous && (
              <Link href={{ pathname: "/admin/events/[id]", params: { id: previous.id } }} style={{ display: "inline-block", padding: "10px 0" }}>
                {t("editor.series.previous", { date: previous.label })}
              </Link>
            )}
            {next && (
              <Link href={{ pathname: "/admin/events/[id]", params: { id: next.id } }} style={{ display: "inline-block", padding: "10px 0" }}>
                {t("editor.series.next", { date: next.label })}
              </Link>
            )}
            {sourceId !== eventId && (
              <Link href={{ pathname: "/admin/events/[id]", params: { id: sourceId } }} style={{ display: "inline-block", padding: "10px 0" }}>
                {t("editor.repeatOfLink")}
              </Link>
            )}
          </Stack>
        </Box>

        <Typography variant="body2">{ruleSentence ?? t("editor.repeatStopped")}</Typography>

        {upcoming.length > 0 && (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t("editor.repeatNextDates")}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {upcoming.map((date) => (
                <li key={date.id}>
                  {date.current ? (
                    <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                      {date.label} · {t("editor.scope.thisOne")}
                    </Typography>
                  ) : (
                    <Link href={{ pathname: "/admin/events/[id]", params: { id: date.id } }} style={{ display: "inline-block", padding: "6px 0" }}>
                      {date.label}
                    </Link>
                  )}
                </li>
              ))}
            </Box>
            <Link href="/admin" style={{ display: "inline-block", padding: "10px 0" }}>
              {t("editor.repeatAllInList", { count })}
            </Link>
          </Box>
        )}

        <Typography variant="body2" color="text.secondary">
          {running ? t("editor.repeatRenewal", { date: lastCreated ?? "—" }) : t("editor.repeatStopped")}
        </Typography>

        {/* Whether the dates made from now on go live by themselves (the hints branch's switch, §NNN),
            as a tick and its own "Salvează setarea" — on the source's rule, from any date. */}
        {running && (
          <Box data-testid="repeat-publish">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {publishState}
            </Typography>
            {mayChange && (
              <form action={actions.setRepeatPublish}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="eventId" value={eventId} />
                <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
                  <CheckboxField name="publish" defaultChecked={publish}>
                    {t("editor.repeatPublishAuto")}
                  </CheckboxField>
                  <GlyphSubmitButton label={t("editor.repeatPublishSave")} pendingLabel={t("editor.repeatPublishPending")} icon="save" variant="outlined" size="small" />
                </Stack>
              </form>
            )}
          </Box>
        )}

        {running &&
          (mayChange ? (
            <form action={actions.stopRepeat}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={eventId} />
              <ConfirmSubmitButton
                label={t("editor.repeatStop")}
                icon="repeatStop"
                title={t("editor.repeatStop")}
                body={t("editor.repeatStopHelp")}
                confirmLabel={t("editor.repeatStop")}
                cancelLabel={t("confirm.cancel")}
                color="warning"
              />
            </form>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("editor.repeatAdminOnly")}
            </Typography>
          ))}

        <Panel collapsible level={3} title={t("editor.repeatHelpSummary")}>
          <Typography variant="body2" color="text.secondary">
            {t("editor.repeatHelp")}
          </Typography>
        </Panel>
      </Stack>
    </Panel>
  );
}
