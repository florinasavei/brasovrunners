import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-041-01 — «Eveniment special» under «Tema v2» (`DECISIONS.md` §725, amending §720): the
 * rendered panel and chips, not only the domain helpers. The box and a lone tick's active chip are
 * the kind chips' under the look (`LOOK_HIDDEN_VALUES`, hidden by the look's rule, the input stays
 * in the form); a type group the chips carry whole is hidden whole; a tick the chips do not say
 * (beside another type, or beside a kind) is shown and counted, and no kind chip is lit for it.
 */
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Events" }),
    getFormatter: async () => createFormatter({ locale: "ro", timeZone: "Europe/Bucharest" }),
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode; prefetch?: boolean; scroll?: boolean }) => {
    const { prefetch, scroll, ...attributes } = rest;
    void prefetch;
    void scroll;
    return createElement("a", { href, ...attributes }, children);
  },
}));
vi.mock("@/modules/events/ui/FilterAutoApply", () => ({ default: () => null }));

const { default: ListingFilterPanel } = await import("@/modules/events/ui/ListingFilterPanel");
const { default: KindChips } = await import("@/modules/events/ui/KindChips");
const { LOOK_HIDDEN_VALUES, chipKind, kindChipActive, specialOnChip } = await import("@/modules/events/domain/calendar-kind");
const { NO_FILTER, SPECIAL_TYPE } = await import("@/modules/events/domain/listing-filter");

type Offer = Parameters<typeof ListingFilterPanel>[0]["offer"];
const typeOffer = (values: string[]): Offer => ({ groups: [{ group: "type", values }], flags: [] }) as Offer;

const panel = async (values: string[], types: string[] = [], lookChipTicks = true) =>
  renderToStaticMarkup(
    await ListingFilterPanel({
      locale: "ro",
      pathname: "/calendar",
      filter: { ...NO_FILTER, type: types } as typeof NO_FILTER,
      offer: typeOffer(values),
      lookChipValues: LOOK_HIDDEN_VALUES,
      lookChipTicks,
    }),
  );

/** Whether the element opening with `marker` carries a class whose emitted rule ends in `display:none` under the look. */
const hiddenUnderLook = (html: string, marker: RegExp): boolean => {
  const classes = html.match(marker)?.[0].match(/class="([^"]+)"/)?.[1].split(" ") ?? [];
  const css = [...html.matchAll(/<style[^>]*>([^<]*)<\/style>/g)].map((match) => match[1]).join("");
  return classes.some((name) => new RegExp(`\\.${name}[^{}]*\\{[^}]*display:none`).test(css));
};

describe("the filter's «Tipul» under the look, rendered", () => {
  it("a type group of «Eveniment special» alone: the fieldset is hidden under the look, the checkbox stays in the form", async () => {
    const html = await panel([SPECIAL_TYPE]);
    expect(html).toContain('name="type" value="SPECIAL"');
    expect(hiddenUnderLook(html, /<fieldset[^>]*data-filter-group="type"[^>]*>/)).toBe(true);
  });

  it("beside two types: the fieldset stays, only the special box's label is hidden under the look", async () => {
    const html = await panel(["GROUP_RUN", "RACE", SPECIAL_TYPE]);
    expect(hiddenUnderLook(html, /<fieldset[^>]*data-filter-group="type"[^>]*>/)).toBe(false);
    expect(hiddenUnderLook(html, /<label[^>]*><span><input type="checkbox" name="type" value="SPECIAL"/)).toBe(true);
    expect(hiddenUnderLook(html, /<label[^>]*><span><input type="checkbox" name="type" value="RACE"/)).toBe(false);
  });

  it("a lone tick the chips say: its active chip is hidden under the look and not counted", async () => {
    const html = await panel(["GROUP_RUN", SPECIAL_TYPE], [SPECIAL_TYPE]);
    expect(hiddenUnderLook(html, /<span[^>]*><a[^>]*aria-label="[^"]*Eveniment special"/)).toBe(true);
    // The button reads «Filtre (1)» with the look off and a bare «Filtre» under it.
    expect(html).toContain("Filtre (1)");
    expect(html).toContain(">Filtre</span>");
  });

  it("a tick the chips do not say (`lookChipTicks` off): its active chip is shown under the look and counted", async () => {
    const html = await panel(["GROUP_RUN", "RACE", SPECIAL_TYPE], ["RACE", SPECIAL_TYPE], false);
    expect(html).toContain("Eveniment special");
    expect(hiddenUnderLook(html, /<a[^>]*aria-label="[^"]*Eveniment special"/)).toBe(false);
    // Both ticks count under the look too: one button, no bare «Filtre» alternative.
    expect(html).toContain("Filtre (2)");
    expect(html).not.toContain(">Filtre</span>");
  });
});

describe("KindChips for a ticked «Eveniment special»", () => {
  const chips = async (kind: "weekly" | "special" | null, types: string[]) => {
    const html = renderToStaticMarkup(
      await KindChips({ path: "/ro/calendar/2026-10", kind, filter: { ...NO_FILTER, type: types } as typeof NO_FILTER, surfaces: [] }),
    );
    return [...html.replace(/<style[^>]*>[^<]*<\/style>/g, "").matchAll(/<a [^>]*aria-current="page"[^>]*>(.*?)<\/a>/g)].map((match) => match[1].replace(/<[^>]+>/g, ""));
  };

  it("a lone SPECIAL lights «Evenimente speciale» alone", async () => {
    expect(await chips(null, ["SPECIAL"])).toEqual(["Evenimente speciale"]);
  });

  it("SPECIAL beside another type lights no kind chip, «Toate evenimentele» included", async () => {
    expect(await chips(null, ["RACE", "SPECIAL"])).toEqual([]);
  });

  it("SPECIAL beside a kind in the address lights no kind chip either", async () => {
    expect(await chips("weekly", ["SPECIAL"])).toEqual([]);
  });

  it("nothing ticked: «Toate evenimentele» is lit", async () => {
    expect(await chips(null, [])).toEqual(["Toate evenimentele"]);
  });

  it("the helpers agree", () => {
    const both = { ...NO_FILTER, type: ["RACE", "SPECIAL"] } as typeof NO_FILTER;
    expect(specialOnChip(null, both)).toBe(false);
    expect(chipKind(null, both)).toBeNull();
    expect(kindChipActive(null, null, both)).toBe(false);
    expect(specialOnChip("weekly", { ...NO_FILTER, type: ["SPECIAL"] } as typeof NO_FILTER)).toBe(false);
  });
});
