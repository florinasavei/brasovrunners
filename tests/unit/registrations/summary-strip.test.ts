import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RegistrationStatus } from "@/db/schema/registrations";
import SummaryStrip from "@/modules/registrations/ui/SummaryStrip";

/**
 * BR-REQ-041-01, `DECISIONS.md` §NNN — the registrations list's summary strip, rendered the way
 * the server sends it: every pill an anchor with the whole filter in its address, the state in
 * force drawn pressed, the counts blind to which one that is (§246).
 */
const BASE = "/ro/admin/registrations";
const STATUSES: RegistrationStatus[] = [
  "PENDING_EMAIL_CONFIRMATION",
  "PENDING_DECLARATION",
  "WAITLISTED",
  "WAITLIST_OFFERED",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
];
const LABEL: Record<RegistrationStatus, string> = {
  PENDING_EMAIL_CONFIRMATION: "Așteaptă emailul",
  PENDING_DECLARATION: "Așteaptă declarația",
  WAITLISTED: "Pe lista de așteptare",
  WAITLIST_OFFERED: "Ofertă activă",
  CONFIRMED: "Confirmată",
  CANCELLED: "Anulată",
  EXPIRED: "Expirată",
};
const SUMMARY = { real: 168, byStatus: { CONFIRMED: 133, WAITLISTED: 10, PENDING_EMAIL_CONFIRMATION: 9, CANCELLED: 16 }, test: 2 };

function render(active: RegistrationStatus | null, query: Record<string, string | undefined> = { eventId: "e1" }): string {
  // Emotion prints each rule beside its element; the styles are not what is asserted.
  return renderToStaticMarkup(
    createElement(SummaryStrip, {
      basePath: BASE,
      query: { ...query, ...(active ? { status: active } : {}) },
      active,
      statuses: STATUSES,
      summary: SUMMARY,
      totalLabel: "Înscrieri: 168",
      testLabel: "De test: 2",
      statusLabel: LABEL,
    }),
  ).replace(/<style\b[\s\S]*?<\/style>/g, "");
}

/** Each anchor's address (entities decoded), its text and whether it is the current one. */
function anchors(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    href: /href="([^"]*)"/.exec(match[1])?.[1].replace(/&amp;/g, "&"),
    current: /aria-current="page"/.test(match[1]),
    text: match[2].replace(/<[^>]*>/g, ""),
    pressed: /MuiChip-filled/.test(match[2]),
  }));
}

describe("§NNN the summary's pills are filters", () => {
  it("draws the total and each state with somebody in it as an anchor, the test rows as a plain label", () => {
    const html = render(null);
    expect(anchors(html).map((a) => a.text)).toEqual([
      "Înscrieri: 168",
      "Așteaptă emailul: 9",
      "Pe lista de așteptare: 10",
      "Confirmată: 133",
      "Anulată: 16",
    ]);
    expect(html).toContain("De test: 2");
    expect(anchors(html).map((a) => a.text)).not.toContain("De test: 2");
  });

  it("each state's anchor sets that state in the address and keeps the event", () => {
    const byText = Object.fromEntries(anchors(render(null)).map((a) => [a.text, a.href]));
    expect(byText["Confirmată: 133"]).toBe(`${BASE}?eventId=e1&status=CONFIRMED`);
    expect(byText["Pe lista de așteptare: 10"]).toBe(`${BASE}?eventId=e1&status=WAITLISTED`);
    expect(byText["Înscrieri: 168"]).toBe(`${BASE}?eventId=e1`);
  });

  it("with no state in force the total is the pressed one", () => {
    const list = anchors(render(null));
    expect(list.filter((a) => a.pressed).map((a) => a.text)).toEqual(["Înscrieri: 168"]);
    expect(list.filter((a) => a.current).map((a) => a.text)).toEqual(["Înscrieri: 168"]);
  });

  it("the state in force is the pressed one, and its anchor takes the state off", () => {
    const list = anchors(render("WAITLISTED"));
    expect(list.filter((a) => a.pressed).map((a) => a.text)).toEqual(["Pe lista de așteptare: 10"]);
    expect(list.filter((a) => a.current).map((a) => a.text)).toEqual(["Pe lista de așteptare: 10"]);
    const byText = Object.fromEntries(list.map((a) => [a.text, a.href]));
    expect(byText["Pe lista de așteptare: 10"]).toBe(`${BASE}?eventId=e1`);
    // The others switch to their own state, and the total clears it.
    expect(byText["Confirmată: 133"]).toBe(`${BASE}?eventId=e1&status=CONFIRMED`);
    expect(byText["Înscrieri: 168"]).toBe(`${BASE}?eventId=e1`);
  });

  it("the counts are the same whichever state is pressed (§246)", () => {
    const texts = (active: RegistrationStatus | null) => anchors(render(active)).map((a) => a.text);
    expect(texts("CONFIRMED")).toEqual(texts(null));
    expect(texts("WAITLISTED")).toEqual(texts(null));
  });

  it("a state in force that nobody is in is still drawn, so it can be pressed off", () => {
    const list = anchors(render("EXPIRED"));
    const expired = list.find((a) => a.text === "Expirată: 0");
    expect(expired?.pressed).toBe(true);
    expect(expired?.href).toBe(`${BASE}?eventId=e1`);
  });

  it("is plain server markup: no script, no button, only links", () => {
    const html = render("CONFIRMED");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<button");
    expect(html).not.toContain('role="button"');
  });
});
