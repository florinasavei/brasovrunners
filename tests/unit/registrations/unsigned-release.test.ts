import { describe, expect, it } from "vitest";
import { lineOffersMade } from "@/modules/notifications/domain/automatic-sends";
import { emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { renderBilingual, type TemplateData } from "@/modules/notifications/templates";
import {
  confirmByKey,
  type DeadlineReleaseRules,
  deadlineReleaseArmedFor,
  deadlineReleaseDue,
  deadlineReleaseWakeAt,
  releaseDeadlineForNewHold,
  releaseDeadlineOfHold,
  windowDeadlineOf,
} from "@/modules/registrations/domain/unsigned-release";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * «Eliberează singur locurile nesemnate la termen» (§914; BR-REQ-033-01, BR-REQ-080-01) as pure rules and words: the
 * release is armed only on a capped, scheduled event with the box ticked and a participation window whose deadline is
 * before the start; it is due from that deadline until the start, once per deadline (the memory); a moved deadline arms
 * it again. The person released is told the window's deadline; the Administrators get one summary; the declaration's
 * message says the place goes at the deadline. The forecast offers a freed place only as the allocator does (§914, K).
 */
const DAY = 24 * 60 * 60_000;
const NOW = new Date();
const STARTS = new Date(NOW.getTime() + 30 * DAY);
const DEADLINE = new Date(STARTS.getTime() - 2 * DAY);
const rules = (over: Partial<DeadlineReleaseRules> = {}): DeadlineReleaseRules => ({
  capacity: 175,
  eventStatus: "SCHEDULED",
  startsAt: STARTS,
  confirmationOpensDaysBefore: 7,
  confirmationDeadlineDaysBefore: 2,
  releaseUnsignedAtDeadline: true,
  unsignedReleasedFor: null,
  ...over,
});

describe("BR-REQ-033-01 the release's deadline, as pure rules (§914)", () => {
  it("the window's deadline only when it is before the start", () => {
    expect(windowDeadlineOf(rules())).toEqual(DEADLINE);
    // A deadline at the start (0 days) or no window at all: nothing new to release before the start.
    expect(windowDeadlineOf(rules({ confirmationDeadlineDaysBefore: 0 }))).toBeNull();
    expect(windowDeadlineOf(rules({ confirmationOpensDaysBefore: 0 }))).toBeNull();
  });

  it("armed only ticked, capped, scheduled and not yet run for that deadline; a moved deadline arms it again", () => {
    expect(deadlineReleaseArmedFor(rules())).toEqual(DEADLINE);
    expect(deadlineReleaseArmedFor(rules({ releaseUnsignedAtDeadline: false }))).toBeNull();
    expect(deadlineReleaseArmedFor(rules({ capacity: null }))).toBeNull();
    expect(deadlineReleaseArmedFor(rules({ eventStatus: "CANCELLED" }))).toBeNull();
    expect(deadlineReleaseArmedFor(rules({ unsignedReleasedFor: DEADLINE }))).toBeNull();
    // Ran for 2 days before; the window moved to 1 day before: armed for the new deadline.
    expect(deadlineReleaseArmedFor(rules({ unsignedReleasedFor: DEADLINE, confirmationDeadlineDaysBefore: 1 }))).toEqual(new Date(STARTS.getTime() - DAY));
  });

  it("due from the deadline to the start, and the job wakes at it while it is ahead", () => {
    expect(deadlineReleaseDue(rules(), new Date(DEADLINE.getTime() - 60_000))).toBeNull();
    expect(deadlineReleaseDue(rules(), DEADLINE)).toEqual(DEADLINE);
    expect(deadlineReleaseDue(rules(), new Date(DEADLINE.getTime() + DAY))).toEqual(DEADLINE);
    // At the start every unsigned hold goes anyway (§160): nothing for the release to add.
    expect(deadlineReleaseDue(rules(), STARTS)).toBeNull();
    expect(deadlineReleaseWakeAt(rules(), NOW)).toEqual(DEADLINE);
    expect(deadlineReleaseWakeAt(rules(), new Date(DEADLINE.getTime() + 1))).toBeNull();
    expect(deadlineReleaseWakeAt(rules({ releaseUnsignedAtDeadline: false }), NOW)).toBeNull();
  });

  it("the moment said for the release is its deadline, whenever the hold it takes ends (the review's nit)", () => {
    const earlier = new Date(DEADLINE.getTime() - DAY);
    expect(releaseDeadlineOfHold(rules(), { holdExpiresAt: DEADLINE })).toEqual(DEADLINE);
    expect(releaseDeadlineOfHold(rules(), { holdExpiresAt: earlier })).toEqual(DEADLINE);
    // Never a special guest's, never a hold past the deadline, never with the switch off.
    expect(releaseDeadlineOfHold(rules(), { holdExpiresAt: DEADLINE, outsideCapacity: true })).toBeNull();
    expect(releaseDeadlineOfHold(rules(), { holdExpiresAt: new Date(DEADLINE.getTime() + 1) })).toBeNull();
    expect(releaseDeadlineOfHold(rules({ releaseUnsignedAtDeadline: false }), { holdExpiresAt: DEADLINE })).toBeNull();
    // «confirmă până»: today's, the release's, or both instants when the hold ends before the release.
    expect(confirmByKey(DEADLINE, null)).toBe("mine.confirmBy");
    expect(confirmByKey(DEADLINE, DEADLINE)).toBe("mine.confirmByReleased");
    expect(confirmByKey(earlier, DEADLINE)).toBe("mine.confirmByReleasedLater");
  });

  it("a hold given now at the event: the release's deadline while it is ahead, nothing once it has come or with the switch off", () => {
    expect(releaseDeadlineForNewHold(rules(), NOW)).toEqual(DEADLINE);
    expect(releaseDeadlineForNewHold(rules(), DEADLINE)).toBeNull();
    expect(releaseDeadlineForNewHold(rules({ releaseUnsignedAtDeadline: false }), NOW)).toBeNull();
    expect(releaseDeadlineForNewHold(rules({ unsignedReleasedFor: DEADLINE }), NOW)).toBeNull();
  });
});

describe("§914 the forecast's offers follow the allocator's: by itself, and into the site's room only", () => {
  const offers = [
    { at: new Date(1_000), count: 2 },
    { at: new Date(2_000), count: 1 },
  ];
  it("with K at 0 and «Da», unchanged", () => {
    expect(lineOffersMade(offers, { offersByItself: true, beyondSite: 0 })).toEqual(offers);
  });
  it("«Nu» or «Locurile libere le dau doar eu»: no offer at all", () => {
    expect(lineOffersMade(offers, { offersByItself: false, beyondSite: 0 })).toEqual([]);
  });
  it("kept places in use: the first releases make them up, the rest are offered, in time order", () => {
    expect(lineOffersMade(offers, { offersByItself: true, beyondSite: 1 })).toEqual([
      { at: new Date(1_000), count: 1 },
      { at: new Date(2_000), count: 1 },
    ]);
    expect(lineOffersMade(offers, { offersByItself: true, beyondSite: 2 })).toEqual([{ at: new Date(2_000), count: 1 }]);
    expect(lineOffersMade(offers, { offersByItself: true, beyondSite: 5 })).toEqual([]);
  });
});

describe("BR-REQ-080-01 the release's words in the emails (§914)", () => {
  const render = (type: "COMPLETE_DECLARATION" | "UNSIGNED_RELEASED", locale: "ro" | "en", extra: Partial<TemplateData>) =>
    renderBilingual(type, locale, { ...emailSampleFor(type, locale), ...extra }, "https://example.test/ro/admin/registrations");

  it("the declaration's message says the place goes at the release's deadline — never kept while nobody asks, nor a paper on race day", () => {
    const sample = emailSampleFor("COMPLETE_DECLARATION", "ro");
    const release = { releaseDeadlineFormatted: "joi, 19 noiembrie, 10:00", releaseDeadlineFormattedOther: "Thursday 19 November, 10:00" };
    const on = render("COMPLETE_DECLARATION", "ro", { releasesAtDeadline: true, confirmLater: true, ...release });
    // The release's own deadline (the review's nit), each half in its own words — never the hold's instant for the release.
    expect(on.text).toContain("Dacă nu semnezi până joi, 19 noiembrie, 10:00, locul se eliberează și nu mai este rezervat pentru tine.");
    expect(on.text).toContain("If you do not sign by Thursday 19 November, 10:00, the place is released and no longer held for you.");
    expect(on.text).not.toContain(`Dacă nu semnezi până ${sample.holdExpiresAtFormatted}`);
    expect(on.text).not.toContain("pe hârtie la masa de înscrieri");
    // A hold that ends before the release's deadline (a place taken inside the window): its own instant, for the waiting list.
    const earlier = render("COMPLETE_DECLARATION", "ro", { releasesAtDeadline: true, confirmLater: true, holdEndsBeforeRelease: true, ...release });
    expect(earlier.text).toContain(`Dacă se formează lista de așteptare, locul îți este ținut până ${sample.holdExpiresAtFormatted}. Dacă nu semnezi până joi, 19 noiembrie, 10:00, locul se eliberează`);
    expect(earlier.text).toContain(`If a waiting list forms, the place is held for you until ${sample.holdExpiresAtFormattedOther}. If you do not sign by Thursday 19 November, 10:00, the place is released`);
    expect(earlier.text).not.toContain("pe hârtie la masa de înscrieri");
    // The switch off: the words as before.
    const off = render("COMPLETE_DECLARATION", "ro", { releasesAtDeadline: false, confirmLater: true });
    expect(off.text).toContain("semnezi declarația pe hârtie la masa de înscrieri");
    expect(off.text).not.toContain("locul se eliberează și nu mai este rezervat");
  });

  it("UNSIGNED_RELEASED: what was released and what now, that each person was told, the tick, in both languages", () => {
    const facts = { deadline: { ro: "15 noiembrie, 10:00", en: "15 November, 10:00" }, released: 12, test: 0, unsigned: 0, free: 14, capacity: 175, waiting: 20, offerOnlyTicked: true };
    const mail = render("UNSIGNED_RELEASED", "ro", { unsignedReleased: facts });
    expect(mail.text).toContain("Eliberate: 12 · libere acum: 14 din 175 · pe lista de așteptare: 20");
    expect(mail.text).toContain("Released: 12 · free now: 14 of 175 · on the waiting list: 20");
    expect(mail.text).toContain("locurile celor care nu semnaseră până atunci s-au eliberat, fără să le primească cineva automat.");
    expect(mail.text).toContain("Fiecare persoană al cărei loc s-a eliberat a primit emailul „Locul tău nu mai este rezervat”.");
    expect(mail.text).toContain("Am bifat «Locurile libere le dau doar eu»");
    expect(mail.text).toContain("We ticked «I hand out the free places myself»");
    // What it left unsigned, said only when there is some — and the tick already on.
    const left = render("UNSIGNED_RELEASED", "en", { unsignedReleased: { ...facts, released: 0, unsigned: 3, offerOnlyTicked: false } });
    expect(left.text).toContain("still unsigned, kept: 3");
    expect(left.text).toContain("no place was released");
    expect(left.text).toContain("«Locurile libere le dau doar eu» era deja bifat");
  });

  it("the editor's tick, its help, the summary's lines and «Când se pierde un loc» exist in both catalogues", () => {
    for (const catalogue of [ro, en]) {
      const editor = catalogue.Admin.editor as Record<string, unknown>;
      for (const key of ["releaseUnsignedAtDeadline", "releaseUnsignedHelp", "releaseUnsignedHelpUnticked", "releaseUnsignedHelpMore", "releaseUnsignedNoEffect", "releaseUnsignedRan"]) {
        expect(editor[key], key).toBeTruthy();
      }
      const deadlines = catalogue.Admin.registrations.placeDeadlines as Record<string, unknown>;
      expect(deadlines.releaseAtDeadline).toBeTruthy();
      expect(deadlines.releasedAtDeadline).toBeTruthy();
      expect(catalogue.Admin.emails.forecast.sends.unsignedReleased).toBeTruthy();
    }
  });
});
