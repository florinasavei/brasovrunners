import GroupsIcon from "@mui/icons-material/Groups";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import { cachedFirstRsvpMemberNoticeVersion, cachedFirstRsvpNoticeVersion, cachedPublicRsvps } from "@/modules/public-cache/reads";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { zoneRsvpTitleId } from "@/modules/rsvp/domain/zone-outcome";
import type { PublicRsvps } from "@/modules/rsvp/rsvp";
import { FOLD_GLYPH_INLINE_SX, PUBLIC_FOLD_SX } from "@/shared/ui/disclosure";
import { CLUB_NAME } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { RSVP_WHO_ID } from "../rsvp-box";

/** The page's one read of the answers (§812): the public cache's, filed under «places»; `null` while the database is away. */
export async function readRsvpsOf(eventId: string): Promise<PublicRsvps | null> {
  return readOrWhileAway(async () => cachedPublicRsvps(eventId, await cachedFirstRsvpNoticeVersion(), await cachedFirstRsvpMemberNoticeVersion()), null);
}

/**
 * «Cine vine (N)» on a turn-up event (§811, «Vin!» part 1; moved out of the card by §825): how many come to an event the club ticked,
 * and the names of those who ticked «Vreau să apar cu numele» — in the shape of the start list's rows (`events/ui/StartList.tsx`), one name
 * to a row, «și încă N» for the rest. **A name is a disclosure** (§143, §396): the rule is `rsvp/domain/public-name.ts`, applied by the
 * cached read (`readPublicRsvps`), so a name that is not to be shown is not even in this component's props. Nobody has answered: the bar
 * says «Cine vine» without a number and the fold says «Încă nu a confirmat nimeni.», no empty count.
 *
 * **Its own closed fold, right under «Confirmă prezența (opțional)»; the two are the last thing on the event page (§825 amended, 2026-10-20)** (the owner, 2026-10-19: «„Cine vine" trebuie să fie mai vizibil. Că
 * inițial am citit în „zig-zag" și am sărit peste secțiune»; before it the names sat inside the card's fold, behind a bar that said
 * «Vii?»): the same `<details>` as the races' list (`StartList`) — the 44-pixel bar, the people glyph, a real `h2` in the summary with the
 * count on its line — closed on arrival, at `#cine-vine` (`RSVP_WHO_ID`), the anchor the facts' line «N vin · vezi cine» links to and
 * `OpenFoldFromHash` (mounted by the page) opens. `EventPageView` draws it after the card, in the same condition as the card, handing
 * both the one read it made (`rsvps`).
 *
 * **The member mark** (§831; the owner, 2026-10-19: «Și aici, la „Cine vine", trebuie să pot trece dacă sunt membru BVR»): beside the name of a member who
 * chose to show it, a small «BVR» chip (the members' glyph, `aria-label` «Membru Brașov Runners»); **never beside «și încă N»** — an answer with no shown name adds
 * to «Dintre ei: M membri» only, and the cached read puts no mark in its props for it (`readPublicRsvps`: the mark is the name's, under the notice version
 * that described it). The words are the club's own constants and the catalogue's, nothing else about a member is on the page.
 *
 * A Server Component on the static event page (§549): the read is the public cache's, filed under "places", and a confirmation
 * or a withdrawal expires it at once. While the database is away it draws nothing (§281) — a count that cannot be asked is not
 * a count of zero. The wrapper carries `data-nosnippet`, as the start list's does: names stay out of search snippets.
 *
 * **`open`: the members' zone's card (§715 amended; the owner, 2026-10-19: «And it should be a lot easier for BVR members to see this»)**
 * — the same bar, the same people glyph, the same rows and «și încă N», but not a fold: a heading and the list, always showing, under each
 * run in «Alergări» (`members-area/page.tsx`), which hands every card the one read it made for the page (`readPublicRsvpsFor`) and so never
 * asks per card. The anchor carries the event's id (many cards, one page). The heading is an `h4`, one level under the run's own title (`h3`), and the region is named by the run's title and the heading together — «Alergarea de joi Cine vine (3)» — so a screen reader's list of regions says which run each belongs to. The disclosure is the event page's, not wider: the names are
 * those the cached read gives — a confirmed answer whose person ticked, under a notice that describes «Vin!» — and being a member shows
 * no more (§143, §812). Nobody has answered: nothing is drawn, the row above it already says so and invites the first answer.
 */
export default async function RsvpCount({ eventId, rsvps: given, open = false }: { eventId: string; rsvps?: PublicRsvps | null; open?: boolean }) {
  const t = await getTranslations("Event");
  const locale = await getLocale();
  const rsvps = given === undefined ? await readRsvpsOf(eventId) : given;
  if (rsvps === null || (open && rsvps.count === 0)) return null;
  // One anchor per card when many are on a page (the zone's), the event page's own `#cine-vine` otherwise.
  const who = open ? `${RSVP_WHO_ID}-${eventId}` : RSVP_WHO_ID;

  return (
    // Google honours `data-nosnippet` only on span, div and section elements, so the wrapper — not the disclosure — carries it.
    <Box component="section" data-nosnippet="" aria-labelledby={open ? `${zoneRsvpTitleId(eventId)} ${who}-title` : `${who}-title`} sx={{ mt: open ? 1 : { xs: DENSITY.gapSm, sm: 3 } }}>
      <Box component={open ? "div" : "details"} id={who} data-testid="rsvp-who" data-open={open ? "true" : undefined} sx={open ? {} : { ...PUBLIC_FOLD_SX, scrollMarginTop: 16 }}>
        <Box component={open ? "div" : "summary"}>
          <Typography id={`${who}-title`} component={open ? "h4" : "h2"} variant="h2" data-testid="rsvp-who-heading" sx={{ fontSize: open ? "1rem" : "1.25rem", ...(open ? { fontWeight: 700, mb: 0.5 } : {}) }}>
            <GroupsIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
            {/* The races' own words (`startList.title*`): one bar, one wording, wherever «Cine vine» is drawn. */}
            {rsvps.count === 0 ? t("startList.title") : t("startList.titleCount", { count: rsvps.count })}
          </Typography>
        </Box>
        {rsvps.count === 0 ? (
          <Typography variant="body1" data-testid="rsvp-who-empty" sx={{ fontWeight: 600 }}>
            {t("rsvp.whoEmpty")}
          </Typography>
        ) : (
          (rsvps.names.length > 0 || rsvps.others > 0 || rsvps.members) && (
            <>
              {/* «Dintre ei: 2 membri.» (§831): every confirmed member answer, the named and the unnamed, so a mark is never the only way a member is counted. */}
              {rsvps.members ? (
                <Typography variant="body2" color="text.secondary" data-testid="rsvp-who-members" sx={{ mb: 0.5 }}>
                  {t("rsvp.whoMembers", { members: t(`rsvp.members.${countForm(rsvps.members, locale)}`, { count: rsvps.members }) })}
                </Typography>
              ) : null}
              <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {rsvps.names.map((name, index) => (
                  // A name is not unique — two people may both be called Ana — so the position in the order of answers identifies the row.
                  <Box
                    component="li"
                    key={`${index}-${name}`}
                    data-testid="rsvp-name"
                    sx={{ py: 1, borderBottom: 1, borderColor: "divider", overflowWrap: "anywhere", display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1 }}
                  >
                    {name}
                    {/* The mark is the name's, never a row's of its own: only for a name that is shown (`memberMarks` is parallel to `names`). */}
                    {rsvps.memberMarks?.[index] === true && (
                      <GlyphChip glyph="membersOnly" label={t("rsvp.memberMark")} srLabel={t("rsvp.memberLabel", { club: CLUB_NAME })} variant="outlined" color="primary" testId="rsvp-member-mark" />
                    )}
                  </Box>
                ))}
                {rsvps.others > 0 && (
                  <Box component="li" data-testid="rsvp-others" sx={{ py: 1, color: "text.secondary" }}>
                    {t("rsvp.countOthers", { count: rsvps.others })}
                  </Box>
                )}
              </Box>
            </>
          )
        )}
      </Box>
    </Box>
  );
}
