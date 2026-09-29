import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { faqOnSite } from "@/modules/content/faq/on-site";
import { menuOrderOnSite } from "@/modules/content/menu/on-site";
import { sortByMenuOrder } from "@/modules/content/menu/order";
import { OPEN_METEO_SITE } from "@/modules/weather/domain/credit";
import { weatherListWords } from "@/modules/weather/words";
import { cachedShownContactAddresses } from "@/modules/public-cache/reads";
import { env } from "@/shared/config/env";
import { DENSITY } from "@/theme/density";
import BuildBadge from "./BuildBadge";
import { DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_SX } from "./disclosure";
import { foldLineSx, footerGapSx, footerTargetSx, PHONE_WIDE } from "./footer-target";
import LocaleSwitcher from "./LocaleSwitcher";
import SocialIcon, { type SocialNetwork } from "./SocialIcon";
import ThemeModeToggle from "./ThemeModeToggle";

/**
 * The height of the bar from `sm` up, and of the fold's links and stamp from `sm` up. 44px is what
 * BR-REQ-041-01 asks of a control; the bar is one line of them. On a phone the bar's items are the
 * bar's own target instead (`footerTargetSx`, §372): 24px below 360, 28px up to `sm`; and since
 * §480 (the 360-px density pass) the fold's lines are 24px at every phone width (`foldLineSx`).
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
 * - the privacy notice as the word "GDPR", whose tooltip and accessible name are the notice's
 *   name, the same page it always linked to (§378 from `sm`, §385 on a phone);
 * - Facebook, Instagram, Strava;
 * - on a phone, a one-pixel rule, then RO and EN as flags only, the current one ringed and
 *   `aria-current` (`LocaleSwitcher`).
 *
 * §378 (the owner, 2026-09-25): "it should be a question mark, not a lock, and it should be after
 * the about accordion; the mobile footer icons can be a bit more spaced out" and "Use GDPR for
 * desktop as well." So the notice moved ahead of the marks, the word from `sm` became "GDPR", and
 * a phone's items were spaced apart. §385 (the owner, the same day, from his phone): "It would fit
 * to say GDPR instead of just a question mark here", "I need a separator before the language
 * switchers", "the info from the expanded footer must be more condensed" and "Version must be
 * within a chip". So the question mark is the word on a phone too, a rule stands before the flags,
 * the panel is one wrapping row of 44-pixel links, and the build stamp is a chip.
 *
 * Every item is a target of the bar's size (`footer-target.ts`): 24 pixels below 360, which is
 * WCAG 2.2 SC 2.5.8's AA floor, 28 from 360, and 44 from `sm`, where nothing changed — a square,
 * except the summary and the word, which are as wide as their words. The rule is decoration, not
 * a target. It is a footer-only exception to criterion 6: since §480 (the 360-px density pass) the
 * fold's lines are 24 on a phone too (`FOLD_LINE`), and 44 from `sm`.
 *
 * ## The gap, measured (§378, §385)
 *
 * Measured on the built listing in headless Chromium (Pixel 5 emulation and desktop Chrome, the
 * same numbers in both), fold closed and open (the same numbers: the panel's box is zero wide).
 *
 * §378's row: eight items, seven gaps. The squares 24 pixels at 320 and 28 from 360; the summary
 * 90.3 pixels with "Despre club" and 105.8 with "About the club", padding and marker included.
 * With no gap the fold had 46.2 pixels to spare around the English summary at 320, and 46.2 / 7
 * is 6.6, so the gap was 6 (at 7 the English summary at 320 was cut):
 *
 * | width | gap | fold | spare beside "Despre club" | spare beside "About the club" |
 * | ---   | --- | ---  | ---                        | ---                           |
 * | 320   | 6   | 110  | 19.7                       | 4.2                           |
 * | 360   | 6   | 122  | 31.7                       | 16.2                          |
 * | 390   | 6   | 152  | 61.7                       | 46.2                          |
 * | 412   | 6   | 174  | 83.7                       | 68.2                          |
 *
 * §385's row: nine items, eight gaps — the rule is an item, with a gap on each side. "GDPR" is
 * 33.6 pixels of 13-pixel Roboto; with 2 pixels a side the link is 37.6 wide, 13.6 more than the
 * 24-pixel glyph square and 9.6 more than the 28-pixel one. The rule is 1 wide. With 6-pixel gaps
 * that is 20.6 more at 320 and 16.6 more at 360, and "About the club" is cut at both: by 16.4 at
 * 320 and by 0.4 at 360. So below 360 the gap is 4 (8 pixels back) and the summary's own padding
 * is 2 a side on a phone instead of 4 (4 more back, at both widths); 4 pixels at 320 without the
 * padding was still 0.4 short, so the question mark would have had to come back there. With both:
 *
 * | width | gap | fold  | summary RO / EN | spare beside "Despre club" | spare beside "About the club" |
 * | ---   | --- | ---   | ---             | ---                        | ---                           |
 * | 320   | 4   | 105.4 | 86.3 / 101.8    | 19.1                       | 3.6                           |
 * | 360   | 6   | 105.4 | 86.3 / 101.8    | 19.1                       | 3.6                           |
 * | 390   | 6   | 135.4 | 86.3 / 101.8    | 49.1                       | 33.6                          |
 * | 412   | 6   | 157.4 | 86.3 / 101.8    | 71.1                       | 55.6                          |
 *
 * No fallback: the word is on the bar at every width, in both languages, every item on the
 * switch's row, the last flag ending exactly at the row's right edge, and the rule 16 pixels tall
 * on the 24-pixel bar and 18 on the 28-pixel one, centred. **Risk, recorded:** 3.6 pixels beside
 * "About the club" at 320 and at 360 is thinner than §378's 4.2. The font is self-hosted Roboto
 * with a metric-matched fallback, so a missing font file changes little; `footer.spec.ts` checks
 * the label is not ellipsised at the four widths in both languages, on both Playwright projects.
 *
 * ## The open panel, measured (§385)
 *
 * Before, at 360 in Romanian with the club's address configured: 188 pixels — the terms and "my
 * registrations" on a 44-pixel line, "Scrie-ne" alone on a second, twelve pixels, "Scrie-ne:
 * <address>" as a 20-pixel paragraph, twelve more, the 44-pixel stamp, and 12 of padding. At 320
 * it was 208 in both languages (the address's paragraph took two lines), from 360 188 in Romanian, and 144 in
 * English from 390, where "Write to us" fitted beside the other two. After: 136 at 320, 360, 390
 * and 412 in both languages — three 44-pixel lines (the two links; "Scrie-ne: <address>"; the
 * stamp) and 4 pixels of padding under them. Open-Meteo's credit was added to the panel after this
 * measurement (§429), a fourth item before the stamp: the panel is expected around 180 pixels on a
 * phone now, not remeasured; `footer.spec.ts` holds it under 188.
 *
 * ## The fold's panel is inside the fold, under the row
 *
 * The `<details>` owns what it discloses: its summary is on the row, and its panel follows the
 * summary inside it. Opened, the `<details>` grows downward — the row's items are aligned to its
 * top, so each of them stays on the switch's line — and the panel runs from under the summary to
 * the bar's right edge, over the empty space below the privacy word, the marks and the flags. It can,
 * because the panel's own box is zero pixels wide: its content is wider than it, visibly, and a
 * zero-width box adds nothing to the fold's width in the row's flex layout. Otherwise the fold
 * would take the panel's width as its own and push the marks off the row, which is what the
 * previous two attempts did (a fold grown to the row's width; then a sibling panel shown by a
 * `:has()` rule, which the `<details>` no longer owned). No `:has()` remains, and no JavaScript.
 *
 * From `sm` the content's width is the viewport's less 80 pixels — more than a classic desktop
 * scrollbar (17 pixels on Windows) plus the widest switch and a margin need — capped at 40rem, so
 * it never reaches past the page's edge nor runs under the scrollbar on a narrow desktop window.
 * On a phone it is less 60 below 360 and less 68 from 360 (§385). The box is border-box
 * (CssBaseline), so the panel's indent is inside that width, not added to it: starting 28 and
 * 34 pixels in, the panel ends 32 pixels short of the edge below 360 and 34 from 360 — the switch
 * there is 24 or 28 pixels rather than 44.
 *
 * ## The build stamp: in the fold below `md`, pinned to the bar's corner from `md`
 *
 * §365 put it nowhere on screen until the fold opened, at every width — the owner's complaint
 * then was a phone showing it "by default". The owner, now, of the desktop site: "I liked when I
 * saw the app on the bottom right." Two renders of `BuildBadge`, mutually exclusive by
 * `display`: one inside the panel (below `md`, unchanged from §365), one outside the fold,
 * absolutely positioned at the bar's own bottom-right corner and shown only from `md`, anchored
 * to the bar — which the footer's own `position: sticky` makes a containing block for — rather
 * than floating over the page as it did before §365. Both are a small outlined chip since §385
 * (`BuildBadge`), inside the same 44-pixel staff entrance.
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
 * The contact line renders only when an address is in force — `EMAIL_REPLY_TO`, the club's Gmail,
 * or both, as «Adresa de contact afișată» on `/admin/emails` says (§442) — and the marks only when
 * configured. Nothing here invents an address.
 *
 * ## Open-Meteo's credit, once for the whole site (§429)
 *
 * The listing used to repeat it under its own cards (§416); the owner, 2026-09-26: "nu vreau
 * footer cu open-weather pe main page" — no such strip on the listing. Its licence (CC BY) still
 * asks for the credit somewhere on the site, so it moved here, into the fold's panel, regardless
 * of how many cards on the page happen to carry a forecast. It is not the only one: the event page
 * keeps its own next to the forecast it shows, and so does the featured hero on the listing, on its
 * «Vremea» line (`EventFacts`, BR-REQ-041-01) — on the listing with a featured forecast the credit
 * is said twice, the hero's and this one; the owner objected to the strip under the cards, not to
 * the hero's line.
 */
export default async function SiteFooter() {
  const legal = await getTranslations("Legal");
  const footer = await getTranslations("Footer");
  const locale = (await getLocale()) as "ro" | "en";
  const weatherCredit = weatherListWords(locale).credit;
  const contacts = await cachedShownContactAddresses();
  // «Întrebări frecvente» in the fold (§525) while the page is on the site — the header's own rule.
  const showFaq = await faqOnSite(locale);
  /*
    The menu's entries the fold carries — «Întrebări frecvente» and «Contact» — in the club's one
    order (§NNN), the header's. «Întrebări frecvente» stays on the first line after the terms and
    «Înscrierile mele» while it comes first, as it always did; placed after «Contact», it follows
    the contact line instead. The rest of the fold is not the menu and keeps its place.
  */
  const faqAfterContact = showFaq && sortByMenuOrder(["faq", "contact"], (key) => key, await menuOrderOnSite())[0] === "contact";
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
          // The phone's gap between neighbouring items (§378, §385, `footer-target.ts`: 4px below
          // 360, 6px from 360); from `sm` the items' own padding spaces them, as before.
          ...footerGapSx(["columnGap"], 0),
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
              // 2px each side on a phone (§385; 4px until "GDPR" took the question mark's place):
              // the four pixels that keep "About the club" whole at 320 and 360 with the word and
              // the rule on the row. Padding inside a summary with no background is invisible;
              // the words and the arrow do not move against each other.
              px: { xs: "2px", sm: 1 },
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
            {/* What the fold holds, as every fold header says it (§521): the club's own facts —
                from `sm` only. A phone's row is §372's one line, with 3.6 pixels to spare beside
                "About the club" at 320 and 360 (the table above); the glyph and the summary's gap
                are 23.6 more, and cut the label at both. There the fold's own arrow is its
                picture, and `display: none` takes the gap with it. */}
            <InfoOutlinedIcon aria-hidden sx={{ ...FOLD_GLYPH_SX, display: { xs: "none", sm: "inline-block" } }} />
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
            {/*
              The panel, condensed (§385, the owner, 2026-09-25: "the info from the expanded
              footer must be more condensed" — his screenshot had four sparse rows: the terms and
              "my registrations", "Scrie-ne" alone, "Scrie-ne: <address>" again 12 pixels further
              down, then the stamp). One wrapping row of 44-pixel targets (BR-REQ-041-01 criterion
              6: the panel keeps 44 at every width), as many to a line as fit, with no margin of
              its own between two lines: a 44-pixel link already has twelve pixels above and below
              its words, which is the tight end. "Scrie-ne" is said once — the form's link, then
              the address as the mail link, on the same line when it fits and directly under it
              when it does not. The stamp is last.

              Measured on the built listing at 360 pixels, in Romanian, the open panel was 188
              pixels tall and 136 after §385. §480 (the 360-px density pass) replaced the 44-pixel
              row with the lines below: 146 with the stamp's 44-pixel box, 130 with the stamp at
              the bar's target too — four lines of 28 and three gaps of 6 — and, in its second
              round, 96: four lines of 24 (`FOLD_LINE`), abutting, the stamp's 44-pixel long-press
              area reaching up into the credit's line rather than adding a line's height. At 320
              it is 96 too with the production stamp (one line of chip, 245 pixels in a 260-pixel
              panel), and 111 where the stamp carries its environment ("local · " or "test · ",
              about 280 pixels, so its chip wraps onto a second line).

              Four lines, not three: the credit is 142 pixels of 14-pixel Roboto (122 at the 12 it
              was) and the production stamp's chip about 250, in a panel 260 wide at 320 and 292
              at 360 — the two never share a line on a phone — nor does the credit fit after the
              first two lines' links (226 in Romanian) or after "Scrie-ne: <address>" (225). A
              shorter stamp would share it, and would drop what `build-badge.spec.ts` holds it to:
              the environment, `app-ver` and the date with its minute.
            */}
            <Box
              sx={{
                // The panel's width, border-box (CssBaseline): the indent below is inside it, not
                // added to it. On a phone the panel starts 28 pixels in below 360 and 34 from 360 (the
                // switch and a gap), so it ends 32 and 34 pixels short of the screen's right edge
                // (288 of 320, 326 of 360) — clear of a 17-pixel classic scrollbar on
                // a narrow desktop window; a phone's own scrollbar overlays. That is 20 and 12
                // pixels wider than the 80-pixel reserve gave, which is what puts "Write to us:
                // <address>" on one line at 320 and the stamp on one line at 360. From `sm` as
                // before: the widest switch, a scrollbar and a margin, capped at 40rem.
                width: { xs: "calc(100vw - 60px)", sm: "min(40rem, calc(100vw - 80px))" },
                [PHONE_WIDE]: { width: "calc(100vw - 68px)" },
                // §480, amending §385 (the owner, 2026-09-26: "Informațiile din footer sunt mult
                // prea spațiate"): the lines set on purpose — the terms and "my registrations",
                // "Scrie-ne" with the address, then the weather credit and the stamp, every word at
                // the panel's 14 pixels (the second round: the credit's 12 was under the site's
                // floor for words a person reads). On a phone every line is `FOLD_LINE`, 24 pixels
                // (`footer-target.ts`), the lines touching and never overlapping — a press is on
                // one link or the next, never on two. From `sm` they are 44 tall as before
                // (BR-REQ-041-01 criterion 6), and from `sm` the panel is §385's one wrapping row
                // again, unchanged: the two groups below give their items to it (`display:
                // contents`), sixteen pixels apart, as many to a line as fit — the lines above are
                // the phone's (§480, the owner's "footer is too tall on mobile" round).
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                flexWrap: { sm: "wrap" },
                alignItems: { xs: "flex-start", sm: "center" },
                columnGap: { sm: 2 },
                rowGap: 0,
                pt: 0,
                pb: { xs: 0, sm: 0.5 },
                // Indented to where the summary's words start, so it reads as the fold's body.
                pl: { xs: 1.5, sm: 2 },
                // The address's own size before (`body2`), for every link now: 14 pixels rather
                // than 16, so the terms and "my registrations" share a line at 320.
                fontSize: "0.875rem",
                // Every link paints over the stamp's long-press reach (`BuildBadge`, `phoneTarget`),
                // which runs up into the line above it: a press on a link is the link's; only the
                // empty part of that line is the stamp's.
                "& a": { display: "inline-flex", alignItems: "center", position: "relative", zIndex: 1, ...foldLineSx(["minHeight"]) },
              }}
            >
              <Box
                data-testid="footer-panel-links"
                // Two links on one line are the density scale's short step apart on a phone (§380),
                // 16 pixels from `sm`; a column gap, so a wrapped link starts flush.
                sx={{ display: { xs: "flex", sm: "contents" }, flexWrap: "wrap", alignItems: "center", columnGap: { xs: DENSITY.gapSm, sm: 2 }, ...footerGapSx(["rowGap"], 0), maxWidth: "100%" }}
              >
                {/* The privacy notice is on the bar (§323); the terms stay in the fold. */}
                <Link href="/legal/terms">{legal("termsLinkLabel")}</Link>
                {/* "My registrations" (BR-REQ-036-04): the one place a runner finds it without an email. A form rendered per request: never prefetched (§549). */}
                <Link href="/registrations/mine" prefetch={false}>{footer("myRegistrations")}</Link>
                {showFaq && !faqAfterContact && <Link href="/faq" data-testid="footer-faq">{footer("faq")}</Link>}
              </Box>
              {/* "Scrie-ne" once (BR-REQ-070-04; the form is rendered per request, so never prefetched, §549): the form, and — when the club's mailbox is
                  configured (§8; nothing here invents an address) — the address beside it as the
                  mail link, "Scrie-ne: <address>". One item, so the address wraps under its own
                  lead rather than onto a line of its own somewhere else. The club's description
                  used to stand in this panel too (the owner: "textul asta nu-și are rostul aici"):
                  the fold is opened to *reach* something, and the homepage introduces the club. */}
              <Box
                component="span"
                data-testid="footer-contact"
                sx={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", columnGap: 0.5, ...footerGapSx(["rowGap"], 0), minWidth: 0, maxWidth: "100%" }}
              >
                <Link href="/contact" prefetch={false}>{contacts.length > 0 ? footer("about.contact") : footer("contactPage")}</Link>
                {/* The address the club chose to show (§442): the mailbox, its Gmail, or both, «… sau …». */}
                {contacts.map((address, index) => (
                  <Box key={address} component="span" sx={{ display: "inline-flex", columnGap: 0.5, minWidth: 0 }}>
                    {index > 0 && <span>{footer("about.or")}</span>}
                    <Box component="a" href={`mailto:${address}`} sx={{ overflowWrap: "anywhere", minWidth: 0 }}>
                      {address}
                    </Box>
                  </Box>
                ))}
              </Box>
              {/* «Întrebări frecvente» after «Contact», where the club's menu order puts it (§NNN): a line of its own on a phone, the next item of the row from `sm`. */}
              {faqAfterContact && <Link href="/faq" data-testid="footer-faq">{footer("faq")}</Link>}
              {/* The last line (§480, amending §385): Open-Meteo's credit and the stamp, side by side
                  from `sm` and one under the other on a phone, at the panel's 14 pixels. */}
              <Box
                data-testid="footer-panel-meta"
                sx={{ display: { xs: "flex", sm: "contents" }, flexWrap: "wrap", alignItems: "center", columnGap: 1, rowGap: 0, maxWidth: "100%" }}
              >
                {/* Open-Meteo's credit (its licence's own ask), here rather than under the listing's
                    cards (§429); the event page and the featured hero keep their own beside the
                    forecast. */}
                <MuiLink href={OPEN_METEO_SITE} target="_blank" rel="noopener noreferrer" data-testid="footer-weather-credit">
                  {weatherCredit}
                </MuiLink>
                {/* The build stamp and the staff entrance (§34), a chip since §385: below `md` this
                    is the only place it shows, opened on purpose, and the panel's last item. From
                    `md` a second copy is pinned to the bar's own corner (below), so this one steps
                    aside there rather than repeat it. */}
                <Box data-testid="footer-build-badge-panel" sx={{ display: { xs: "flex", md: "none" }, maxWidth: "100%" }}>
                  <BuildBadge phoneTarget />
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>

        {/*
          The privacy notice, on the bar itself rather than in the fold (§323): a person should
          find how their data is used from any page without opening anything — GDPR art. 12 asks
          for the information to be easy to reach, and a closed `<details>` hides it from sight
          and from the accessibility tree alike. Right after the fold at every width (§378, the
          owner: "it should be after the about accordion"), ahead of the social marks. Its own
          width, never shrunk.

          Its name is the notice's own at every width, "Nota de confidențialitate (GDPR)" and
          "Privacy notice (GDPR)" (review finding: a screen reader once said "GDPR, link"), and a
          tooltip says the same. The visible word is "GDPR" at every width, which both names
          contain (WCAG 2.5.3, label in name; BR-REQ-041-01 criterion 21): from `sm` since §378
          (the owner: "Use GDPR for desktop as well"), and on a phone since §385 (the owner,
          2026-09-25: "It would fit to say GDPR instead of just a question mark here"), where
          §378's circled question mark had replaced §372's lock. On a phone the link is the bar's
          target tall and as wide as the word plus 2 pixels a side: 37.6 pixels at 13 pixels of
          Roboto, 13.6 more than the glyph's square at 320 and 9.6 more at 360 — the room the
          phone's gaps and the summary's padding gave back (`footer-target.ts`, the table above).
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
              px: { xs: "2px", sm: 1 },
              color: "text.secondary",
              fontSize: "0.8125rem",
              whiteSpace: "nowrap",
            },
          }}
        >
          <Link href="/legal/privacy" aria-label={legal("privacyLinkName")} title={legal("privacyLinkName")}>
            <Box component="span" data-testid="footer-privacy-word">
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
            sx={{ flex: "0 0 auto", ml: { sm: 1 }, ...footerGapSx(["columnGap"], 0), alignItems: "center" }}
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
            last item, two flags side by side, after a rule (§385, the owner, 2026-09-25: "I need
            a separator before the language switchers"): one pixel of the theme's `divider`,
            16 pixels tall on the 24-pixel bar and 18 on the 28-pixel one, centred on the row
            (this box is the flags' height and centres what is in it), the bar's gap on each
            side. Decoration, so hidden from assistive technology — the languages are their own
            named navigation already. From `sm` the languages are in the header and there is
            nothing on the bar to separate, so the rule goes with this box. */}
        <Box sx={{ display: { xs: "flex", sm: "none" }, flex: "0 0 auto", alignItems: "center", ...footerGapSx(["columnGap"], 0) }}>
          <Box
            aria-hidden="true"
            data-testid="footer-language-rule"
            sx={{ flex: "0 0 auto", width: "1px", height: "16px", [PHONE_WIDE]: { height: "18px" }, bgcolor: "divider" }}
          />
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
