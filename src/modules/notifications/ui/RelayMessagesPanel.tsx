import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { ROADS, type Road } from "@/modules/notifications/domain/road-failover";
import { type RelayRow, type RelayView } from "@/modules/notifications/relay-view";
import { roadRings } from "@/modules/notifications/road-status";
import type { StatusGlyphName } from "@/shared/ui/status-glyphs";
import Panel from "@/shared/ui/Panel";
import StatusChip from "@/shared/ui/StatusChip";

/**
 * «Mesaje de pe site» (§778) on «Setări» → «Emailuri», under the queue: what «Scrie-ne» and «Spune-ne ceva»
 * put in the outbox, one row each — the form, the status, the road the club chose and the road it left by (the other
 * one marked «prin cealaltă cale»), the tries, what each road answered, and whether the words are kept until it
 * leaves or already deleted — and the two roads' own state above them: the last message each carried, the last
 * refusal and, when a road has been failing, since when. No address and no word of any message (`relay-view.ts`).
 *
 * A Server Component, folded. It opens by itself while a message waits, was lost, or a road has been failing for over
 * an hour. Every glyph is a name for `StatusChip`, never an element made here (§370).
 */
const STATUS_GLYPH: Readonly<Record<RelayRow["status"], StatusGlyphName>> = {
  PENDING: "planned",
  PROCESSING: "building",
  SENT: "done",
  FAILED: "failed",
  BOUNCED: "failed",
  COMPLAINED: "failed",
};

export default async function RelayMessagesPanel({ locale, view, now, openWhen }: { locale: Locale; view: RelayView; now: Date; openWhen?: Parameters<typeof Panel>[0]["openWhen"] }) {
  const t = await getTranslations("Admin");
  const when = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
  const roadName = (road: Road) => t(`emails.relay.road.${road}`);
  const lost = view.rows.some((row) => row.status === "FAILED" || row.status === "BOUNCED");
  const failing = ROADS.some((road) => roadRings(road, view.states[road], now));
  const waiting = view.rows.some((row) => row.status === "PENDING" || row.status === "PROCESSING");

  return (
    <Panel
      glyph="outbox"
      collapsible
      tone={failing || lost ? "risk" : "default"}
      title={t("emails.relay.title")}
      intro={t("emails.relay.intro")}
      aside={t("emails.relay.aside", { count: view.total })}
      openWhen={{ ...openWhen, attention: waiting || lost || failing }}
      id="relay-messages"
      data-testid="relay-messages"
    >
      <Stack component="ul" spacing={0.5} sx={{ listStyle: "none", m: 0, mb: 2, p: 0 }} data-testid="relay-roads">
        {ROADS.map((road) => {
          const state = view.states[road];
          const last = view.lastSuccess[road];
          return (
            <Box component="li" key={road} data-testid={`relay-road-${road}`} data-failing={roadRings(road, state, now) ? "true" : "false"}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {roadName(road)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {last ? t("emails.relay.lastOk", { when: when(last) }) : t("emails.relay.neverOk")}
                {state.lastFailureAt ? ` · ${t("emails.relay.lastFailure", { when: when(state.lastFailureAt), error: state.lastError ?? "—" })}` : ""}
              </Typography>
              {state.failingSince && (
                <Typography variant="body2" color={roadRings(road, state, now) ? "error" : "text.secondary"} data-testid={`relay-road-${road}-failing`}>
                  {t("emails.relay.failingSince", { when: when(state.failingSince) })}
                </Typography>
              )}
            </Box>
          );
        })}
      </Stack>

      {view.rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="relay-empty">
          {t("emails.relay.empty")}
        </Typography>
      ) : (
        <Stack component="ul" spacing={1} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {view.rows.map((row) => {
            const otherWay = row.via !== null && row.road !== null && row.via !== row.road;
            return (
              <Box component="li" key={row.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }} data-testid="relay-row" data-status={row.status}>
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center", mb: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t(`emails.relay.type.${row.type}`)}
                  </Typography>
                  <StatusChip glyph={STATUS_GLYPH[row.status]} label={t(`emails.relay.status.${row.status}`)} color={row.status === "SENT" ? "success" : row.status === "PENDING" || row.status === "PROCESSING" ? "default" : "error"} />
                  {otherWay && <StatusChip glyph="otherRoad" label={t("emails.relay.otherWay")} color="warning" testId="relay-other-way" />}
                  <StatusChip
                    glyph={row.bodyDeleted ? "wordsGone" : "wordsKept"}
                    label={t(row.bodyDeleted ? "emails.relay.body.deleted" : "emails.relay.body.kept")}
                    variant="outlined"
                    testId={row.bodyDeleted ? "relay-body-deleted" : "relay-body-kept"}
                  />
                </Stack>
                <Typography variant="body2">
                  {row.road ? t("emails.relay.chosen", { road: roadName(row.road) }) : ""}
                  {row.via ? ` · ${t(otherWay ? "emails.relay.leftByOther" : "emails.relay.leftBy", { road: roadName(row.via) })}` : ""}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="p">
                  {t("emails.queue.facts", { queued: when(row.createdAt), attempts: row.attempts })}
                  {row.sentAt ? ` · ${t("emails.relay.sentAt", { when: when(row.sentAt) })}` : ""}
                </Typography>
                {ROADS.filter((road) => row.failures[road]).map((road) => (
                  <Typography key={road} variant="caption" color="error" component="p" sx={{ mt: 0.5, wordBreak: "break-word" }}>
                    {t("emails.relay.failure", { road: roadName(road), count: row.failures[road]?.count ?? 0, error: row.failures[road]?.lastError ?? "—" })}
                    {row.failures[road]?.ambiguous ? ` · ${t("emails.relay.pinned")}` : ""}
                  </Typography>
                ))}
                {!ROADS.some((road) => row.failures[road]) && row.lastError && (
                  <Typography variant="caption" color="error" component="p" sx={{ mt: 0.5, wordBreak: "break-word" }}>
                    {t("emails.queue.lastError", { error: row.lastError })}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
      {view.total > view.rows.length && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("emails.queue.more", { count: view.total - view.rows.length })}
        </Typography>
      )}
    </Panel>
  );
}
