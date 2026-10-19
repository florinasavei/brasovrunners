import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import ButtonLink from "@/shared/ui/ButtonLink";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";

/**
 * The event page's volunteers box (§768, amending §754; the owner, 2026-10-14: «formularul trebuie să fie pagină separată,
 * nu embedded în pagina evenimentului»): one line, «Căutăm voluntari: Punct de apă, Sosire», and one button,
 * «Vreau să fiu voluntar», to the volunteers' own page (`/evenimente/<slug>/voluntari`) — where the roles with their
 * descriptions and the form are. Nothing else of the volunteers is on the event's page: the header and the landing stay
 * as light as they were.
 *
 * **In a new tab** (§773; the owner, 2026-10-14: «„Vreau să fiu voluntar” ar trebui să fie un buton care să deschidă o pagină nouă
 * în alt tab»): the house's way for a link that leaves the page it is on (`LegalLink`, §197) — `target="_blank"` with
 * `rel="noopener"`, the new-tab mark (`OpenInNewIcon`) after the words, and the accessible name that says it in words, so a person
 * who presses Back finds the event's page as they left it. The button keeps its own glyph before its words and its 44 pixels.
 *
 * Drawn only where that page would answer 200 — `readVolunteerOffer`, the one read both share — and only for the roles
 * that still need people, so the line never names a full one and the button never leads to a 404. It names the roles and
 * **never a number**: how many people a role still needs is the club's to show (`volunteers_show_counts`, §773) and is said
 * on the volunteers' page alone. A Server Component: the button is a plain link (`ButtonLink`, 44 pixels, a glyph before its
 * words), not prefetched — the page it opens is rendered per request.
 *
 * **Who may offer (§NNN).** With «Doar membrii clubului» (`clubOnly`) the line says the club looks for volunteers among its members
 * — `Căutăm voluntari dintre membrii clubului: …` — and the button still opens the volunteers' page, which asks the sign-in. The box
 * is drawn from the public cache for every visitor alike, so the event's page stays static: it never reads who is looking. With
 * «Doar cu invitație de la club» the page draws no box at all (`page.tsx`): nothing on the event's page invites a stranger to a form
 * that is not theirs.
 */
export default async function VolunteerCallout({ slug, roleNames, clubOnly = false }: { slug: string; roleNames: readonly string[]; clubOnly?: boolean }) {
  const t = await getTranslations("Event");
  return (
    <Box component="section" aria-label={t("volunteers.title")} data-testid="volunteer-callout" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 } }}>
      <Typography variant="body1" sx={{ mb: 1 }} data-testid="volunteer-callout-line">
        {/* «Doar membrii clubului» (§NNN): the same box for every visitor — the page it opens asks the sign-in; this one never reads a session. */}
        {t(clubOnly ? "volunteers.callout.lineMembers" : "volunteers.callout.line", { roles: roleNames.join(", ") })}
      </Typography>
      <ButtonLink
        href={{ pathname: "/events/[slug]/volunteers", params: { slug } }}
        target="_blank"
        rel="noopener"
        aria-label={`${t("volunteers.title")} — ${t("opensInNewTab")}`}
        variant="outlined"
        sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}
        data-testid="volunteer-callout-button"
      >
        <VolunteerActivismIcon aria-hidden="true" sx={glyphSx("medium")} />
        {t("volunteers.title")}
        {/* Decorative: the accessible name above already says where this goes. */}
        <OpenInNewIcon aria-hidden="true" data-testid="volunteer-callout-new-tab" sx={{ fontSize: "1rem", flexShrink: 0, opacity: 0.8 }} />
      </ButtonLink>
    </Box>
  );
}
