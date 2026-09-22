import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { listPublishedAlbums } from "@/modules/content/gallery/repository";
import { listPublishedPages } from "@/modules/content/pages/repository";
import { contactFormReaches } from "@/modules/contact/delivery";
import { readContactRecipientsOrNull } from "@/modules/contact/recipients";
import { buildInfo } from "@/shared/config/build-info";
import { env } from "@/shared/config/env";
import { HEADER_MARK_HEIGHT, HEADER_MARK_HEIGHT_PX, LOGO, PAGE_WIDTH } from "@/theme/brand";
import { KEYFRAMES, MOTION_OK } from "@/theme/motion";
import LocaleSwitcher from "./LocaleSwitcher";
import LogoLink from "./LogoLink";
import NewBuildNotice from "./NewBuildNotice";
import SiteNav from "./SiteNav";

/**
 * The club's standing pages, for the navigation — or nothing at all, whatever goes wrong.
 *
 * ## Why a try/catch and not `.catch()`
 *
 * This was written as `listPublishedPages(getDb(), locale).catch(() => [])`, which reads as
 * guarded and is not: `getDb()` runs **synchronously**, as an argument, and throws before there
 * is any promise for `.catch` to attach to. The rejection handler was chained to a promise that
 * never existed. A `try` covers the call and the await together, which is the only shape that
 * covers both failures.
 *
 * ## Why it must survive having no database at all
 *
 * `db/client.ts` documents the rule this broke: importing it must stay free, because Next
 * evaluates page modules while collecting build data, and a build must work on a machine with
 * no database — CI has none. `/[locale]` is a pure redirect with no `force-dynamic`, so Next
 * prerenders it at build time and renders this layout to do it. Unguarded, that failed the
 * whole build with "DATABASE_URL is not set", on a page that renders nothing.
 *
 * Returning `[]` costs a navigation entry on the two routes that are statically prerendered —
 * a redirect and a catch-all 404, neither of which shows a menu anybody reads. Every page where
 * the navigation matters declares `force-dynamic` and queries for real, on every request.
 *
 * And a header that throws is a site with no way out of any page, which is worse than a site
 * with a shorter menu.
 */
async function navigationPages(locale: Locale) {
  try {
    return await listPublishedPages(getDb(), locale);
  } catch {
    return [];
  }
}

/** Whether the gallery section is offered: a published album in this locale, or nothing. */
async function hasPublishedAlbum(locale: Locale) {
  try {
    return (await listPublishedAlbums(getDb(), locale)).length > 0;
  } catch {
    return false;
  }
}

/**
 * The site header: the club's logo, whole, and a way back to the first page.
 *
 * A Server Component — nothing here is interactive except the link, and that lives in
 * `LogoLink` (AGENTS.md §14.1: narrow client boundaries).
 *
 * The logo is the club's **lockup** — the supplied artwork entire, mountains over the runner
 * and the small `BRASOV RUNNERS` in the lettering the logo was drawn with. For most of
 * 2026-09-17 the kit-face wordmark sat beside it, large, so the name would read at header
 * height; the owner then moved it out of the header and onto the homepage (`shared/ui/Wordmark`),
 * where it has the room a display face wants — and on 2026-09-22 onto the calendar and the
 * contact page as well, as a page heading, never back into this row. The header is the artwork
 * alone again, and the link's accessible name comes from the message catalogue, so assistive
 * technology announces `Brașov Runners`, spelled properly, and never the artwork.
 *
 * A plain `<img>` rather than `next/image`. It is an SVG, so there is nothing for the image
 * optimizer to do, and serving one through `next/image` requires `dangerouslyAllowSVG`, which
 * turns on SVG rendering for *every* remote image the app might ever load. That is a large door
 * to open for one logo.
 *
 * `alt=""` because the link itself carries the name; announcing both would read the club name
 * twice to a screen reader.
 */
export default async function SiteHeader() {
  const t = await getTranslations("Site");
  /**
   * One indexed query on every public page, which is a cost worth naming: the header is what
   * every visitor pays for (`AGENTS.md` §1.5). It buys a navigation an organizer can change
   * without a developer, which is the whole point of the page type (BR-REQ-050-03).
   */
  const locale = await getLocale();
  const pages = await navigationPages(locale as Locale);
  const showGallery = await hasPublishedAlbum(locale as Locale);
  /**
   * "Contact" leads to the form, or to the club's address; a deployment with neither has no
   * entry (BR-REQ-070-04 criterion 1) — the gallery's rule, for the same reason.
   *
   * The same question the page itself asks, and it has to be: since §164 `CONTACT_FORM_MODE`
   * answers for the transport alone, so "can send" no longer implies "has somebody to send
   * to" — a deployment with the Gmail account set and nobody named would otherwise show a
   * menu entry leading to a page that says there is no address.
   *
   * The read costs nothing on the common path and is skipped by the `||`: an address to
   * write to, or an environment that already reaches somebody, answers without it — and a
   * setting can only *add* recipients to those, never take them away. Otherwise it is one
   * primary-key lookup on `platform_settings`, beside the two the header already makes, and
   * guarded the same way: no database means the environment's list answers, as before §164.
   */
  const showContact =
    Boolean(env.EMAIL_REPLY_TO) ||
    contactFormReaches(env, null) ||
    contactFormReaches(env, await readContactRecipientsOrNull());

  return (
    <>
    <Box
      component="header"
      sx={{
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        /**
         * Sticky, because an event page is long and the way out of it should not depend on
         * scrolling back. `sticky` rather than `fixed`: it stays in the flow, so nothing
         * below needs a matching top offset and no page can slide underneath it.
         *
         * The environment notice above is deliberately *not* sticky — it is read once.
         */
        position: "sticky",
        top: 0,
        zIndex: 1100,
        /**
         * A shadow that appears as the page scrolls under the header, so a stuck header reads
         * as sitting *over* the content rather than being part of it. Scroll-driven, in CSS:
         * the keyframes run against the scroll position over the first 80px, not against time,
         * so there is no scroll listener and no client code. Behind `@supports` because a
         * browser without scroll timelines would otherwise play the same keyframes as a
         * zero-second animation and land on the shadow permanently; there it simply has none.
         */
        [MOTION_OK]: {
          "@supports (animation-timeline: scroll())": {
            animation: `${KEYFRAMES.headerShadow} linear both`,
            animationTimeline: "scroll()",
            animationRange: "0 80px",
          },
        },
      }}
    >
      <Container
        maxWidth={PAGE_WIDTH}
        sx={{
          display: "flex",
          alignItems: "center",
          /**
           * One row, at every width. Flex decides where a line breaks from each item's
           * *natural* width, before any shrinking, so with `wrap` a navigation wider than the
           * free space jumped to a second row even though it is built to shrink — which is what
           * the owner saw on 2026-09-17 and called "not a single line". `nowrap` lets the nav
           * take what is left (it has `minWidth: 0`) and fold what does not fit into its menu.
           *
           * Phones wrapped until later the same day, the sections on a second row under the
           * lockup: "on mobile we have to be more efficient — the logo and the navbar must fit on
           * one row". They do now, because the nav measures itself and folds the rest into its
           * menu. And the first section stays on the row even at 320px ("at least one item
           * before the menu — mobile first"): the language switcher stacks RO over EN on a
           * phone, the menu button is the ☰ glyph there, and the gaps tighten, which together
           * buy the ~100px "Evenimente" needs. Nothing overflows — the nav shrinks before the
           * row does (BR-REQ-041-01 criterion 1) — and the header is 60px instead of 112px.
           */
          flexWrap: "nowrap",
          gap: { xs: 0.5, sm: 1 },
          // Tighter since §158: the bar is the logo's height plus a hair, on every width.
          py: { xs: 0.25, sm: 0.5 },
        }}
      >
        <Box sx={{ order: 1, flexShrink: 0 }}>
        <LogoLink label={t("name")}>
          {/*
            Two files, one shown: the blue lockup by day and the white one after dark, chosen
            by the `data-dark` attribute the theme puts on <html> (§93) — CSS, so the swap
            happens with the scheme and never after it.
          */}
          {[
            { src: LOGO.lockup.src, hideOn: "[data-dark] &" },
            { src: LOGO.lockup.onDark, hideOn: "[data-light] &, :root:not([data-dark]) &" },
          ].map((variant) => (
            <Box
              key={variant.src}
              component="img"
              src={variant.src}
              // The attributes reserve the box at its largest, from the artwork's own
              // proportions, so the header does not reflow while the SVG loads; the CSS below
              // draws it at the fluid size. A differently shaped lockup needs no change here.
              height={HEADER_MARK_HEIGHT_PX}
              width={Math.round((HEADER_MARK_HEIGHT_PX * LOGO.lockup.width) / LOGO.lockup.height)}
              alt=""
              sx={{
                display: "block",
                flexShrink: 0,
                height: HEADER_MARK_HEIGHT,
                width: "auto",
                [variant.hideOn]: { display: "none" },
              }}
            />
          ))}
        </LogoLink>
        </Box>

        {/*
          The sections sit next to the club's name, where navigation is looked for, and the
          language sits at the far end, where a setting belongs. They were briefly grouped
          together at the end, which read as two settings rather than a place to go.

          Nothing wraps at any width: the sections fold into the nav's own menu instead, so the
          row stays one row however many pages the club publishes and however narrow the phone.
        */}
        <Box
          sx={{
            order: 2,
            // The nav measures itself against this box and folds what does not fit into a
            // menu (SiteNav). So the box must be *all* the room between the logo and the
            // language switcher: without `flexGrow` it shrank to the entries left on the row
            // after the first fold, measured against that, and folded again — "wrapping
            // happens way too soon, I still have room here" (the owner, 2026-09-17).
            flexGrow: 1,
            minWidth: 0,
            flexShrink: 1,
            ml: { xs: 0.5, sm: 2 },
          }}
        >
          <SiteNav
            pages={pages.map((page) => ({ slug: page.slug, title: page.title }))}
            showGallery={showGallery}
            showContact={showContact}
          />
        </Box>

        {/*
          The scheme switch left this row for the footer's bottom-left corner (§115), and on a
          phone the language switcher has now followed it to the bottom-right (§262).

          On a phone the header row is 328 pixels of which the lockup takes 63: the switcher's
          46 were the difference between "Contact" being on the row and being in the ☰ menu, and
          the owner asked for all three sections — "ar fi fain sa le avem pe toate, eventual
          mutăm selectorul de limbi in dreapta jos". From `sm` up there is room for both, and a
          setting belongs at the far end of the row it is on, so nothing moves there.

          `display: none` rather than a second component: the footer renders its own switcher
          and the hidden one is out of the accessibility tree, so exactly one "Limbă" navigation
          is announced at every width.
        */}
        <Box sx={{ order: 3, ml: "auto", flexShrink: 0, display: { xs: "none", sm: "flex" }, alignItems: "center", gap: { xs: 0, sm: 0.5 } }}>
          <LocaleSwitcher />
        </Box>
      </Container>
    </Box>
      {/*
        "A newer version is deployed", offered and never taken (`NewBuildNotice.tsx`).

        **Below the sticky header and in the flow, since §210.** It was an absolutely positioned
        child of the header's sticky box, which reads well and behaves badly: a positioned
        descendant of a sticky element travels with it, so the notice sat in a fixed band of the
        viewport at *every* scroll position and covered whatever the reader had scrolled to —
        including, on a phone, a field they were trying to reach. Found in review.

        In the flow it costs one layout shift when it appears and then covers nothing, ever. That
        is the right way round: the shift is momentary and the occlusion was permanent. The card
        is a slim bar for the same reason — the smaller the shift, the less it costs somebody
        mid-form.

        `buildInfo.id` as a **string prop**: the identity of the deployment that rendered this
        document, which is the only thing that answers "is this tab out of date?". A value the
        client bundle computed for itself would be the identity of a chunk the browser may have
        had for an hour. And a string, never an element — `CheckboxField.tsx` records what an
        element-valued prop across this boundary costs.

        The backoffice gets it too, because `[locale]/admin` renders inside the same chrome, and
        that is deliberate: the event editor saves both languages in one form, and the race-day
        desk is a phone somebody is working on. Both need to be told and neither may be
        interrupted.
      */}
      <NewBuildNotice build={buildInfo.id} />
    </>
  );
}
