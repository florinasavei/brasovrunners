import { describe, expect, it } from "vitest";
import { formatDay } from "@/i18n/dates";
import { queueOrderFor } from "@/modules/registrations/domain/waitlist";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — the queue panel lists the people waiting in the order the club hands places out by:
 * when the form was sent where the club picks by hand, the line's own order where offers go out on
 * their own. A pure choice over `events.waitlist_auto_offer`; the allocator reads its own order.
 */
describe("§NNN which order the queue panel lists", () => {
  it("lists by when the form was sent when the club hands places out by hand", () => {
    expect(queueOrderFor(false)).toBe("SUBMITTED");
  });

  it("keeps the line's own order when offers go out on their own", () => {
    expect(queueOrderFor(true)).toBe("LINE");
  });
});

describe("§NNN the words on a waiting row", () => {
  // 1 October 2026, 19:42 in Brașov (16:42 UTC; EEST is UTC+3).
  const SENT = new Date("2026-10-01T16:42:00.000Z");
  const phrase = (locale: "ro" | "en", key: "sent" | "joined") => {
    const words = (locale === "ro" ? ro : en).Admin.queue;
    const when = formatDay(SENT, { locale, timeZone: "Europe/Bucharest", style: "short", withTime: true, position: "inline" });
    return words[key].replace("{when}", when);
  };

  it("says when the form was sent, in Romanian and in English, in Romania's time", () => {
    expect(phrase("ro", "sent")).toMatch(/^Formular trimis: .*1 oct\. 2026.* 19:42$/);
    expect(phrase("en", "sent")).toMatch(/^Form sent: .*1 Oct 2026.* 19:42$/);
  });

  it("labels the moment a person joined the line apart from it", () => {
    expect(phrase("ro", "joined")).toContain("19:42");
    expect(phrase("en", "joined")).toContain("19:42");
    expect(phrase("ro", "joined")).not.toBe(phrase("ro", "sent"));
  });

  it("names the shown order in both languages", () => {
    expect(ro.Admin.queue.orderSubmitted.toLowerCase()).toContain("în ordinea trimiterii formularului");
    expect(ro.Admin.queue.orderLine.toLowerCase()).toContain("în ordinea intrării pe listă");
    expect(en.Admin.queue.orderSubmitted.toLowerCase()).toContain("order the forms were sent");
    expect(en.Admin.queue.orderLine.toLowerCase()).toContain("order they joined the list");
  });

  it("calls the registration page's timeline entry the same thing", () => {
    expect(ro.Admin.registrations.submitted).toBe("Formular trimis");
    expect(en.Admin.registrations.submitted).toBe("Form sent");
  });
});
