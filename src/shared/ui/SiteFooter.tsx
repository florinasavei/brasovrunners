import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { env } from "@/shared/config/env";
import BuildBadge from "./BuildBadge";
import { DISCLOSURE_SUMMARY_SX } from "./disclosure";
import { FOOTER_GAP_PHONE, footerTargetSx } from "./footer-target";
import LocaleSwitcher from "./LocaleSwitcher";
import SocialIcon, { type SocialNetwork } from "./SocialIcon";
import ThemeModeToggle from "./ThemeModeToggle";

/**
 * The height of the bar from `sm` up, and of every link inside the fold's panel at every width.
 * 44px is what BR-REQ-041-01 asks of a control; the bar is one line of them.
 */
const BAR_HEIGHT = 44;

/**
 * The footer: one thin row on every width, with everything on it.
 *
 * History: §323 put the privacy notice on the bar, outside the fold, read by its own name.
 * §324 gave a phone a second line for it and the language, since there was no room on the
 * first. §365 shortened that second line and moved the build stamp into the fold's panel.
 *
 * ## One row on a phone: every item, not every word (§372, the owner, 2026-09-24)
 *
 * The owner asked for one row. Eight items with their words — the switch, "Despre club", three
 * marks, "Confidențialitate", RO and EN — need about 370 pixels, and a phone has 288 to 328, so
 * the bar keeps every item but not every word. On a phone, in this order, which is also the DOM
 * order and the order from `sm` up (no `order` anywhere):
 *
 * - the theme switch, in the bar's own corner (criterion 11);
 * - the "Despre club" fold's summary, with its words — the one label on the row;
 * - the privacy notice as a question mark, whose tooltip and accessible name are the notice's
 *   name, the same page it always linked to; "GDPR" from `sm` (§NNN);
 * - Facebook, Instagram, Strava;
 * - RO and EN as flags only, the current one ringed and `aria-current` (`LocaleSwitcher`).
 *
 * §NNN (the owner, 2026-09-25): "it should be a question mark, not a lock, and it should be after
 * the about accordion; the mobile footer icons can be a bit more spaced out" and "Use GDPR for
 * desktop as well." So the notice moved ahead of the marks, the lock became `HelpOutlineOutlined`,
 * the word from `sm` is "GDPR", and a phone's items are `FOOTER_GAP_PHONE` apart.
 *
 * Every item is a square target of the bar's size (`footer-target.ts`): 24 pixels below 360,
 * which is WCAG 2.2 SC 2.5.8's AA floor, 28 from 360, and 44 from `sm`, where nothing changed.
 * It is a footer-bar-only exception to criterion 6: the fold's panel is 44 pixels throughout.
 *
 * ## The gap, measured (§NNN)
 *
 * Measured on the built listing in headless Chromium (Pixel 5 emulation and desktop Chrome, the
 * same numbers in both), fold closed and open (the same numbers: the panel's box is zero wide).
 * Eight items, seven gaps: four between the row's own items and three inside the marks and the
 * flags. The squares are 24 pixels at 320 and 28 from 360; the summary is 90.3 pixels with
 * "Despre club" and 105.8 with "About the club", padding and marker included. With no gap the
 * fold — which takes whatever the fixed items leave — had 46.2 pixels to spare around the English
 * summary at 320, and 46.2 / 7 is 6.6. So:
 *
 * | width | gap | fold | spare beside "Despre club" | spare beside "About the club" |
 * | ---   | --- | ---  | ---                        | ---                           |
 * | 320   | 6   | 110  | 19.7                       | 4.2                           |
 * | 360   | 6   | 122  | 31.7                       | 16.2                          |
 * | 390   | 6   | 152  | 61.7                       | 46.2                          |
 * | 412   | 6   | 174  | 83.7                       | 68.2                          |
 *
 * At 7 pixels the English summary at 320 is cut (84 pixels of words in 81), so 6 is the largest
 * whole gap; every item is on the switch's row at every width, in both languages, and the last
 * flag ends exactly at the row's right edge.
 *
 * ## The fold's panel is inside the fold, under the row
 *
 * The `<details>` owns what it discloses: its summary is on the row, and its panel follows the
 * summary inside it. Opened, the `<details>` grows downward — the row's items are aligned to its
 * top, so each of them stays on the switch's line — and the panel runs from under the summary to
 * the bar's right edge, over the empty space below the privacy mark, the marks and the flags. It can,
 * because the panel's own box is zero pixels wide: its content is wider than it, visibly, and a
 * zero-width box adds nothing to the fold's width in the row's flex layout. Otherwise the fold
 * would take the panel's width as its own and push the marks off the row, which is what the
 * previous two attempts did (a fold grown to the row's width; then a sibling panel shown by a
 * `:has()` rule, which the `<details>` no longer owned). No `:has()` remains, and no JavaScript.
 *
 * The content's width is the viewport's less 80 pixels — more than a classic desktop scrollbar
 * (17 pixels on Windows) plus the widest switch and a margin need — capped at 40rem, so it never
 * reaches past the page's edge nor runs under the scrollbar on a narrow desktop window.
 *
 * ## The build stamp: in the fold below `md`, pinned to the bar's corner from `md`
 *
 * §365 put it nowhere on screen until the fold opened, at every width — the owner's complaint
 * then was a phone showing it "by default". The owner, now, of the desktop site: "I liked when I
 * saw the app on the bottom right." Two renders of `BuildBadge`, mutually exclusive by
 * `display`: one inside the panel (below `md`, unchanged from §365), one outside the fold,
 * absolutely positioned at the bar's own bottom-right corner and shown only from `md`, anchored
 * to the bar — which the footer's own `position: sticky` makes a containing block for — rather
 * than floating over the page as it did before §365.
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
        // The whole bar at every scroll position, one row on a phone too: the privacy notice
        // and the language are on the always-visible bar (BR-REQ-041-01 criterion 21, §323).
        bottom: 0,
        zIndex: 1000,
      }}
    >
      {/* One row that never wraps: every item has its own width, and nothing is drawn over a
          sibling. Aligned to the top, so an open fold grows downward and leaves the rest here. */}
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          // The phone's gap between neighbouring items (§NNN, `footer-target.ts`); from `sm` the
          // items' own padding spaces them, as before.
          columnGap: { xs: `${FOOTER_GAP_PHONE}px`, sm: 0 },
        }}
      >
        {/* The switch, in the bar's own corner (BR-REQ-041-01 criterion 11): the first item, exactly its width. */}
        <Box
          sx={{
            ...footerTargetSx(["width", "height", "flexBasis"]),
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ThemeModeToggle />
        </Box>

        <Box
          component="details"
          data-testid="footer-about-fold"
          sx={{
            // On a phone, whatever the fixed-width items leave: a zero basis, grown, so the label
            // takes exactly the room between them. From `sm`, only as wide as the label. The open
            // panel adds nothing to either (its box is zero wide, below).
            flex: { xs: "1 1 0%", sm: "0 1 auto" },
            minWidth: 0,
          }}
        >
          <Box
            component="summary"
            sx={{
              // The shared affordance (§164): marker, pointer, and an underline on hover and on
              // focus. The height is the bar's here rather than the shared 44 — this summary *is*
              // the bar (`footer-target.ts`).
              ...DISCLOSURE_SUMMARY_SX,
              ...footerTargetSx(["minHeight", "lineHeight"]),
              py: 0,
              px: { xs: 0.5, sm: 1 },
              color: "text.secondary",
              fontSize: "0.8125rem",
              // Only as wide as its label. A block summary spans the line, which put its
              // centre — where a pointer test clicks — under the social marks, and made empty
              // space on the bar toggle the panel.
              width: "fit-content",
              // Never wider than the fold it is in: when the line is short the label is cut
              // with an ellipsis rather than pushing a mark off the bar (at 320px it is not
              // short: the phone's other items leave ~150px for ~85px of "Despre club"). Its
              // padding counts in that width (`border-box`): a content-box summary in a narrow
              // fold ran eight pixels onto its neighbour (§323).
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

          {/* The panel, inside the fold it belongs to: its box is zero wide, so the fold's width
              on the row is the summary's alone, and its content — wider than it, visibly — runs
              under the row to the bar's right edge. */}
          <Box data-testid="footer-about-panel" sx={{ width: 0, overflow: "visible" }}>
            <Stack
              spacing={1.5}
              sx={{
                width: "min(40rem, calc(100vw - 80px))",
                pt: 0.5,
                pb: 1,
                // Indented to where the summary's words start, so it reads as the fold's body.
                pl: { xs: 1.5, sm: 2 },
              }}
            >
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
              {/* The build stamp and the staff entrance (§34): below `md` this is the only place
                  it shows, opened on purpose. From `md` a second copy is pinned to the bar's own
                  corner (below), so this one steps aside there rather than repeat it. */}
              <Box data-testid="footer-build-badge-panel" sx={{ display: { xs: "flex", md: "none" } }}>
                <BuildBadge />
              </Box>
            </Stack>
          </Box>
        </Box>

        {/*
          The privacy notice, on the bar itself rather than in the fold (§323): a person should
          find how their data is used from any page without opening anything — GDPR art. 12 asks
          for the information to be easy to reach, and a closed `<details>` hides it from sight
          and from the accessibility tree alike. Right after the fold at every width (§NNN, the
          owner: "it should be after the about accordion"), ahead of the social marks. Its own
          width, never shrunk.

          Its name is the notice's own at every width, "Nota de confidențialitate (GDPR)" (review
          finding: a screen reader once said "GDPR, link"). From `sm` it shows the word "GDPR"
          (§NNN, the owner: "Use GDPR for desktop as well"), which the Romanian name contains
          (WCAG 2.5.3, label in name). The English name, "Privacy notice", does not: it is kept
          as it was, and whether it should read "Privacy notice (GDPR)" like the Romanian one is
          the owner's call (§NNN). On a phone it is a question mark (§NNN, replacing §372's
          lock): the name, and a tooltip saying the same, are the notice's; no word is rendered.

          `HelpOutlineOutlined` — the circled question mark (`help_outline`), the glyph `Hint`
          already uses — rather than the bare `QuestionMark`: at 20px inside a 24px square the
          bare mark is a thin stroke that reads as a stray character, and the circle gives it the
          same round weight as the three social marks beside it.
        */}
        <Box
          sx={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            "& > a": {
              ...footerTargetSx(["minHeight", "minWidth"]),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              px: { xs: 0, sm: 1 },
              color: "text.secondary",
              fontSize: "0.8125rem",
              whiteSpace: "nowrap",
            },
          }}
        >
          <Link href="/legal/privacy" aria-label={legal("privacyLinkName")} title={legal("privacyLinkName")}>
            {/* An element rendered here, as a child, never a component passed as a prop. */}
            <HelpOutlineOutlinedIcon
              aria-hidden="true"
              data-testid="footer-privacy-mark"
              sx={{ display: { xs: "block", sm: "none" }, fontSize: 20 }}
            />
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              {legal("privacyLinkShort")}
            </Box>
          </Link>
        </Box>

        {/* The social marks, after the privacy notice at every width: each a square of the bar's
            target, the 20px glyph inside it, the phone's gap between them. Their own width,
            never shrunk. */}
        {social.length > 0 && (
          <Stack
            direction="row"
            component="nav"
            aria-label={footer("about.socialLabel")}
            sx={{ flex: "0 0 auto", ml: { sm: 1 }, columnGap: { xs: `${FOOTER_GAP_PHONE}px`, sm: 0 }, alignItems: "center" }}
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
                  ...footerTargetSx(["width", "height"]),
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
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

        {/* The language, on a phone only (§262: `sm` up keeps the header's own copy); the row's
            last item, two flags side by side. */}
        <Box sx={{ display: { xs: "flex", sm: "none" }, flex: "0 0 auto", alignItems: "center" }}>
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
