import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { env } from "@/shared/config/env";
import BuildBadge from "./BuildBadge";
import { DISCLOSURE_SUMMARY_SX } from "./disclosure";
import LocaleSwitcher from "./LocaleSwitcher";
import SocialIcon, { type SocialNetwork } from "./SocialIcon";
import ThemeModeToggle from "./ThemeModeToggle";

/**
 * The height of the footer's line, from `sm` up and inside the fold's panel at every width.
 * Thin, by the owner's instruction: the bar sits at the bottom of every page and should cost as
 * little of the screen as a tap target allows. It was 40px while the line held a disclosure and
 * the social marks; since the scheme switch moved here (§115) the line carries a control, and
 * 44px is what BR-REQ-041-01 asks of one.
 */
const BAR_HEIGHT = 44;

/**
 * The bar's height on a phone (§NNN, the owner 2026-09-24: "all in 1 row … all visible,
 * smaller"). A footer-only exception to BR-REQ-041-01 criterion 6's 44px: every item here is a
 * 32px target instead, so the whole line — the switch, the fold, three marks, the notice and
 * both languages — fits in 320px without dropping anything. The fold's own panel, once opened,
 * stays at the ordinary 44px throughout; only the closed bar shrinks.
 */
const BAR_HEIGHT_XS = 32;

/** The scheme switch's own width: the first item on the line, and what an open fold leaves room for. */
const SWITCH_WIDTH = 44;
/** The switch's width on a phone (§NNN): the same 32px exception as `BAR_HEIGHT_XS`. */
const SWITCH_WIDTH_XS = 32;

/** Each social mark's link: a full tap target (BR-REQ-041-01 criterion 6), the 20px glyph inside it. */
const MARK_TARGET = 44;
/** A mark's target on a phone (§NNN): 32px, the glyph still 20px inside it. */
const MARK_TARGET_XS = 32;

/**
 * The footer: one thin line on every width, with everything on it — never two lines any more.
 *
 * History: §323 put the privacy notice on the bar, outside the fold, read by its own name.
 * §324 gave a phone a second line for it and the language, since there was no room on the
 * first. §365 shortened that second line and moved the build stamp into the fold's panel, off
 * the bar entirely. This is the next step, and the owner chose which way it goes: "it should
 * fit all in 1 row" — asked what gives way, "All visible, smaller."
 *
 * ## One row on a phone, every item smaller (§NNN, the owner, 2026-09-24)
 *
 * A phone's bar is one row, always, in this order: the theme switch, the "Despre club" fold's
 * summary with its text on screen, the three social marks, the privacy notice by its name, then
 * RO and EN. Nothing drops — every item that was on the bar before is still on it — so what
 * gives is size: a **footer-only exception to BR-REQ-041-01 criterion 6**, 32px targets instead
 * of 44 (`BAR_HEIGHT_XS`, `SWITCH_WIDTH_XS`, `MARK_TARGET_XS`) and roughly 12px text, so the
 * whole line fits in 320px. The exception stops at the bar: the fold's panel, once opened, is
 * 44px throughout, like every other page, and `sm` up keeps the original 44px bar too — nothing
 * here changes above a phone. The language's flag icons are the one thing that actually drops on
 * a phone (`LocaleSwitcher`): the two-letter code alone still says which is which, and a flag
 * costs width a code does not.
 *
 * The row's item order matches this reading order directly — `order` values only diverge
 * between `xs` and `sm` where the two need to differ (the marks sit before the privacy notice on
 * a phone, after it from `sm` up, exactly as they did before).
 *
 * ## The fold still opens to a panel below the row, full width
 *
 * `<details>` still holds the "Despre club" summary and its panel — the terms, "Înscrierile
 * mele", "Scrie-ne", the contact address, and, on a phone only, the build stamp (`sm` up now
 * shows the stamp pinned to the bar's own corner instead, see below, so the panel does not
 * repeat it there). Opening it must not touch the row above: the `&[open]` rule still forces the
 * `<details>` to the rest of the line's width (`flex-basis: 100% - the switch`) so the panel gets
 * room to lay out, and `flexWrap: "wrap"` still lets it, and only it, drop to a line of its own —
 * the row's other items (marks, notice, language) keep their fixed widths and stay exactly where
 * they were, on the row's own line, above the panel.
 *
 * ## The build stamp: in the fold on a phone, pinned to the bar's corner from `md`
 *
 * §365 put it nowhere on screen until the fold opened, at every width — the owner's complaint
 * then was a phone showing it "by default". The owner, now, of the desktop site: "I liked when I
 * saw the app on the bottom right." Two renders of `BuildBadge`, mutually exclusive by
 * `display`, resolve both: one inside the panel (`xs`–`sm`, the phone's door to it, unchanged
 * from §365), one outside the `<details>` altogether, absolutely positioned at the bar's own
 * bottom-right corner and shown only from `md` — the pre-§365 desktop placement, back where the
 * owner wants it, without floating loose over page content the way it did before §365 (`position:
 * fixed` over the viewport): it is anchored to the bar itself, which the footer's own
 * `position: sticky` already makes a containing block for.
 *
 * ## Sticky at the bottom
 *
 * Sticky like the header, below the header's layer (1100); `mt: "auto"` still pushes it to the
 * bottom of a short page. Full-bleed rather than in the page's column: the switch belongs in the
 * bar's own corner (BR-REQ-041-01 criterion 11), and `PAGE_WIDTH` is `xl`, so the column and the
 * bar have the same edges on every screen there is.
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
        // The whole bar at every scroll position, both lines on a phone: the privacy notice and
        // the language are on the always-visible bar (BR-REQ-041-01 criterion 21, §323, §365).
        bottom: 0,
        zIndex: 1000,
      }}
    >
      {/* One row, wrapping only for the open fold's panel: every control has its own width, and
          nothing is drawn over a sibling. */}
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* The switch, in the bar's own corner (BR-REQ-041-01 criterion 11): the first item, exactly its width. */}
        <Box
          sx={{
            flex: { xs: `0 0 ${SWITCH_WIDTH_XS}px`, sm: `0 0 ${SWITCH_WIDTH}px` },
            width: { xs: SWITCH_WIDTH_XS, sm: SWITCH_WIDTH },
            height: { xs: BAR_HEIGHT_XS, sm: BAR_HEIGHT },
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
            // Whatever the fixed-width items leave: a zero basis, grown, so the label takes
            // exactly the room between them and shrinks first when the line is tight.
            flex: { xs: "1 1 0%", sm: "0 1 auto" },
            minWidth: 0,
            // Open, the fold takes the rest of the line: the panel gets the width its links
            // need, and `flexWrap` lets it — and only it — drop to a line of its own; the
            // switch, the marks, the notice and the language keep their place on the row above.
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
              px: { xs: 0.25, sm: 1 },
              minHeight: { xs: BAR_HEIGHT_XS, sm: BAR_HEIGHT },
              color: "text.secondary",
              fontSize: { xs: "0.75rem", sm: "0.8125rem" },
              lineHeight: { xs: `${BAR_HEIGHT_XS}px`, sm: `${BAR_HEIGHT}px` },
              // Only as wide as its label. A block summary spans the line, which put its
              // centre — where a pointer test clicks — under the social marks, and made empty
              // space on the bar toggle the panel.
              width: "fit-content",
              // Never wider than the fold it is in: when the line is short the label is cut
              // with an ellipsis rather than pushing a mark off the bar. Its padding counts in
              // that width (`border-box`): a content-box summary in a narrow fold ran eight
              // pixels onto its neighbour (§323).
              maxWidth: "100%",
              boxSizing: "border-box",
              whiteSpace: "nowrap",
              overflow: "hidden",
              "&::marker": { color: "text.secondary" },
            }}
          >
            {/* One flex item for the words: the summary is a flex row (§325), and the tail as an
                item of its own took the row's gap — "Despre club , contact și termeni" on every
                desktop. The ellipsis is here, where the text is. */}
            <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {footer("about.summaryShort")}
              {/* The tail — ", contact and legal" — from `sm` up; a phone's line has no room for it. */}
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                {footer("about.summaryTail")}
              </Box>
            </Box>
          </Box>

          {/* Indented to the summary's text, past its marker, so the panel reads as its body. */}
          <Stack spacing={1.5} sx={{ pt: 0.5, pb: 1, pl: 3.5, pr: 2, maxWidth: "40rem" }}>
            {/* Each link a 44px target (BR-REQ-041-01 criterion 6): the panel is read on a phone too. */}
            {/* A column gap rather than `spacing`: `spacing` is a left margin, which a link that
                wraps to the next line kept, so on a phone it started 16px in from the one above. */}
            <Stack
              direction="row"
              useFlexGap
              sx={{
                flexWrap: "wrap",
                columnGap: 2,
                "& > a": { display: "inline-flex", alignItems: "center", minHeight: 44 },
              }}
            >
              {/* The privacy notice is on the bar (§323); the terms stay in the fold. */}
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
            {/* The build stamp and the staff entrance (§34): on a phone this is still the only
                place it shows, opened on purpose. From `md` a second copy is pinned to the bar's
                own corner (below), so this one steps aside there rather than repeat it. */}
            <Box data-testid="footer-build-badge-panel" sx={{ display: { xs: "flex", md: "none" } }}>
              <BuildBadge />
            </Box>
          </Stack>
        </Box>

        {/*
          The social marks, before the privacy notice on a phone — matching the owner's order
          for the one-row bar — and after it from `sm` up, unchanged from before. Their own
          width, never shrunk.
        */}
        {social.length > 0 && (
          <Stack
            direction="row"
            component="nav"
            aria-label={footer("about.socialLabel")}
            sx={{
              flex: "0 0 auto",
              order: { xs: 1, sm: 0 },
              ml: { sm: 1 },
              height: { xs: BAR_HEIGHT_XS, sm: BAR_HEIGHT },
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
                  width: { xs: MARK_TARGET_XS, sm: MARK_TARGET },
                  height: { xs: MARK_TARGET_XS, sm: MARK_TARGET },
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

        {/*
          The privacy notice, on the line itself rather than in the fold (§323): a person should
          find how their data is used from any page without opening anything — GDPR art. 12 asks
          for the information to be easy to reach, and a closed `<details>` hides it from sight
          and from the accessibility tree alike. Its own width, never shrunk, like the marks.

          It reads as the notice's name at every width, "Confidențialitate" (§324; review
          finding: a phone said "GDPR", which names a regulation, not the page).

          The link's name is the notice's own at every width (review finding: a screen reader
          said "GDPR, link"), and it keeps the visible word inside it, so somebody who says
          what they see to voice control still hits it (WCAG 2.5.3, label in name).
        */}
        <Box
          sx={{
            flex: "0 0 auto",
            order: { xs: 2, sm: 0 },
            height: { xs: BAR_HEIGHT_XS, sm: BAR_HEIGHT },
            display: "flex",
            alignItems: "center",
            "& > a": {
              display: "inline-flex",
              alignItems: "center",
              minHeight: { xs: BAR_HEIGHT_XS, sm: BAR_HEIGHT },
              px: { xs: 0.5, sm: 1 },
              color: "text.secondary",
              fontSize: { xs: "0.75rem", sm: "0.8125rem" },
              whiteSpace: "nowrap",
            },
          }}
        >
          <Link href="/legal/privacy" aria-label={legal("privacyLinkName")}>
            {legal("privacyLinkLabel")}
          </Link>
        </Box>

        {/* The language, on a phone only (§262: `sm` up keeps the header's own copy); the row's
            last item, RO and EN side by side. */}
        <Box
          sx={{
            display: { xs: "flex", sm: "none" },
            flex: "0 0 auto",
            order: 3,
            height: BAR_HEIGHT_XS,
            alignItems: "center",
          }}
        >
          <LocaleSwitcher />
        </Box>
      </Box>

      {/* The build stamp's second copy, from `md` up: pinned to the bar's own bottom-right
          corner (the owner: "on the desktop version I liked when I saw the app on the bottom
          right"), on screen without opening anything. Absolutely positioned against the footer
          box above — `position: sticky` on it is already a containing block for this — so it
          never takes width away from the row, and the row's items never move to make room for
          it. Below `md` this copy steps aside; the fold's own copy (above) is the only door to
          it there. */}
      <Box
        data-testid="footer-build-badge-pinned"
        sx={{
          display: { xs: "none", md: "flex" },
          position: "absolute",
          right: 16,
          top: 0,
          // The bar's own height, not the whole footer's: opening "Despre club" on a desktop
          // grows the box below the bar, and this stays pinned to the bar's row rather than
          // drifting to the middle of a now-taller footer.
          height: BAR_HEIGHT,
          alignItems: "center",
        }}
      >
        <BuildBadge />
      </Box>
    </Box>
  );
}
