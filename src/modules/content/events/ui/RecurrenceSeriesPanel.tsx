import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { EVENT_LIST_ALL } from "@/modules/content/events/list-query";
import { daysPhrase } from "@/modules/deadlines/domain/duration-words";
import { deadlinesForThisRequest } from "@/modules/deadlines/request";
import CheckboxField from "@/shared/ui/CheckboxField";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import { ACTION_ICONS } from "@/shared/ui/action-icons";

type DateLink = { id: string; label: string };

type Props = {
  locale: string;
  /** The date whose editor is open. */
  eventId: string;
  /** The series' first event, which holds the rule — this one or its source. */
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
    setRepeatPublish: ActionFormAction;
    stopRepeat: ActionFormAction;
  };
};

/**
 * The Recurență box for any date of a series (§350), source or copy: where this date sits and its
 * neighbours, the rule in words, the next dates, how the series renews (§122, §377) or that it is
 * stopped, "Publică datele noi automat" with its own save (`setRepeatPublish`, on the source's
 * rule) and "Oprește recurența" (`stopRepeat` resolves the source). Controls render only for the
 * roles the service allows.
 */
export default async function RecurrenceSeriesPanel(props: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const { locale, eventId, sourceId, seriesTitle, position, count, previous, next, ruleSentence, publish, sourceLive, ended, upcoming, lastCreated, mayChange, actions } =
    props;
  const running = ruleSentence !== null && !ended;
  const publishState = publish ? (sourceLive ? t("editor.repeatPublishOn") : t("editor.repeatPublishWaiting")) : t("editor.repeatPublishOff");
  // The robot glyph for automatic renewal (§398), as on the events list (`ACTION_ICONS.renew`).
  const RenewIcon = ACTION_ICONS.renew;
  // How far ahead the job keeps dates created — the club's number (§377).
  const horizon = daysPhrase(locale, (await deadlinesForThisRequest()).seriesHorizonDays);

  return (
    <Panel glyph="recurrence" collapsible openWhen={{ primary: true }} id="box-recurrence" title={t("editor.boxes.recurrence.title")} aside={ruleSentence ?? t("editor.repeatStopped")} data-testid="recurrence-series">
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600 }}>
            {t("editor.series.kicker", { title: seriesTitle })} · {t("editor.series.positionShort", { position: String(position), count: String(count) })}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2 }}>
            {previous && (
              <Link href={{ pathname: "/admin/events/[id]", params: { id: previous.id } }} style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                {t("editor.series.previous", { date: previous.label })}
              </Link>
            )}
            {next && (
              <Link href={{ pathname: "/admin/events/[id]", params: { id: next.id } }} style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                {t("editor.series.next", { date: next.label })}
              </Link>
            )}
            {sourceId !== eventId && (
              <Link href={{ pathname: "/admin/events/[id]", params: { id: sourceId } }} style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
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
                    <Link href={{ pathname: "/admin/events/[id]", params: { id: date.id } }} style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                      {date.label}
                    </Link>
                  )}
                </li>
              ))}
            </Box>
            {/* «Toate datele»: the list's «Toate», since the plain list shows only the dates to come (§555). */}
            <Link href={{ pathname: "/admin", query: { state: EVENT_LIST_ALL } }} style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
              {t("editor.repeatAllInList", { count })}
            </Link>
          </Box>
        )}

        {running ? (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "flex-start" }}>
            <RenewIcon aria-hidden fontSize="small" sx={{ color: "text.secondary", mt: "2px", flexShrink: 0 }} />
            <Typography variant="body2" color="text.secondary">
              {t("editor.repeatRenewal", { date: lastCreated ?? "—", horizon })}
            </Typography>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("editor.repeatStopped")}
          </Typography>
        )}

        {/* Whether new dates go live by themselves (§350), with its own save, on the source's rule. */}
        {running && (
          <Box data-testid="repeat-publish">
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "flex-start", mb: 1 }}>
              <RenewIcon aria-hidden fontSize="small" sx={{ color: "text.secondary", mt: "2px", flexShrink: 0 }} />
              <Typography variant="body2" color="text.secondary">
                {publishState}
              </Typography>
            </Stack>
            {mayChange && (
              /*
                Turning it on asks first, as the list's "Publică automat de acum" does (§384);
                turning it off or saving it unchanged asks nothing.
              */
              <ActionForm
                action={actions.setRepeatPublish}
                confirm={
                  publish
                    ? undefined
                    : {
                        when: [{ field: "publish", equals: "on" }],
                        title: t("events.seriesDraftsAutoPublishTitle"),
                        body: t("confirm.repeatPublishOnBody"),
                        confirmLabel: t("events.seriesDraftsAutoPublishConfirm"),
                        cancelLabel: words.cancel,
                      }
                }
                data-testid="repeat-publish-form"
              >
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="eventId" value={eventId} />
                <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
                  <CheckboxField name="publish" defaultChecked={publish}>
                    {t("editor.repeatPublishAuto")}
                  </CheckboxField>
                  <GlyphSubmitButton label={t("editor.repeatPublishSave")} pendingLabel={t("editor.repeatPublishPending")} icon="save" variant="outlined" size="small" />
                </Stack>
              </ActionForm>
            )}
          </Box>
        )}

        {running &&
          (mayChange ? (
            <ActionForm
              action={actions.stopRepeat}
              confirm={{ title: t("editor.repeatStop"), body: t("editor.repeatStopHelp"), confirmLabel: t("editor.repeatStop"), cancelLabel: words.cancel, destructive: true }}
              data-testid="repeat-stop-form"
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={eventId} />
              <GlyphButton icon="repeatStop" type="submit" variant="outlined" color="warning" size="small" sx={{ minHeight: 44 }}>
                {t("editor.repeatStop")}
              </GlyphButton>
            </ActionForm>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("editor.repeatAdminOnly")}
            </Typography>
          ))}

        <Panel glyph="help" collapsible level={3} title={t("editor.repeatHelpSummary")}>
          <Typography variant="body2" color="text.secondary">
            {t("editor.repeatHelp", { horizon })}
          </Typography>
        </Panel>
      </Stack>
    </Panel>
  );
}
