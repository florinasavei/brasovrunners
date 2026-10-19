import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import { cachedFirstVolunteersListNoticeVersion, cachedPublicVolunteersList, cachedVolunteersListDescribed } from "@/modules/public-cache/reads";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { DENSITY } from "@/theme/density";
import { volunteersListExpired, volunteersListState } from "../domain/public-list";

/**
 * «Voluntarii» (§NNN, amending §754 and §143/§396; the owner, 2026-10-19: «private vs public lists of volunteers», then «asta ar trebui să fie
 * collapsed, ca și condițiile de participare»): the volunteers of an event whose club ticked «Lista voluntarilor e publică pe pagina evenimentului» —
 * the **name and the role given** of each confirmed volunteer who ticked «Vreau să apar pe lista publică a voluntarilor», «și încă N voluntari» for
 * the rest. **A name is a disclosure** (CLAUDE.md's unbreakable row): the rule is `domain/public-list.ts`, applied by the cached read
 * (`readPublicVolunteersList`), so a name that is not to be shown is not even in this component's props — and never an address, a telephone number,
 * a city or a birth date, which the read does not select.
 *
 * **A native disclosure, closed on arrival** (the owner: «collapsed, ca și condițiile de participare»): `details` in the start list's outlined
 * shape (`StartList`, «Condiții de participare»), working without JavaScript, its title a real `h2` inside the `<summary>` with the count, a
 * glyph before it. The page is about the event; the people are one press away.
 *
 * Drawn only while `volunteersListState` says so: the club's tick is on (the page passes this component only then), the event still takes
 * volunteers, the notice in force describes the list (`cachedVolunteersListDescribed`), the volunteers' rows still exist (thirty days after the
 * event's start), and at least one volunteer may be named — or, when none may and the offer is open (`offerOpen`), the one sentence «Echipa de
 * voluntari se formează.» so a page that asks for volunteers does not look empty. Nothing at all otherwise: not a count, not a sentence.
 *
 * A Server Component on the static event page (§549): the read is the public cache's, filed under "places" and "events", and every write to the
 * people expires it. While the database is away it draws nothing (§281) — a list that cannot be asked is not a list of nobody. The wrapper carries
 * `data-nosnippet`, as the start list's does: names stay out of search snippets.
 */
export default async function VolunteersList({
  eventId,
  locale,
  startsAt,
  offerOpen,
  now,
}: {
  eventId: string;
  locale: Locale;
  /** The event's start, or null while it is to be announced: the card goes with the rows, thirty days after it. */
  startsAt: Date | null;
  /** The volunteers' offer is open (`readVolunteerOffer` answered): the page is asking for people. */
  offerOpen: boolean;
  now: Date;
}) {
  if (volunteersListExpired(startsAt, now)) return null;
  const noticeDescribes = await cachedVolunteersListDescribed(now);
  if (!noticeDescribes) return null;
  const read = await readOrWhileAway(async () => cachedPublicVolunteersList(eventId, await cachedFirstVolunteersListNoticeVersion()), null);
  if (read === null) return null;
  const { list } = read;
  const state = volunteersListState({
    // The page passes this component only for an event whose club ticked the list, and the public read meets only published, public events.
    listPublic: true,
    acceptsVolunteers: read.acceptsVolunteers,
    noticeDescribes,
    published: true,
    membersOnly: false,
    offerOpen,
    named: list.named.length,
    startsAt,
    now,
  });
  if (state === "hidden") return null;

  const t = await getTranslations("Event");
  const roleOf = (person: (typeof list.named)[number]) => (locale === "en" ? person.roleNameEn : person.roleNameRo);

  return (
    // Google honours `data-nosnippet` only on span, div and section elements (not on the `details` root), so the wrapper carries it.
    <Box component="section" data-nosnippet="" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 } }}>
      <Box
        component="details"
        aria-labelledby="volunteers-list-title"
        data-testid="volunteers-list"
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          px: 2,
          "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 1.5 },
          ...DISCLOSURE_OPEN_ARROW,
          "&[open]": { pb: 1 },
        }}
      >
        <Typography component="summary" id="volunteers-list-title" variant="h2" sx={{ fontSize: "1.25rem" }}>
          <VolunteerActivismIcon aria-hidden sx={FOLD_GLYPH_SX} />
          {state === "list" ? t("volunteers.list.heading", { count: list.count }) : t("volunteers.list.title")}
        </Typography>

        {state === "forming" ? (
          <Typography variant="body2" color="text.secondary" data-testid="volunteers-list-forming" sx={{ pb: 1 }}>
            {t("volunteers.list.forming")}
          </Typography>
        ) : (
          <Box component="ul" aria-label={t("volunteers.list.names")} sx={{ listStyle: "none", m: 0, p: 0 }}>
            {list.named.map((person, index) => {
              const role = roleOf(person);
              return (
                // A name is not unique — two people may both be called Ana — so the position in the order of sign-ups identifies the row.
                <Box
                  component="li"
                  key={`${index}-${person.name}`}
                  data-testid="volunteers-list-person"
                  sx={{ py: 1, borderBottom: 1, borderColor: "divider", overflowWrap: "anywhere" }}
                >
                  <Typography component="span" sx={{ fontWeight: 600 }} data-testid="volunteers-list-name">
                    {person.name}
                  </Typography>
                  {role !== null && (
                    <Typography component="span" color="text.secondary" data-testid="volunteers-list-role">
                      {" · "}
                      {role}
                    </Typography>
                  )}
                </Box>
              );
            })}
            {list.others > 0 && (
              <Box component="li" data-testid="volunteers-list-others" sx={{ py: 1, color: "text.secondary" }}>
                {t(`volunteers.list.others.${countForm(list.others, locale)}`, { count: list.others })}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
