import CheckIcon from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  DIFFICULTY_BANDS,
  DIFFICULTY_LEVEL_COUNT,
  difficultyBandLevels,
  difficultyBandRangeWord,
  type DifficultyBand,
} from "@/modules/events/domain/difficulty";
import {
  activeFilterCount,
  FILTER_FLAGS,
  FILTER_GROUPS,
  listingFilterQuery,
  NO_FILTER,
  withoutValue,
  type FilterFlag,
  type FilterGroup,
  type FilterOffer,
  type ListingFilter,
} from "@/modules/events/domain/listing-filter";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import ChipLink from "@/shared/ui/ChipLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import FilterAutoApply from "./FilterAutoApply";
import { FILTER_BUTTON_SX, FILTER_OPTION_SX } from "./filter-chip-sx";
import { GLYPHS, type GlyphName } from "./glyphs";

/**
 * The listing's filters: one "Filtre" button, closed by default, and checkbox pills under it (§413,
 * amending §133 and §401 — the owner, 2026-09-25: "un buton de filtre, collapsed by default,
 * checkboxuri pe pill-uri și mai multe filtre").
 *
 * **No script needed.** A native `<details>` holds a GET `<form>` whose boxes are named after the
 * address's own parameters, so ticking and pressing «Aplică» loads exactly the address a
 * link would carry, and the page renders it on the server like any other. `FilterAutoApply`, the one
 * island, only makes each tick apply at once and hides the button it made redundant.
 *
 * **Closed, it still says what is in force.** The button counts the ticks — "Filtre (2)" — and while
 * the fold is shut a row of the ticked values follows it, each a link that removes itself (a drawn ✕,
 * the link named "Scoate filtrul: Cursă"), with "Șterge filtrele" at the end. Open, the row hides: the
 * boxes say the same thing.
 *
 * **A pill is a label.** Each option is a `<label>` 44 pixels tall (BR-REQ-041-01 criterion 6) around a
 * small pill (MUI's small chip, 24 pixels — §424) that holds a real checkbox, the value's glyph (§112,
 * drawn here — nothing crosses into a client component but a name or a string) and its word; a ticked
 * pill fills in the brand colour through `:has(input:checked)`, so it changes the instant the box
 * does, script or not.
 *
 * **The button is a chip too** (§424 — the owner, 2026-09-26: "Butonul de filtre e mult prea mare"): the
 * `<summary>` is the 44-pixel target, the outlined pill inside it the active-filter chips' own size.
 *
 * `keep` is what the address carries that is not a filter — the listing's list layout — so neither
 * the form nor a chip's link drops it. `path`, when given, is the already-resolved address the form
 * and the chips go to instead of `pathname`'s: the calendar's period, which lives in the path
 * (`/ro/calendar/2026-10`, §NNN), not in the query.
 */
export default async function ListingFilterPanel({
  locale,
  pathname,
  path,
  filter,
  offer,
  keep = {},
}: {
  locale: Locale;
  pathname: "/events" | "/calendar";
  path?: string;
  filter: ListingFilter;
  offer: FilterOffer;
  keep?: Record<string, string>;
}) {
  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  const count = activeFilterCount(filter);
  const action = path ?? getPathname({ locale, href: pathname });
  const hrefFor = (next: ListingFilter) => {
    const query = { ...keep, ...listingFilterQuery(next) };
    if (Object.keys(query).length === 0) return action;
    if (path === undefined) return getPathname({ locale, href: { pathname, query } });
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) for (const one of Array.isArray(value) ? value : [value]) search.append(name, one);
    return `${path}?${search.toString()}`;
  };

  const label = (group: FilterGroup | FilterFlag, value: string): string => {
    switch (group) {
      case "type":
        return tEvent(`type.${value}`);
      case "surface":
        return tEvent(`surface.${value}`);
      case "difficulty":
        // The band with the levels it ticks (§563): «Mediu (4–6)».
        return isDifficultyBand(value) ? difficultyBandRangeWord(value, tEvent) : tEvent(`difficultyValues.${value}`);
      case "distance":
        return t(`filter.distance.${value}`);
      case "cost":
        return tEvent(`costValues.${value}`);
      case "partner":
        return t("filter.partner");
      case "night":
        return t("filter.night");
      case "registration":
        return t("filter.registration");
    }
  };
  const glyph = (group: FilterGroup | FilterFlag, value: string): GlyphName => {
    switch (group) {
      case "distance":
        return "distance";
      case "partner":
        return "partner";
      case "night":
        return "night";
      case "registration":
        return "registration";
      default:
        return `${group}:${value}` as GlyphName;
    }
  };

  const bandTitle = (band: DifficultyBand): string =>
    tEvent("difficultyBandTitle", { band: tEvent(`difficultyValues.${band}`), ...difficultyBandLevels(band), levels: DIFFICULTY_LEVEL_COUNT });

  // What the address ticks, in the panel's own order: the active chips, and the island's state.
  const ticked: { group: FilterGroup | FilterFlag; value: string }[] = [
    ...FILTER_GROUPS.flatMap((group) => (filter[group] as string[]).map((value) => ({ group, value }))),
    ...FILTER_FLAGS.filter((flag) => filter[flag]).map((flag) => ({ group: flag, value: "1" })),
  ];

  const option = (group: FilterGroup | FilterFlag, value: string, checked: boolean) => {
    const Icon = GLYPHS[glyph(group, value)];
    // A band's gauge names the levels it ticks on hover (§528): «Greuț: nivelurile 7–9 din 15». A
    // native `title`, not MUI's `Tooltip`, so the panel stays a Server Component that works without
    // a script; the band's word is what a screen reader hears, as before.
    const title = group === "difficulty" && isDifficultyBand(value) ? bandTitle(value) : undefined;
    return (
      <Box component="label" key={`${group}=${value}`} sx={FILTER_OPTION_SX} title={title}>
        <span>
          <input type="checkbox" name={group} value={value} defaultChecked={checked} />
          <Icon aria-hidden="true" />
          {label(group, value)}
        </span>
      </Box>
    );
  };

  return (
    <Box sx={{ "& > details[open] + [data-active-filters]": { display: "none" } }}>
      <Box component="details" data-testid="listing-filters" sx={{ "&[open] > summary .filters-caret": { transform: "rotate(180deg)" } }}>
        <Box component="summary" sx={FILTER_BUTTON_SX}>
          <span>
            <GLYPHS.filters aria-hidden="true" />
            {count > 0 ? t("filter.buttonCount", { count }) : t("filter.button")}
            <ExpandMoreIcon className="filters-caret" aria-hidden="true" sx={{ transition: "transform 120ms" }} />
          </span>
        </Box>
        <Box
          component="form"
          method="get"
          action={action}
          aria-label={t("filter.label")}
          sx={{
            mt: 1,
            // Tighter on a phone (§424, amending §380's scale — the owner: "Butonul de filtre e
            // mult prea mare"): the open panel is a compact block rather than the same box a
            // tablet gets, `p` and `gap` on the density scale like every other public site; one step
            // tighter again in §458 (the owner: "prea mult padding"), gap already on the lowest step.
            p: { xs: DENSITY.gapXs, sm: 1 },
            border: 1,
            borderColor: "divider",
            borderRadius: 2,
            bgcolor: "background.paper",
            display: "grid",
            gap: { xs: DENSITY.gapXs, sm: 0.5 },
            gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
            "&[data-enhanced] [data-apply]": { display: "none" },
          }}
        >
          {Object.entries(keep).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {offer.groups.map(({ group, values }) => (
            <Box component="fieldset" key={group} sx={FIELDSET_SX}>
              <Typography component="legend" variant="subtitle2" sx={{ p: 0 }}>
                {t(`filter.groups.${group}`)}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 0.5 }}>
                {values.map((value) => option(group, value, (filter[group] as string[]).includes(value)))}
              </Box>
            </Box>
          ))}
          {offer.flags.length > 0 && (
            <Box component="fieldset" sx={FIELDSET_SX}>
              <Typography component="legend" variant="subtitle2" sx={{ p: 0 }}>
                {t("filter.groups.more")}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 0.5 }}>
                {offer.flags.map((flag) => option(flag, "1", filter[flag]))}
              </Box>
            </Box>
          )}
          <Stack direction="row" sx={{ gridColumn: "1 / -1", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <Button type="submit" variant="contained" size="small" data-apply="true" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
              <CheckIcon aria-hidden="true" sx={glyphSx("small")} />
              {t("filter.apply")}
            </Button>
            {count > 0 && <ChipLink href={hrefFor(NO_FILTER)} label={t("filter.clear")} keepScroll />}
          </Stack>
          <FilterAutoApply ticked={ticked.map(({ group, value }) => `${group}=${value}`)} />
        </Box>
      </Box>
      {count > 0 && (
        <Stack
          direction="row"
          data-active-filters="true"
          data-testid="active-filters"
          role="group"
          aria-label={t("filter.active")}
          sx={{ flexWrap: "wrap", columnGap: 0.5, alignItems: "center" }}
        >
          {ticked.map(({ group, value }) => (
            <ChipLink
              key={`${group}=${value}`}
              href={hrefFor(withoutValue(filter, group, value))}
              label={label(group, value)}
              glyph={glyph(group, value)}
              active
              closeMark
              keepScroll
              ariaLabel={`${t("filter.remove")}: ${label(group, value)}`}
            />
          ))}
          <ChipLink href={hrefFor(NO_FILTER)} label={t("filter.clear")} keepScroll />
        </Stack>
      )}
    </Box>
  );
}

function isDifficultyBand(value: string): value is DifficultyBand {
  return (DIFFICULTY_BANDS as readonly string[]).includes(value);
}

const FIELDSET_SX = { border: 0, p: 0, m: 0, minWidth: 0 } as const;
