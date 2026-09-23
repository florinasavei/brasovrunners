import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { env } from "@/shared/config/env";
import { DISCLOSURE_SUMMARY_SX } from "./disclosure";
import LocaleSwitcher from "./LocaleSwitcher";
import SocialIcon, { type SocialNetwork } from "./SocialIcon";
import ThemeModeToggle from "./ThemeModeToggle";

/**
 * The height of the footer's one visible line. Thin, by the owner's instruction: the bar sits at
 * the bottom of every page and should cost as little of the screen as a tap target allows. It
 * was 40px while the line held a disclosure and the social marks; since the scheme switch moved
 * here (§115) the line carries a control, and 44px is what BR-REQ-041-01 asks of one.
 */
const BAR_HEIGHT = 44;

/** The scheme switch's own width: the first item on the line, and what an open fold leaves room for. */
const SWITCH_WIDTH = 44;

/** Each social mark's link: a full tap target (BR-REQ-041-01 criterion 6), the 20px glyph inside it. */
const MARK_TARGET = 44;

/**
 * The footer: one thin line, with the social marks always on it and everything else behind it.
 *
 * Six things share the line, as one flex row that wraps. In the bottom-left corner, the
 * light/dark switch (§115: "the theme switcher should be in the bottom left corner" — it was
 * in the header). Then a `<summary>` that opens the rest — the club, the contact, the terms —
 * and names them (`AGENTS.md` §9.2 asks the legal routes be *linked from* the footer; they are,
 * and the registration form links the notice directly where it matters, BR-REQ-070-01). Then
 * the privacy notice, **outside the disclosure** since §NNN, so nobody has to open anything to
 * find how their data is used. Then the
 * social marks — Facebook, Instagram and the Strava club — **outside the disclosure and always
 * visible**, by the owner's instruction on 2026-09-17. And **on a phone the language switcher
 * in the bottom-right corner** (§262: "eventual mutăm selectorul de limbi in dreapta jos") —
 * the header row of a phone is 328 pixels and the sections need them. From `sm` up the
 * language stays in the header, where a setting sits at the end of the row it is on, and this
 * copy is `display: none`, so exactly one "Limbă" navigation exists at any width. The build
 * badge is under the bar on a phone and a tablet and floats in the corner from `md`
 * (`BuildBadge`).
 *
 * ## Why a row that wraps, and not marks positioned on the line
 *
 * Until 2026-09-23 the marks and the two switches were absolutely positioned over the bar,
 * because the line "belonged" to the `<details>` and a flex row cannot put a sibling between
 * a summary and its panel. Positioned, they had no width in the layout, so nothing stopped
 * them landing on something else: at 600–750 pixels the marks, centred, sat on the summary's
 * last word and on the fixed build badge (the owner's screenshot), and on an iPhone the Strava
 * mark could not be tapped at all (Amalia). Every element in the bar is a flex item now, with
 * a width the others make room for, so overlap is not a state the layout can reach — and the
 * e2e suite measures it (`tests/e2e/footer.spec.ts`).
 *
 * The panel is the one thing a flex row does complicate, since it lives inside the
 * `<details>` beside the marks. The answer is the `[open]` state: an open fold takes the rest
 * of the line (`flex-basis: 100% - the switch`) and the marks — and on a phone the language —
 * wrap to a line of their own under the panel, still visible, still 44 pixels. Closed, the
 * summary gives up width first (`flex-shrink`, an ellipsis) so the marks and the language never
 * do; on a phone its tail (", contact și termeni") is not rendered at all.
 *
 * ## Sticky at the bottom
 *
 * Sticky like the header, below the badge's layer (1050) and the header's (1100); `mt: "auto"`
 * still pushes it to the bottom of a short page. Full-bleed rather than in the page's column:
 * the switch belongs in the bar's own corner (BR-REQ-041-01 criterion 11), and `PAGE_WIDTH`
 * is `xl`, so the column and the bar have the same edges on every screen there is.
 *
 * ## Why `<details>` and not a client island
 *
 * It is a collapsible section on the platform: works with JavaScript off, costs no client
 * code, needs no state (§1.5). `display: contents` on the `<details>` would have made the
 * summary and the panel flex items in their own right; Safari does not render a `<details>`
 * that way, and Safari is where this was reported from.
 *
 * The contact line renders only when `EMAIL_REPLY_TO` is set — the mailbox the club actually
 * reads (§8) — and the marks only when configured. Nothing here invents an address.
 */
export default async function SiteFooter() {
  const legal = await getTranslations("Legal");
  const footer = await getTranslations("Footer");
  const contact = env.EMAIL_REPLY_TO;
  const social = [
    { network: "facebook" as SocialNetwork, href: env.CLUB_FACEBOOK_URL, label: footer("about.facebook") },
    { network: "instagram" as SocialNetwork, href: env.CLUB_INSTAGRAM_URL, label: footer("about.instagram") },
    { network: "strava" as SocialNetwork, href: env.CLUB_STRAVA_URL, label: footer("about.strava") },
  ].filter((entry): entry is typeof entry & { href: string } => Boolean(entry.href));

  return (
    <Box
      component="footer"
      sx={{
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        mt: "auto",
        position: "sticky",
        bottom: 0,
        zIndex: 1000,
      }}
    >
      {/* One row, wrapping: every control has its own width here, and nothing is drawn over a sibling. */}
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* The switch, in the bar's own corner (BR-REQ-041-01 criterion 11): the first item, exactly its width. */}
        <Box
          sx={{
            flex: `0 0 ${SWITCH_WIDTH}px`,
            width: SWITCH_WIDTH,
            height: BAR_HEIGHT,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ThemeModeToggle />
        </Box>

        <Box
          component="details"
          sx={{
            // On a phone, whatever the switch, the marks and the language leave: a zero basis,
            // grown. A wrapping row assigns items to lines by their *hypothetical* size before
            // anything shrinks, so a fold sized by its summary would push the language onto a
            // second line at 320px however much it was allowed to shrink — a basis of zero is
            // the one size that never does. From `sm` up there is room, no language here, and
            // the fold is only as wide as its summary, so the marks follow the words rather
            // than sit at the far right, where the build badge floats from `md`.
            flex: { xs: "1 1 0%", sm: "0 1 auto" },
            minWidth: 0,
            // Open, the fold takes the rest of the line: the panel gets the width its links
            // need, and the marks (and on a phone the language) wrap to a line under it.
            "&[open]": { flexBasis: `calc(100% - ${SWITCH_WIDTH}px)` },
          }}
        >
          <Box
            component="summary"
            sx={{
              // The shared affordance (§164): marker, pointer, and an underline on hover and
              // on focus. The height is the bar's here rather than the shared padding — this
              // summary *is* the bar — and the rest is the same fold everywhere else is.
              ...DISCLOSURE_SUMMARY_SX,
              py: 0,
              // Four pixels a side at 320, where the label has 94 to itself; eight from `sm`.
              px: { xs: 0.5, sm: 1 },
              minHeight: BAR_HEIGHT,
              color: "text.secondary",
              fontSize: "0.8125rem",
              lineHeight: `${BAR_HEIGHT}px`,
              // Only as wide as its label. A block summary spans the line, which put its
              // centre — where a pointer test clicks — under the social marks, and made empty
              // space on the bar toggle the panel.
              width: "fit-content",
              // Never wider than the fold it is in: when the line is short the label is cut
              // with an ellipsis rather than pushing a mark off the bar. Its padding counts in
              // that width (`border-box`): at 320 pixels, beside the privacy link (§NNN), the fold
              // is 54 pixels and a content-box summary ran eight pixels onto the link.
              maxWidth: "100%",
              boxSizing: "border-box",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              "&::marker": { color: "text.secondary" },
            }}
          >
            {footer("about.summaryShort")}
            {/* The tail — ", contact and legal" — from `sm` up; a phone's line has no room for it. */}
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              {footer("about.summaryTail")}
            </Box>
          </Box>

          {/* Indented to the summary's text, past its marker, so the panel reads as its body. */}
          <Stack spacing={1.5} sx={{ pt: 0.5, pb: 2, pl: 3.5, pr: 2, maxWidth: "40rem" }}>
            {/* Each link a 44px target (BR-REQ-041-01 criterion 6): the panel is read on a phone too. */}
            <Stack
              direction="row"
              spacing={2}
              sx={{ flexWrap: "wrap", "& > a": { display: "inline-flex", alignItems: "center", minHeight: 44 } }}
            >
              {/* The privacy notice is on the bar (§NNN); the terms stay in the fold. */}
              <Link href="/legal/terms">{legal("termsLinkLabel")}</Link>
              {/* "My registrations" (BR-REQ-036-04): the one place a runner finds it without an email. */}
              <Link href="/registrations/mine">{footer("myRegistrations")}</Link>
              {/* "Scrie-ne" (BR-REQ-070-04): the form, beside the address below it. */}
              <Link href="/contact">{footer("contactPage")}</Link>
            </Stack>
            {/* The links and the address, and nothing else. The club's description used to
                stand here too (the owner: "textul asta nu-și are rostul aici") — a paragraph
                about who the club is, under a fold called "About the club, contact and terms",
                which is opened to *reach* something rather than to read. The homepage is where
                the club introduces itself. */}
            {contact && (
              <Typography variant="body2" color="text.secondary">
                {footer("about.contact")} <a href={`mailto:${contact}`}>{contact}</a>
              </Typography>
            )}
          </Stack>
        </Box>

        {/*
          The privacy notice, on the line itself rather than in the fold (§NNN): a person should
          find how their data is used from any page without opening anything — GDPR art. 12 asks
          for the information to be easy to reach, and a closed `<details>` hides it from sight
          and from the accessibility tree alike. Its own width, never shrunk, like the marks.

          On a phone the line has the switch, the summary, three marks and the language in 320
          pixels, and "Confidențialitate" alone is a third of it — so there it says "GDPR", the
          word Romanian sites use for the same link, and the full label from `sm` up.
        */}
        <Box
          sx={{
            flex: "0 0 auto",
            height: BAR_HEIGHT,
            display: "flex",
            alignItems: "center",
            "& > a": {
              display: "inline-flex",
              alignItems: "center",
              minHeight: BAR_HEIGHT,
              px: { xs: 0.5, sm: 1 },
              color: "text.secondary",
              fontSize: "0.8125rem",
              whiteSpace: "nowrap",
            },
          }}
        >
          <Link href="/legal/privacy">
            <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
              {legal("privacyLinkShort")}
            </Box>
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              {legal("privacyLinkLabel")}
            </Box>
          </Link>
        </Box>

        {social.length > 0 && (
          <Stack
            direction="row"
            component="nav"
            aria-label={footer("about.socialLabel")}
            sx={{
              // Their own width, never shrunk: three 44px targets side by side.
              flex: "0 0 auto",
              // On a phone the free space of the line goes before the marks, so they sit at
              // the right beside the language; from `sm` up they follow the summary.
              ml: { xs: "auto", sm: 1 },
              height: BAR_HEIGHT,
              alignItems: "center",
            }}
          >
            {social.map((entry) => (
              // Off-site, so each opens in a new tab and carries its own `rel` — the same rule
              // the rich-text renderer applies to every external link. The name is on the link,
              // the mark is decoration.
              <MuiLink
                key={entry.href}
                href={entry.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={entry.label}
                title={entry.label}
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: MARK_TARGET,
                  height: MARK_TARGET,
                  flexShrink: 0,
                  borderRadius: 1,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <SocialIcon network={entry.network} size={20} />
              </MuiLink>
            ))}
          </Stack>
        )}

        {/* The language, in the opposite corner and on a phone only (§262): the last item on the
            line, its own width, so nothing is drawn over the mark beside it. */}
        <Box
          sx={{
            display: { xs: "flex", sm: "none" },
            flex: "0 0 auto",
            ml: "auto",
            height: BAR_HEIGHT,
            alignItems: "center",
            pr: 0.5,
          }}
        >
          <LocaleSwitcher />
        </Box>
      </Box>
    </Box>
  );
}
