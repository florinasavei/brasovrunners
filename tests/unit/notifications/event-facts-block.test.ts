import { describe, expect, it } from "vitest";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { EMAIL_COPY_PLACEHOLDERS } from "@/modules/notifications/domain/email-copy";
import { EMAIL_SAMPLE, EMAIL_SAMPLE_EVENT } from "@/modules/notifications/domain/email-sample";
import { eventFactsBlock } from "@/modules/notifications/domain/event-facts";
import { emailSampleActionUrl, emailSampleEventFacts, emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { renderBilingual } from "@/modules/notifications/templates";

/**
 * §392 — the event's facts block: the platform's, like the button and the QR, so the closed set of
 * fields the club writes with is unchanged; and the previews on `/admin/emails` draw it for every
 * message that carries it, from the sample event, never from a fact typed into the page.
 */
const CARRIERS: EmailMessageType[] = ["REGISTRATION_CONFIRMED", "EVENT_REMINDER", "COMPLETE_DECLARATION"];

describe("§392 the facts block is not a placeholder", () => {
  it("leaves the closed set of fields exactly as it was", () => {
    expect([...EMAIL_COPY_PLACEHOLDERS]).toEqual([
      "participantName",
      "eventTitle",
      "eventLocationName",
      "eventStartsAtFormatted",
      "bibNumber",
      "checkinCode",
      "currentStatus",
      "holdExpiresAtFormatted",
      "signedAtFormatted",
      "eventChecklist",
      "staffRole",
      "inviterName",
      "confirmationHours",
      "holdMinutes",
      "offerHours",
      "reminderHours",
    ]);
  });
});

describe("§392 the previews draw the block with the sample event", () => {
  for (const messageType of CARRIERS) {
    for (const locale of ["ro", "en"] as const) {
      it(`${messageType} (${locale}) shows every row, each half in its own language`, () => {
        const content = renderBilingual(messageType, locale, emailSampleFor(messageType, locale), emailSampleActionUrl(locale));
        const [first, second] = content.text.split("\n— — —\n");
        const other = locale === "ro" ? "en" : "ro";
        for (const [half, language] of [
          [first, locale],
          [second, other],
        ] as const) {
          const labels = language === "ro" ? ["Când:", "Unde:", "Program:", "Traseu:", "Cost:", "Linkuri:"] : ["When:", "Where:", "Programme:", "Route:", "Cost:", "Links:"];
          for (const label of labels) expect(half, `${language} ${label}`).toMatch(new RegExp(`^${label}`, "m"));
          expect(half).toContain(EMAIL_SAMPLE[language].eventLocationName);
          expect(half).toContain(EMAIL_SAMPLE_EVENT.locationAddress);
          expect(half).toContain(EMAIL_SAMPLE_EVENT.costAmount);
          expect(half).toContain(`/${language}/EXAMPLE-event#route`);
        }
        expect(content.html.split('data-email-part="event-facts"').length - 1).toBe(2);
      });
    }
  }

  it("is drawn by no other message", () => {
    for (const messageType of ["WAITLIST_JOINED", "BIB_ASSIGNED", "EVENT_UPDATE_NOTICE", "REGISTRATION_OPENED", "ORGANIZER_MESSAGE"] as const) {
      expect(renderBilingual(messageType, "ro", emailSampleFor(messageType, "ro"), emailSampleActionUrl("ro")).html).not.toContain("event-facts");
    }
  });

  it("writes the sample's programme and route in the page's words", () => {
    const ro = eventFactsBlock(emailSampleEventFacts("ro"), "ro").text;
    expect(ro).toContain("Când: Duminică, 4 oct. 2026 · întâlnire la 09:00 · start la 09:30");
    expect(ro).toContain("Program: 08:00–08:50 — Ridicarea numerelor\n  09:15 — Briefing\n  09:30 — Startul");
    expect(ro).toContain("Traseu: Trail · Mediu · 12 km · 450 m D+");
    const en = eventFactsBlock(emailSampleEventFacts("en"), "en").text;
    expect(en).toContain("When: Sunday, 4 Oct 2026 · gather at 09:00 · start at 09:30");
    expect(en).toContain("Route: Trail · Moderate · 12 km · 450 m climb");
  });

  it("escapes what the club typed in the HTML part", () => {
    const html = eventFactsBlock({ ...emailSampleEventFacts("ro"), locationName: "<b>Tâmpa</b> & co" }, "ro").html;
    expect(html).toContain("&lt;b&gt;Tâmpa&lt;/b&gt; &amp; co");
    expect(html).not.toContain("<b>Tâmpa</b>");
  });
});
