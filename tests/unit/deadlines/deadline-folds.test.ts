import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §377 (amended) — «Termene» in seven named folds (the owner, 2026-10-18). Rendered to HTML the way
 * the server sends it: the folds are closed, each carries a glyph and a closed line of its values in
 * words (and how many differ from the recommendation), the fifteen boxes are in them, and the one
 * save and the fill button stay under them, outside them. The two settings under the deadlines are
 * cards of their own, folded too, with their own saves.
 */
const lang = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));
// The dialogs' road line (§841) reads the club's roads once per request: no database here.
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const all = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: lang.current, messages: all[lang.current], namespace: namespace as "Admin" }),
    getLocale: async () => lang.current,
  };
});
vi.mock("@/app/[locale]/admin/settings/deadlines/actions", () => ({
  updateDeadlinesAction: async () => null,
  updateAddressCapAction: async () => null,
  updateDeliveryTimingAction: async () => null,
}));

const { default: DeadlinesPanel } = await import("@/modules/deadlines/ui/DeadlinesPanel");
const { DEADLINE_GROUPS, DEADLINE_KEYS, DEFAULT_DEADLINES } = await import("@/modules/deadlines/domain/deadlines");

type Extra = { saved?: string };

async function render(locale: "ro" | "en", deadlines = DEFAULT_DEADLINES, mayEdit = true, extra: Extra = {}): Promise<string> {
  lang.current = locale;
  const html = renderToStaticMarkup(
    (await DeadlinesPanel({
      locale,
      state: { deadlines, updatedAt: null },
      mayEdit,
      addressCap: { cap: { registrationsPerAddress: 4 }, updatedAt: null } as never,
      deliveryTiming: { timing: "scheduled", updatedAt: null } as never,
      scheduledWait: { day: 15, night: 60 },
      ...extra,
    })) as ReactElement,
  );
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

/** The `<details>` of one fold, whole. */
function fold(html: string, testId: string): string {
  const open = html.indexOf(`data-testid="${testId}"`);
  expect(open, testId).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<details", open);
  const end = html.indexOf("</details>", open);
  return html.slice(start, end + "</details>".length);
}

/** A fold's closed line: the text of its summary, tags out. */
function summaryOf(html: string, testId: string): string {
  const card = fold(html, testId);
  const summary = card.slice(card.indexOf("<summary"), card.indexOf("</summary>"));
  return summary.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

describe("§377 «Termene» in seven folds", () => {
  it("draws the seven folds closed, each with a glyph and its title, in the order of the domain's groups", async () => {
    const html = await render("ro");
    const order: number[] = [];
    for (const group of DEADLINE_GROUPS) {
      const card = fold(html, `deadline-group-${group.key}`);
      order.push(html.indexOf(card));
      expect(card.slice(0, card.indexOf(">")), group.key).not.toMatch(/\sopen(=|\s|>)/);
      expect(card, group.key).toMatch(/<summary[\s\S]*?<svg[^>]*aria-hidden="true"[\s\S]*?<\/summary>/);
      expect(summaryOf(html, `deadline-group-${group.key}`), group.key).toContain(ro.Admin.emails.deadlines.groups[group.key].title);
    }
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.match(/data-testid="deadline-group-/g)).toHaveLength(7);
  });

  it("says each fold's values in the house's words on its closed line, in Romanian", async () => {
    const html = await render("ro");
    expect(summaryOf(html, "deadline-group-confirmation")).toContain("link 48 de ore · retrimis după 20 de ore · retrimiteri: o dată");
    expect(summaryOf(html, "deadline-group-hold")).toContain("loc ținut 30 de minute · ofertă 24 de ore");
    expect(summaryOf(html, "deadline-group-beforeStart")).toContain(
      "reminder 2 zile · ultima chemare cu 2 zile înaintea termenului · „Am ajuns” de la o zi înainte · numărătoare inversă o săptămână înainte",
    );
    expect(summaryOf(html, "deadline-group-afterEvent")).toContain("lista publică 30 de zile");
    expect(summaryOf(html, "deadline-group-series")).toContain("datele create cu 8 săptămâni înainte");
    expect(summaryOf(html, "deadline-group-family")).toContain("emailul așteaptă 10 minute");
    expect(summaryOf(html, "deadline-group-outage")).toContain("mutare cel mult 48 de ore");
    // On the recommendation, no fold counts anything.
    expect(html).not.toContain("diferit");
  });

  it("says them in English too", async () => {
    const html = await render("en");
    expect(summaryOf(html, "deadline-group-confirmation")).toContain("link 48 hours · re-sent after 20 hours · re-sends: once");
    expect(summaryOf(html, "deadline-group-hold")).toContain("place held 30 minutes · offer 24 hours");
    expect(summaryOf(html, "deadline-group-beforeStart")).toContain("reminder 2 days · last call 2 days before the deadline · “I have arrived” from one day before · countdown one week before");
    expect(summaryOf(html, "deadline-group-series")).toContain("dates created 8 weeks ahead");
    expect(summaryOf(html, "deadline-group-outage")).toContain("moves by 48 hours at most");
    expect(summaryOf(html, "deadline-group-outage")).toContain(en.Admin.emails.deadlines.groups.outage.title);
  });

  it("counts, on a fold's line, the deadlines off the recommendation — and only that fold's", async () => {
    const html = await render("ro", { ...DEFAULT_DEADLINES, holdMinutes: 60, offerHours: 12, publicListDays: 90 });
    expect(summaryOf(html, "deadline-group-hold")).toContain("loc ținut o oră · ofertă 12 ore · 2 diferite de recomandat");
    expect(summaryOf(html, "deadline-group-afterEvent")).toContain("lista publică 90 de zile · 1 diferit de recomandat");
    expect(summaryOf(html, "deadline-group-confirmation")).not.toContain("diferit");
    expect(summaryOf(html, "deadline-group-beforeStart")).not.toContain("diferit");
    // The chip beside the box still says which one.
    expect(html).toContain('data-testid="deadline-holdMinutes-differs"');
    expect(html).toContain('data-testid="deadline-offerHours-differs"');
    expect(html).not.toContain('data-testid="deadline-reminderHours-differs"');
    const english = await render("en", { ...DEFAULT_DEADLINES, offerHours: 12 });
    expect(summaryOf(english, "deadline-group-hold")).toContain("offer 12 hours · 1 differs from recommended");
  });

  /**
   * §823 — the «Vii?» question's two boxes sit in «Înainte de start» and the fold's closed line says them together: «„Vii?” cu o zi înainte,
   * la 08:00». With zero days the question is not sent, so the hour is not said at all; an hour of zero is midnight, "00:00", never «none».
   */
  it("says the «Vii?» question's days and hour together on the «Înainte de start» line, in both languages", async () => {
    const ro1 = await render("ro");
    expect(summaryOf(ro1, "deadline-group-beforeStart")).toContain("numărătoare inversă o săptămână înainte · „Vii?” cu o zi înainte, la 08:00");
    const en1 = await render("en");
    expect(summaryOf(en1, "deadline-group-beforeStart")).toContain("countdown one week before · “Coming?” one day before, at 08:00");
    const ro3 = await render("ro", { ...DEFAULT_DEADLINES, rsvpAskDaysBefore: 3, rsvpAskHour: 23 });
    expect(summaryOf(ro3, "deadline-group-beforeStart")).toContain("„Vii?” cu 3 zile înainte, la 23:00 · 2 diferite de recomandat");
    const en3 = await render("en", { ...DEFAULT_DEADLINES, rsvpAskDaysBefore: 3, rsvpAskHour: 23 });
    expect(summaryOf(en3, "deadline-group-beforeStart")).toContain("“Coming?” 3 days before, at 23:00 · 2 differ from recommended");
    const midnight = await render("ro", { ...DEFAULT_DEADLINES, rsvpAskHour: 0 });
    expect(summaryOf(midnight, "deadline-group-beforeStart")).toContain("„Vii?” cu o zi înainte, la 00:00 · 1 diferit de recomandat");
  });

  it("says «not sent» for zero days, with no hour, and never «0 zile»", async () => {
    const none = await render("ro", { ...DEFAULT_DEADLINES, rsvpAskDaysBefore: 0, rsvpAskHour: 14 });
    const line = summaryOf(none, "deadline-group-beforeStart");
    expect(line).toContain("„Vii?” nu se trimite");
    expect(line).not.toContain("14:00");
    expect(line).not.toContain("0 zile");
    const english = await render("en", { ...DEFAULT_DEADLINES, rsvpAskDaysBefore: 0 });
    expect(summaryOf(english, "deadline-group-beforeStart")).toContain("“Coming?” is not sent");
  });

  it("gives the two boxes their bounds: days 0 to 7, hour 0 to 23, and the readers' list their values", async () => {
    const html = await render("ro");
    const card = fold(html, "deadline-group-beforeStart");
    expect(card).toMatch(/<input[^>]*name="rsvpAskDaysBefore"[^>]*min="0"[^>]*max="7"|<input[^>]*max="7"[^>]*name="rsvpAskDaysBefore"|<input[^>]*name="rsvpAskDaysBefore"[^>]*max="7"/);
    expect(card).toMatch(/<input[^>]*name="rsvpAskHour"[^>]*max="23"|<input[^>]*max="23"[^>]*name="rsvpAskHour"/);
    const reader = await render("ro", { ...DEFAULT_DEADLINES, rsvpAskDaysBefore: 2, rsvpAskHour: 9 }, false);
    expect(reader).toMatch(/data-testid="deadline-rsvpAskDaysBefore"[^>]*>2</);
    expect(reader).toMatch(/data-testid="deadline-rsvpAskHour"[^>]*>9</);
  });

  it("says «none» and «race day only» in words of their own for a zero", async () => {
    const html = await render("ro", { ...DEFAULT_DEADLINES, reminderHours: 0, lastCallHours: 0, raceWeekDays: 0, verificationRetries: 0, familySittingMinutes: 0, outageGraceMaxHours: 0 });
    expect(summaryOf(html, "deadline-group-beforeStart")).toContain("fără reminder · fără ultimă chemare · „Am ajuns” de la o zi înainte · numărătoare inversă doar în ziua cursei");
    expect(summaryOf(html, "deadline-group-confirmation")).toContain("fără retrimiteri");
    expect(summaryOf(html, "deadline-group-family")).toContain("emailul pleacă imediat");
    expect(summaryOf(html, "deadline-group-outage")).toContain("fără mutare");
    expect(html).not.toContain("0 ore");
  });

  it("holds every box in exactly its fold, and none outside the folds", async () => {
    const html = await render("ro");
    for (const group of DEADLINE_GROUPS) {
      const card = fold(html, `deadline-group-${group.key}`);
      for (const key of group.fields) expect(card, `${group.key}/${key}`).toContain(`name="${key}"`);
      const others = DEADLINE_KEYS.filter((key) => !(group.fields as readonly string[]).includes(key));
      for (const key of others) expect(card, `${group.key}/${key}`).not.toContain(`name="${key}"`);
    }
  });

  it("keeps ONE form, with the save and the fill button under the folds and outside them", async () => {
    const html = await render("ro");
    const form = html.slice(html.indexOf('data-testid="deadlines-form"'));
    const withoutFolds = form.slice(0, form.indexOf("</form>")).replace(/<details[^>]*data-testid="deadline-group-[^"]*"[\s\S]*?<\/details>/g, "");
    expect(withoutFolds).toContain(ro.Admin.emails.deadlines.save);
    expect(withoutFolds).toContain(ro.Admin.emails.deadlines.fillRecommended);
    for (const key of DEADLINE_KEYS) expect(withoutFolds, key).not.toContain(`name="${key}"`);
    // One save for the fifteen: one button of that name in the whole panel.
    expect(html.match(new RegExp(`>${ro.Admin.emails.deadlines.save}<`, "g"))).toHaveLength(1);
    for (const group of DEADLINE_GROUPS) expect(fold(html, `deadline-group-${group.key}`), group.key).not.toContain("<button");
  });

  it("folds the limit per address and «Când pleacă emailurile» as cards of their own, each with its save and its line", async () => {
    const html = await render("ro");
    for (const id of ["address-cap", "delivery-timing"]) {
      const card = fold(html, id);
      expect(card.slice(0, card.indexOf(">")), id).not.toMatch(/\sopen(=|\s|>)/);
      expect(card, id).toMatch(/<summary[\s\S]*?<svg[^>]*aria-hidden="true"[\s\S]*?<\/summary>/);
    }
    expect(summaryOf(html, "address-cap")).toContain("cel mult 4 persoane pe adresă");
    expect(summaryOf(html, "delivery-timing")).toContain("la trecerea programată, în cel mult o oră");
    expect(fold(html, "address-cap")).toContain(ro.Admin.emails.addressCap.save);
    expect(fold(html, "delivery-timing")).toContain(ro.Admin.emails.deliveryTiming.save);
    // Their own forms, not the deadlines' form.
    expect(html.match(/<form/g)).toHaveLength(3);
  });

  it("opens the card whose own save just landed, and no other", async () => {
    const cap = await render("ro", DEFAULT_DEADLINES, true, { saved: "addressCap" });
    expect(fold(cap, "address-cap").slice(0, 200)).toMatch(/\sopen(=|\s|>)/);
    expect(fold(cap, "delivery-timing").slice(0, 200)).not.toMatch(/\sopen(=|\s|>)/);
    for (const group of DEADLINE_GROUPS) expect(fold(cap, `deadline-group-${group.key}`).slice(0, 200), group.key).not.toMatch(/\sopen(=|\s|>)/);
  });

  it("gives a reader who may not change them the same folds with the values and no form", async () => {
    const html = await render("ro", { ...DEFAULT_DEADLINES, holdMinutes: 20 }, false);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html.match(/data-testid="deadline-group-/g)).toHaveLength(7);
    expect(html).toMatch(/data-testid="deadline-holdMinutes"[^>]*>20</);
    expect(summaryOf(html, "deadline-group-hold")).toContain("loc ținut 20 de minute");
    expect(html).toContain(ro.Admin.emails.deadlines.readOnly);
    // A reader's values stay a description list: a screen reader hears each label with its value.
    const hold = fold(html, "deadline-group-hold");
    expect(hold).toMatch(/<dl/);
    expect(hold.match(/<dt/g)).toHaveLength(2);
    expect(hold.match(/<dd/g)).toHaveLength(2);
  });

  it("gives a fold of one box no sentence of its own, and a fold of several its sentence", async () => {
    const html = await render("ro");
    for (const group of DEADLINE_GROUPS) {
      const intro = ro.Admin.emails.deadlines.groups[group.key].intro;
      expect(html.includes(intro), group.key).toBe(group.fields.length > 1);
    }
  });

  it("keeps the catalogues' keys for both languages in step", () => {
    expect(Object.keys(en.Admin.emails.deadlines.groups)).toEqual(Object.keys(ro.Admin.emails.deadlines.groups));
    expect(Object.keys(en.Admin.emails.deadlines.short)).toEqual(Object.keys(ro.Admin.emails.deadlines.short));
    expect(Object.keys(en.Admin.emails.deliveryTiming.aside)).toEqual(["scheduled", "immediate"]);
  });
});
