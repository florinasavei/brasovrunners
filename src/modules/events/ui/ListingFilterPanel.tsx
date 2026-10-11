import CheckIcon from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
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
  offersAnything,
  scopedName,
  SPECIAL_TYPE,
  withoutValue,
  type FilterFlag,
  type FilterGroup,
  type FilterOffer,
  type FilterScope,
  type ListingFilter,
} from "@/modules/events/domain/listing-filter";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import ChipLink from "@/shared/ui/ChipLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { UNDER_LOOK } from "@/theme/look";
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
 * (`/ro/calendar/2026-10`, §574), not in the query.
 *
 * **Two on the listing, one address** (§611, amending §602 — the owner: «Am zis că vreau un filtru și
 * la evenimentele trecute, la fel ca la cele curente»). `scope` says whose state this panel is: the
 * cards ahead (`upcoming`, the names §413 gave them, the calendar's only panel) or the past section
 * (`past`, the same boxes named `past-type`, `past-partner`, …), which renders it inside its fold.
 * `carry` is the OTHER scope's ticks, kept as hidden inputs in this form and in every link here, so a
 * tick in one panel — submitted natively or by `FilterAutoApply`, which reads the form's own fields —
 * never drops the other's.
 *
 * **Under «Aspectul nou», a group may move to the chips** (the facelift's phase 4): `lookChips`
 * names the groups the calendar's always-visible chips carry (`KindChips`: the surface). Under the
 * look only, those groups' boxes and their active chips are hidden here and the button counts the
 * rest; the boxes stay in the form, ticked as the address says, so a submit — native or the
 * island's — keeps them. Off, and on the listing, which passes none, nothing changes.
 */
export default async function ListingFilterPanel({
  locale,
  pathname,
  path,
  filter,
  offer,
  keep = {},
  scope = "upcoming",
  carry = {},
  shared = [],
  lookChips = [],
  lookChipValues = [],
}: {
  locale: Locale;
  pathname: "/events" | "/calendar";
  path?: string;
  filter: ListingFilter;
  offer: FilterOffer;
  keep?: Record<string, string>;
  scope?: FilterScope;
  carry?: Record<string, string | string[]>;
  /** The past scope's window when nothing narrows it: the value each group has in common, for the sentence in the fold. */
  shared?: { group: FilterGroup; value: string }[];
  /** The groups the calendar's chips carry under the new look (`KindChips`), hidden here under it. */
  lookChips?: readonly FilterGroup[];
  /** Single values the chips carry under the look (`LOOK_HIDDEN_VALUES`): their box and active chip are hidden there, the input stays. */
  lookChipValues?: readonly { group: FilterGroup; value: string }[];
}) {
  const t = await getTranslations("Events");
  const formatter = await getFormatter();
  const tEvent = await getTranslations("Event");
  const count = activeFilterCount(filter);
  const past = scope === "past";
  const action = path ?? getPathname({ locale, href: pathname });
  const hrefFor = (next: ListingFilter) => {
    // The other scope's ticks before this one's, in the order the form's hidden inputs submit them.
    const query = { ...keep, ...carry, ...listingFilterQuery(next, scope) };
    if (Object.keys(query).length === 0) return action;
    if (path === undefined) return getPathname({ locale, href: { pathname, query } });
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) for (const one of Array.isArray(value) ? value : [value]) search.append(name, one);
    return `${path}?${search.toString()}`;
  };

  const label = (group: FilterGroup | FilterFlag, value: string): string => {
    switch (group) {
      case "type":
        // «Eveniment special» is the kind's own word (§709's photo tag), not a type's (§NNN).
        return value === SPECIAL_TYPE ? tEvent("kind.special") : tEvent(`type.${value}`);
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
      case "type":
        // The calendar's «Evenimente speciale» chip's sparkle (`KindChips`), so one kind wears one glyph.
        return value === SPECIAL_TYPE ? "special" : (`type:${value}` as GlyphName);
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

  // Under the look, what the chips do not carry: the button's count, and whether the active row has anything left to say.
  const onChips = (group: FilterGroup | FilterFlag, value?: string) =>
    (lookChips as readonly string[]).includes(group) || lookChipValues.some((one) => one.group === group && one.value === value);
  const panelCount = ticked.filter(({ group, value }) => !onChips(group, value)).length;
  const countWords = (n: number) => (n > 0 ? t("filter.buttonCount", { count: n }) : t("filter.button"));

  const option = (group: FilterGroup | FilterFlag, value: string, checked: boolean) => {
    const Icon = GLYPHS[glyph(group, value)];
    // A band's gauge names the levels it ticks on hover (§528): «Greuț: nivelurile 7–9 din 15». A
    // native `title`, not MUI's `Tooltip`, so the panel stays a Server Component that works without
    // a script; the band's word is what a screen reader hears, as before.
    const title = group === "difficulty" && isDifficultyBand(value) ? bandTitle(value) : undefined;
    return (
      <Box component="label" key={`${group}=${value}`} sx={onChips(group, value) ? { ...FILTER_OPTION_SX, [UNDER_LOOK]: { display: "none" } } : FILTER_OPTION_SX} title={title}>
        <span>
          <input type="checkbox" name={scopedName(group, scope)} value={value} defaultChecked={checked} />
          <Icon aria-hidden="true" />
          {label(group, value)}
        </span>
      </Box>
    );
  };

  // Nothing to narrow in the past window and nothing ticked: the fold says so in a sentence instead
  // of drawing a form of no boxes (§611). The button keeps its words and still opens the fold.
  const nothingToNarrow = past && count === 0 && !offersAnything(offer);

  return (
    <Box sx={{ "& > details[open] + [data-active-filters]": { display: "none" } }}>
      <Box component="details" data-testid={past ? "past-filters" : "listing-filters"} data-filter-scope={scope} sx={{ "&[open] > summary .filters-caret": { transform: "rotate(180deg)" } }}>
        <Box component="summary" sx={FILTER_BUTTON_SX}>
          <span>
            <GLYPHS.filters aria-hidden="true" />
            {panelCount === count ? (
              countWords(count)
            ) : (
              <>
                <Box component="span" sx={{ [UNDER_LOOK]: { display: "none" } }}>
                  {countWords(count)}
                </Box>
                <Box component="span" sx={{ display: "none", [UNDER_LOOK]: { display: "inline" } }}>
                  {countWords(panelCount)}
                </Box>
              </>
            )}
            <ExpandMoreIcon className="filters-caret" aria-hidden="true" sx={{ transition: "transform 120ms" }} />
          </span>
        </Box>
        {nothingToNarrow ? (
          <Typography data-testid="past-filters-nothing" sx={{ mt: 1 }}>
            {t("filter.pastNothingToNarrow", { values: formatter.list(shared.map(({ group, value }) => label(group, value))) })}
          </Typography>
        ) : (
        <Box
          component="form"
          method="get"
          action={action}
          aria-label={past ? t("filter.labelPast") : t("filter.label")}
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
          {Object.entries(carry).flatMap(([name, value]) =>
            (Array.isArray(value) ? value : [value]).map((one) => <input key={`${name}=${one}`} type="hidden" name={name} value={one} />),
          )}
          {offer.groups.map(({ group, values }) => (
            <Box component="fieldset" key={group} data-filter-group={group} sx={values.every((value) => onChips(group, value)) ? { ...FIELDSET_SX, [UNDER_LOOK]: { display: "none" } } : FIELDSET_SX}>
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
          <FilterAutoApply scope={scope} ticked={ticked.map(({ group, value }) => `${scopedName(group, scope)}=${value}`)} />
        </Box>
        )}
      </Box>
      {count > 0 && (
        <Stack
          direction="row"
          data-active-filters="true"
          data-testid={past ? "past-active-filters" : "active-filters"}
          role="group"
          aria-label={past ? t("filter.activePast") : t("filter.active")}
          sx={{ flexWrap: "wrap", columnGap: 0.5, alignItems: "center", ...(panelCount === 0 ? { [UNDER_LOOK]: { display: "none" } } : {}) }}
        >
          {ticked.map(({ group, value }) => {
            const chip = (
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
            );
            // A tick the chips carry under the look is said there, not twice.
            return onChips(group, value) ? (
              <Box component="span" key={`${group}=${value}`} sx={{ display: "contents", [UNDER_LOOK]: { display: "none" } }}>
                {chip}
              </Box>
            ) : (
              chip
            );
          })}
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
