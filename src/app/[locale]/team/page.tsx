import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { buildOrgChart, type OrgChartNode } from "@/modules/content/team/domain/org-chart";
import { teamLinkHost, type TeamLinkKind } from "@/modules/content/team/links";
import { teamMetaDescription } from "@/modules/content/team/meta-description";
import {
  type PublicTeamBox,
  type PublicTeamLink,
  type PublicTeamMember,
  type PublicTeamPage,
  teamPageOnSite,
} from "@/modules/content/team/repository";
import { teamLinkKindWords } from "@/modules/content/team/ui/kind-words";
import TeamLinkGlyph from "@/modules/content/team/ui/TeamLinkGlyph";
import { teamPhotoFrame } from "@/modules/content/team/ui/team-photo-frame";
import TeamPhotoImage from "@/modules/content/team/ui/TeamPhotoImage";
import { type PictureColumn, pictureSizes, pictureSrcSet } from "@/modules/media/ladder";
import { cachedTeamPage } from "@/modules/public-cache/reads";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import ClubIdentity from "@/shared/ui/ClubIdentity";
import ContactLink from "@/shared/ui/ContactLink";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { riseIn } from "@/theme/motion";
import { headingRule } from "@/theme/surfaces";

type Props = { params: Promise<{ locale: string }> };

/**
 * Static, made on its first visit and kept by the CDN (§549, amending §333); a save of the page or
 * its cards expires it through the rows' own tag, and a day is the ceiling. A literal, as Next
 * requires: it equals `PUBLIC_PAGE_CEILING_SECONDS` (a test holds them together).
 */
export const revalidate = 86400;

/** The card's smaller type on a phone, where two cards share a row. */
const SMALL_TEXT = { xs: "0.8125rem", sm: "0.875rem" } as const;

/**
 * The words about a person (§474) drawn by the page's own renderer, at the card's size: the
 * paragraphs and lists in the card's small type, a heading one step above it, and every picture a
 * band across the card — a floated third of a column two to a row would be a thumbnail, so the
 * chosen width and side are overridden one class more specifically, as the listing card does (§417).
 */
const BIO_SX = {
  color: "text.secondary",
  overflowWrap: "anywhere",
  "& p, & li": { fontSize: SMALL_TEXT, lineHeight: 1.45 },
  "& p": { mb: 1 },
  "& p:last-child": { mb: 0 },
  "& h2, & h3": { fontSize: { xs: "0.875rem", sm: "0.9375rem" }, mt: 1.5, mb: 0.5 },
  "& ul, & ol": { pl: 2.5, mb: 1 },
  "& figure": { width: "100%", my: 1, float: "none", marginLeft: "auto", marginRight: "auto" },
  "& figcaption": { textAlign: "center" },
} as const;

/** The club's introduction (§474): the page's lead, in the renderer's own type, a little quieter. */
const INTRO_SX = { color: "text.secondary", mb: { xs: DENSITY.sectionGap, sm: 3 }, "& > :last-child": { mb: 0 } } as const;

/** A chart card's width (§NNN): the whole column on a phone, a fixed column from `sm`, so a tier wraps evenly. */
const CHART_CARD_WIDTH = { xs: "100%", sm: 240, md: 264 } as const;

/** The connectors' line: the theme's hairline, two pixels, never a hex of its own (§NNN). */
const LINE = 2;
const LINE_COLOR = "divider";
/** The stem's height between a card and the tier under it, in pixels. */
const STEM = 20;

/**
 * The page's state and cards, or null when the database cannot say. A DRAFT page is a 404, as an
 * unpublished standing page is; a page the database cannot answer for stands with a sentence where
 * the cards would be — the contact page's rule for a read that may not answer (§281).
 */
async function teamOrNull(locale: Locale): Promise<PublicTeamPage | null> {
  try {
    return await cachedTeamPage(locale);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[team] the page did not answer; it stands without its cards", error);
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Team" });
  const page = await teamOrNull(locale);
  return {
    title: t("title"),
    // About 160 characters of the introduction, never the whole of it (§483).
    description: page?.introText ? teamMetaDescription(page.introText) : t("lead", { club: CLUB_NAME }),
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/team")),
    // An address with nobody on it is not for a search engine; the sitemap leaves it out too.
    ...(page && teamPageOnSite(page) ? {} : { robots: { index: false, follow: true } }),
  };
}

/** What every card needs besides the person: the catalogue's words, once. */
type CardWords = {
  linksLabel: (name: string) => string;
  /** The chart's two lists (§NNN): the cards beside this one, and the cards that answer to it. */
  besideLabel: (name: string) => string;
  reportsLabel: (name: string) => string;
  responsibilities: string;
  kinds: Record<TeamLinkKind, string>;
};

/** A tier of the chart: a row of cards that wraps, centred, from `sm`; one column on a phone. */
const TIER_SX = {
  display: "flex",
  flexDirection: { xs: "column", sm: "row" },
  flexWrap: "wrap",
  justifyContent: "center",
  alignItems: { xs: "stretch", sm: "flex-start" },
  gap: { xs: DENSITY.cardGridGap, sm: 2 },
} as const;

/**
 * «Echipa» / "The team" (§459): the people who run the club, one card each — a photograph, the
 * name, what they do, the words about them in the editor every page uses, and their links (§474).
 *
 * A platform page, like the contact form: its address and title are the platform's. The club keeps
 * the cards, the page's switch and, if it wants one, its own introduction in both languages, in
 * `/admin/pages/team` — without one the page reads the catalogue's sentence. A DRAFT page is a 404.
 * Each card reads the page's own language alone — a pair written in one language only reads as
 * none on both pages (§352). A Server Component with no island of its own; a film in a text brings the renderer's (§403).
 *
 * Since §NNN the cards may say whom they answer to. While no shown card names a shown parent the
 * page is the grid it always was; otherwise it is the organisational chart the club's president
 * drew — tier by tier, each parent's children grouped under it, connectors in CSS and no script —
 * and under it the page's boxes, the club's titled texts in the editor every page uses.
 */
export default async function TeamPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Team");
  const page = await teamOrNull(locale);
  if (page && !page.published) notFound();
  const members = page?.members ?? [];
  const boxes = page?.boxes ?? [];
  const words: CardWords = {
    linksLabel: (name) => t("linksLabel", { name }),
    besideLabel: (name) => t("besideLabel", { name }),
    reportsLabel: (name) => t("reportsLabel", { name }),
    responsibilities: t("responsibilities"),
    kinds: await teamLinkKindWords(),
  };
  const chart = buildOrgChart(members);

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("title")}
      </Typography>
      {page?.intro ? (
        // The club's own introduction, written in the editor every page uses (§474).
        <Box sx={INTRO_SX} data-testid="team-intro">
          <RichText body={page.intro} />
        </Box>
      ) : (
        <Typography variant="body1" color="text.secondary" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }}>
          {t("lead", { club: CLUB_NAME })}
        </Typography>
      )}

      {members.length === 0 ? (
        <Typography variant="body1">{t("empty")}</Typography>
      ) : chart.hasRelations ? (
        // The organisational chart (§NNN): the roots' tier, and under each card the cards that answer to it.
        <Box
          component="ul"
          aria-label={t("listLabel")}
          data-testid="team-chart"
          sx={{ ...TIER_SX, listStyle: "none", m: 0, p: 0 }}
        >
          {chart.roots.map((node, index) => (
            <ChartNode key={node.card.id} node={node} index={index} words={words} />
          ))}
        </Box>
      ) : (
        <Box
          component="ul"
          aria-label={t("listLabel")}
          data-testid="team-grid"
          sx={{
            listStyle: "none",
            m: 0,
            p: 0,
            display: "grid",
            // Two to a row on a phone from 320px, three from `sm`, four from `md` — the album
            // grid's columns, so `sizes` is the `tile` column's.
            gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
            gap: { xs: DENSITY.cardGridGap, sm: 2 },
          }}
        >
          {members.map((member, index) => (
            <TeamCard key={member.id} member={member} index={index} words={words} column="tile" component="li" />
          ))}
        </Box>
      )}

      {boxes.length > 0 && (
        // The page's boxes (§NNN): the club's titled texts under the chart, in its order.
        <Box component="section" aria-label={t("boxesLabel")} data-testid="team-boxes" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 }, display: "grid", gap: 2 }}>
          {boxes.map((box, index) => (
            <TeamBox key={box.id} box={box} index={index} />
          ))}
        </Box>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 } }}>
        {t.rich("contact", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
      </Typography>
      {/* «Echipa» is an «about» page: the club's legal name and CIF at its end (§565). */}
      <ClubIdentity shape="line" />
    </Container>
  );
}

/**
 * One node of the chart (§NNN): the card, the cards that sit beside it at its own tier to its
 * right, and under the group the tier of cards that answer to it. The connectors are CSS alone,
 * on Server Components: a stem under the group, a rule across the children's tier, and a stem
 * down to each child; on a phone, one column, the children indented behind a left rule with a
 * short tick to each. The lines are the theme's hairline (`divider`), never a hex.
 */
function ChartNode({ node, index, words }: { node: OrgChartNode<PublicTeamMember>; index: number; words: CardWords }) {
  const hasChildren = node.children.length > 0;
  return (
    <Box component="li" data-testid="team-chart-node" sx={{ display: "flex", flexDirection: "column", alignItems: { xs: "stretch", sm: "center" }, maxWidth: "100%" }}>
      <Box sx={{ ...TIER_SX, alignItems: { xs: "stretch", sm: "stretch" } }} data-testid="team-chart-group">
        <TeamCard member={node.card} index={index} words={words} column="card" sx={{ width: CHART_CARD_WIDTH }} />
        {node.beside.length > 0 && (
          // The cards at this card's tier to its right — the president's advisor — each with its own cards under it.
          <Box component="ul" aria-label={words.besideLabel(node.card.name)} data-testid="team-chart-beside" sx={{ ...TIER_SX, listStyle: "none", m: 0, p: 0 }}>
            {node.beside.map((side, sideIndex) => (
              <ChartNode key={side.card.id} node={side} index={index + sideIndex + 1} words={words} />
            ))}
          </Box>
        )}
      </Box>
      {hasChildren && (
        <>
          {/* The stem from the group down to the tier under it (from `sm`; the phone's column has its left rule). */}
          <Box aria-hidden sx={{ display: { xs: "none", sm: "block" }, width: 0, height: STEM, borderLeft: LINE, borderColor: LINE_COLOR }} />
          <Box
            component="ul"
            aria-label={words.reportsLabel(node.card.name)}
            data-testid="team-chart-children"
            sx={{
              ...TIER_SX,
              listStyle: "none",
              m: 0,
              p: 0,
              position: "relative",
              // The phone: the children one under the other, indented behind a left rule — on the
              // density scale (§380), zero from `sm` where the connectors take over.
              mt: { xs: DENSITY.gapSm, sm: 0 },
              ml: { xs: DENSITY.cardPadTop, sm: 0 },
              pl: { xs: DENSITY.sectionGap, sm: 0 },
              borderLeft: { xs: LINE, sm: 0 },
              borderColor: LINE_COLOR,
              "& > li": { position: "relative", pt: { sm: `${STEM}px` } },
              // From `sm`: a stem down to each child; on the phone, a short tick from the left rule to it.
              "& > li::before": {
                content: '""',
                position: "absolute",
                top: { xs: 24, sm: 0 },
                left: { xs: -16, sm: "50%" },
                width: { xs: 12, sm: 0 },
                height: { xs: 0, sm: STEM },
                borderLeft: { xs: 0, sm: LINE },
                borderTop: { xs: LINE, sm: 0 },
                borderColor: LINE_COLOR,
              },
              // From `sm`: the rule across the tier, from the first child's stem to the last one's.
              "& > li::after": {
                content: '""',
                position: "absolute",
                top: 0,
                left: -8,
                right: -8,
                borderTop: LINE,
                borderColor: LINE_COLOR,
                display: { xs: "none", sm: "block" },
              },
              "& > li:first-of-type::after": { left: "50%" },
              "& > li:last-of-type::after": { right: "50%" },
              "& > li:only-of-type::after": { display: "none" },
            }}
          >
            {node.children.map((child, childIndex) => (
              <ChartNode key={child.card.id} node={child} index={index + childIndex + 1} words={words} />
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}

/**
 * One person's card, the same in the grid and in the chart: the photograph in the crop the club
 * drew (§541), the name, the role title in the accent colour, the sub-role line, «Responsabilități»
 * as bullets (§NNN), then the words about them and their links (§474).
 */
function TeamCard({
  member,
  index,
  words,
  column,
  component = "div",
  sx,
}: {
  member: PublicTeamMember;
  index: number;
  words: CardWords;
  column: PictureColumn;
  component?: "li" | "div";
  sx?: Record<string, unknown>;
}) {
  const hasMore = member.bio !== null || member.links.length > 0 || member.responsibilities.length > 0 || member.subtitle !== null;
  return (
    <Card component={component} variant="outlined" data-testid="team-card" sx={{ ...riseIn(index), position: "relative", ...sx }}>
      {member.photo && (
        // Our own WebP ladder, sized on upload (§414), in the crop the club drew — or, with
        // none, the square it always was (§541). The name is right under it: `alt` is empty.
        <TeamPhotoImage
          src={member.photo.thumbUrl}
          {...photoWidths(member.photo, column)}
          photo={member.photo}
          loading={index < 4 ? "eager" : "lazy"}
          testId="team-photo"
        />
      )}
      <CardContent sx={{ p: { xs: DENSITY.cardPadTop, sm: 2 }, "&:last-child": { pb: { xs: DENSITY.cardPadTop, sm: 3 } } }}>
        <Typography variant="h2" sx={{ fontSize: { xs: "1rem", sm: "1.25rem" }, mb: 0.25, overflowWrap: "anywhere" }}>
          {member.name}
        </Typography>
        {member.role && (
          <Typography variant="body2" color="primary" sx={{ fontWeight: 600, mb: hasMore ? 0.5 : 0, fontSize: SMALL_TEXT }}>
            {member.role}
          </Typography>
        )}
        {member.subtitle && (
          <Typography variant="body2" color="text.secondary" data-testid="team-subtitle" sx={{ mb: 1, fontSize: SMALL_TEXT, overflowWrap: "anywhere" }}>
            {member.subtitle}
          </Typography>
        )}
        {member.responsibilities.length > 0 && (
          <Box data-testid="team-responsibilities" sx={{ mb: member.bio || member.links.length > 0 ? 1 : 0 }}>
            <Typography component="h3" variant="subtitle2" sx={{ fontSize: SMALL_TEXT, fontWeight: 700, mt: 0.5 }}>
              {words.responsibilities}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5, color: "text.secondary", "& li": { fontSize: SMALL_TEXT, lineHeight: 1.45, overflowWrap: "anywhere" } }}>
              {member.responsibilities.map((line, lineIndex) => (
                <li key={lineIndex}>{line}</li>
              ))}
            </Box>
          </Box>
        )}
        {member.bio && (
          // Through the renderer's allowlist, never markup the club did not type (§11.3).
          <Box sx={BIO_SX} data-testid="team-bio">
            <RichText body={member.bio} pictures="tile" />
          </Box>
        )}
        {member.links.length > 0 && <MemberLinks links={member.links} label={words.linksLabel(member.name)} kindWords={words.kinds} />}
      </CardContent>
    </Card>
  );
}

/** One box under the chart (§NNN): its heading and the club's text through the page's renderer. */
function TeamBox({ box, index }: { box: PublicTeamBox; index: number }) {
  return (
    <Card component="article" variant="outlined" data-testid="team-box" sx={riseIn(index)}>
      <CardContent sx={{ p: { xs: DENSITY.cardPadTop, sm: 2 }, "&:last-child": { pb: { xs: DENSITY.cardPadTop, sm: 3 } } }}>
        <Typography variant="h2" sx={{ fontSize: { xs: "1.125rem", sm: "1.375rem" }, mb: 1, overflowWrap: "anywhere" }}>
          {box.title}
        </Typography>
        <Box sx={{ "& > :last-child": { mb: 0 }, overflowWrap: "anywhere" }}>
          <RichText body={box.body} />
        </Box>
      </CardContent>
    </Card>
  );
}

/**
 * A person's links (§474), one row each in the club's order: the network's mark (§90), the club's
 * label in this language — or, without one, the network's name, and for a site or anything else
 * its host ("ana-alearga.ro"), so nobody is surprised by what opens. Every row is at least 44
 * pixels tall (BR-REQ-041-01 criterion 6) and opens in a new tab with no referrer: the address is
 * whatever the club pasted, checked `https://` at the save.
 */
function MemberLinks({ links, label, kindWords: words }: { links: readonly PublicTeamLink[]; label: string; kindWords: Record<TeamLinkKind, string> }) {
  return (
    // `role="list"` restated for WebKit, which drops it from a list with no markers (§169).
    <Box component="ul" role="list" aria-label={label} data-testid="team-links" sx={{ listStyle: "none", m: 0, mt: 0.5, p: 0 }}>
      {links.map((link, index) => (
        <Box component="li" role="listitem" key={index}>
          <MuiLink
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            data-link-kind={link.kind}
            sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 44, overflowWrap: "anywhere", fontSize: SMALL_TEXT }}
          >
            <TeamLinkGlyph kind={link.kind} size={18} />
            <Box component="span" sx={{ minWidth: 0 }}>
              {link.label ?? (link.kind === "WEBSITE" || link.kind === "OTHER" ? teamLinkHost(link.url) : words[link.kind])}
            </Box>
          </MuiLink>
        </Box>
      ))}
    </Box>
  );
}

/**
 * The photo's `srcset` and `sizes` (§414), or neither: a card is a column of the grid — the album
 * grid's `tile` widths, two, three and four to a row — or, in the chart, a listing card's column
 * (`card`, §NNN) — and the photograph is drawn wider than its card by what the frame magnifies: the
 * crop's `1 / w`, or a square's cover (`teamPhotoFrame`, §541). A picture from before the ladder
 * keeps its thumbnail.
 */
function photoWidths(photo: NonNullable<PublicTeamMember["photo"]>, column: PictureColumn): { srcSet?: string; sizes?: string } {
  const srcSet = pictureSrcSet(photo.webUrl, photo.width);
  if (!srcSet) return {};
  return { srcSet, sizes: pictureSizes(column, 100, teamPhotoFrame(photo).magnify) };
}
