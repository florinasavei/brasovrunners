import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import GlyphButton from "@/shared/ui/GlyphButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import type { CapacityHistory as History, HistoryEntry, HistoryLine, Places, SettingKey, SettingValue, Who } from "../domain/capacity-history";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A number of places in words: the number, «fără limită», or «?» for a value the row did not write readably. */
function placesWords(t: Translate, value: Places): string {
  if (value === undefined) return t("capacityHistory.unknown");
  return value === null ? t("capacityHistory.noLimit") : String(value);
}

/** A switch's value in words: ticked or not, «Da» or «Nu» for the automatic offers, the alert's N or «oprit». */
function settingWords(t: Translate, setting: SettingKey, value: SettingValue): string {
  if (value === undefined) return t("capacityHistory.unknown");
  if (setting === "placesAlert") return value === null || typeof value === "boolean" ? t("capacityHistory.values.alertOff") : String(value);
  if (setting === "autoOffer") return t(value === true ? "capacityHistory.values.yes" : "capacityHistory.values.no");
  return t(value === true ? "capacityHistory.values.on" : "capacityHistory.values.off");
}

function whoWords(t: Translate, who: Who): string {
  if (who.kind === "staff") return who.name;
  return t(who.kind === "automatic" ? "capacityHistory.who.automatic" : "capacityHistory.who.removed");
}

/** What changed, and the facts beside it, as the parts of one line. */
function entryParts(t: Translate, entry: HistoryEntry, when: (at: Date) => string): string[] {
  if (entry.kind === "places") {
    return [
      t(entry.field === "capacity" ? "capacityHistory.what.capacity" : "capacityHistory.what.kept", { from: placesWords(t, entry.from), to: placesWords(t, entry.to) }),
      ...(entry.why ? [t(`capacityHistory.why.${entry.why}`)] : []),
      ...(entry.reason ? [t("capacityHistory.reason", { reason: entry.reason })] : []),
      ...(entry.occupied !== null ? [t("capacityHistory.occupied", { occupied: entry.occupied })] : []),
      ...(entry.offered !== null && entry.offered > 0 ? [t("capacityHistory.offered", { offered: entry.offered })] : []),
      ...(entry.registrationExists === false ? [t("capacityHistory.registrationGone")] : []),
    ];
  }
  if (entry.kind === "released") {
    return [
      t("capacityHistory.what.released", { released: entry.released === null ? t("capacityHistory.unknown") : entry.released }),
      ...(entry.deadline ? [t("capacityHistory.released.deadline", { deadline: when(entry.deadline) })] : []),
      ...(entry.test !== null && entry.test > 0 ? [t("capacityHistory.released.test", { test: entry.test })] : []),
      ...(entry.free !== null ? [t("capacityHistory.released.free", { free: entry.free })] : []),
      ...(entry.waiting !== null ? [t("capacityHistory.released.waiting", { waiting: entry.waiting })] : []),
      ...(entry.offerOnlyTicked ? [t("capacityHistory.released.ticked")] : []),
    ];
  }
  return [
    t(`capacityHistory.what.${entry.setting}`, { from: settingWords(t, entry.setting, entry.from), to: settingWords(t, entry.setting, entry.to) }),
    ...(entry.why ? [t(`capacityHistory.why.${entry.why}`)] : []),
  ];
}

/**
 * «Istoric capacitate» on «Planul locurilor» (§NNN): one line per change of the event's places, newest first — when,
 * who, from how many to how many and why («3 nov. 2026, 14:02 · Amalia · Locuri: 175 → 176 · un loc în plus pentru
 * «Trimite-i oferta» · ocupate 175»), «Vezi înscrierea» beside a supplementary place whose registration still exists —
 * and, between two rows that do not join, «Schimbare neînregistrată: 175 → 190». The reading and the order are
 * `domain/capacity-history.ts`'s; this only says them. A Server Component; the one link per line is a plain `<a>`.
 */
export default async function CapacityHistory({ history, locale }: { history: History; locale: string }) {
  const t = await getTranslations("Admin");
  const say: Translate = (key, values) => t(key, values);
  const when = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });
  const line = (entry: HistoryLine, index: number) => {
    if (entry.kind === "gap") {
      return (
        <Typography key={`gap-${index}`} component="li" variant="body2" color="text.secondary" sx={{ fontStyle: "italic", py: 0.5 }} data-testid="capacity-history-gap">
          {t("capacityHistory.gap", { from: placesWords(say, entry.from), to: placesWords(say, entry.to) })}
        </Typography>
      );
    }
    const text = [when(entry.at), whoWords(say, entry.who), ...entryParts(say, entry, when)].join(" · ");
    const linked = entry.kind === "places" && entry.registrationId !== null && entry.registrationExists === true ? entry.registrationId : null;
    return (
      <Box key={entry.id} component="li" sx={{ py: 0.5 }} data-testid="capacity-history-line" data-kind={entry.kind}>
        <Typography variant="body2" component="span">
          {text}
        </Typography>
        {linked && (
          <GlyphButton
            icon="goTo"
            href={getPathname({ locale, href: { pathname: "/admin/registrations/[id]", params: { id: linked } } })}
            variant="text"
            size="small"
            sx={{ ...TAP_TARGET, ml: 0.5 }}
            data-testid="capacity-history-registration"
          >
            {t("capacityHistory.registration")}
          </GlyphButton>
        )}
      </Box>
    );
  };
  return (
    <Box data-testid="capacity-history">
      <Typography variant="body2" color="text.secondary" data-testid="capacity-history-current">
        {t("capacityHistory.current", { capacity: placesWords(say, history.current) })}
      </Typography>
      {history.lines.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid="capacity-history-empty">
          {t("capacityHistory.empty")}
        </Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, mt: 1, p: 0, listStyle: "none" }}>
          {history.lines.map(line)}
        </Box>
      )}
      {history.limited && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid="capacity-history-limited">
          {t("capacityHistory.limited", { count: history.count })}
        </Typography>
      )}
    </Box>
  );
}
