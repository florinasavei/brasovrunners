import GroupsIcon from "@mui/icons-material/Groups";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { cachedFirstRsvpNoticeVersion, cachedPublicRsvps } from "@/modules/public-cache/reads";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { DENSITY } from "@/theme/density";

/**
 * «Vin (N)» (§NNN, «Vin!» part 1): how many come to a turn-up event the club ticked, and the names of those who ticked
 * «Vreau să apar cu numele» — in the shape of the start list's rows (`events/ui/StartList.tsx`), one name to a row, «și încă N»
 * for the rest. **A name is a disclosure** (§143, §396): the rule is `rsvp/domain/public-name.ts`, applied by the cached read
 * (`readPublicRsvps`), so a name that is not to be shown is not even in this component's props. Nobody has answered: only the
 * sentence that asks to be first, no empty count.
 *
 * A Server Component on the static event page (§549): the read is the public cache's, filed under "places", and a confirmation
 * or a withdrawal expires it at once. While the database is away it draws nothing (§281) — a count that cannot be asked is not
 * a count of zero. The wrapper carries `data-nosnippet`, as the start list's does: names stay out of search snippets.
 */
export default async function RsvpCount({ eventId }: { eventId: string }) {
  const t = await getTranslations("Event");
  const rsvps = await readOrWhileAway(async () => cachedPublicRsvps(eventId, await cachedFirstRsvpNoticeVersion()), null);
  if (rsvps === null) return null;

  return (
    <Box
      component="section"
      data-nosnippet=""
      data-testid="rsvp-count"
      aria-labelledby="rsvp-count-title"
      sx={{ mt: { xs: DENSITY.gapSm, sm: 2 }, p: 2, border: 1, borderColor: "divider", borderRadius: 2, maxWidth: 480 }}
    >
      {rsvps.count === 0 ? (
        <Typography id="rsvp-count-title" variant="body1" data-testid="rsvp-count-empty" sx={{ fontWeight: 600 }}>
          {t("rsvp.countEmpty")}
        </Typography>
      ) : (
        <>
          <Typography id="rsvp-count-title" component="h2" variant="h3" data-testid="rsvp-count-heading" sx={{ fontSize: "1.0625rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 1 }}>
            <GroupsIcon aria-hidden sx={FOLD_GLYPH_SX} />
            {t("rsvp.countHeading", { count: rsvps.count })}
          </Typography>
          {(rsvps.names.length > 0 || rsvps.others > 0) && (
            <Box component="ul" sx={{ listStyle: "none", m: 0, mt: 1, p: 0 }}>
              {rsvps.names.map((name, index) => (
                // A name is not unique — two people may both be called Ana — so the position in the order of answers identifies the row.
                <Box
                  component="li"
                  key={`${index}-${name}`}
                  data-testid="rsvp-name"
                  sx={{ py: 1, borderBottom: 1, borderColor: "divider", overflowWrap: "anywhere" }}
                >
                  {name}
                </Box>
              ))}
              {rsvps.others > 0 && (
                <Box component="li" data-testid="rsvp-others" sx={{ py: 1, color: "text.secondary" }}>
                  {t("rsvp.countOthers", { count: rsvps.others })}
                </Box>
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
