import { describe, expect, it } from "vitest";
import { buildTemplateContent } from "@/modules/notifications/templates";
import { renderBilingual } from "@/modules/notifications/templates";

/**
 * `DECISIONS.md` §189 — the race number is bold in the message that carries it, and the marker
 * that makes it bold can never be turned into markup by anything a participant typed.
 *
 * The owner, of a confirmation: "in mail, numărul de concurs trebuie făcut bold, e super
 * important!" It is: it is the one line a runner reads on a phone at the desk.
 */
describe("§189 the race number is bold, and only this codebase can ask for bold", () => {
  const confirmed = (over: Record<string, unknown> = {}) =>
    renderBilingual("REGISTRATION_CONFIRMED", "ro", {
      participantName: "Ana Popescu",
      eventTitle: "Crosul aniversar",
      bibNumber: 774,
      ...over,
    } as never, undefined);

  it("wraps the number in <strong> in the HTML", () => {
    expect(confirmed().html).toContain("<strong>774</strong>");
  });

  it("prints the number with no markers in the plain-text part", () => {
    const { text } = confirmed();
    expect(text).toContain("774");
    expect(text).not.toContain("**");
  });

  it("leaves no marker behind in the HTML", () => {
    expect(confirmed().html).not.toContain("**");
  });

  it("cannot be asked for bold by something a participant typed", () => {
    // The substitution runs *after* escaping, so a name carrying the marker is text and the
    // angle brackets around it were already neutralised. Both halves of that matter: the
    // asterisks stay asterisks, and nothing becomes an element.
    const { html } = confirmed({ participantName: "**Ana** <b>Popescu</b>" });
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>Popescu</b>");
    expect(html).not.toContain("<strong>Ana</strong>");
  });
});

/**
 * §237 — the race number is in the message, and says when it can still change.
 *
 * §214 stopped writing `bib_number` until registration closes, and the renderer read only
 * that column — so a confirmation went out with a QR, a check-in code and no number, to
 * somebody who had been looking at their number since the day they registered. Absent reads
 * as "you have not been given one".
 */
describe("§237 the number in the message", () => {
  it("prints the provisional number and qualifies it", () => {
    const content = buildTemplateContent(
      "REGISTRATION_CONFIRMED",
      "ro",
      { participantName: "Anna", eventTitle: "Cros", bibNumber: 2, bibProvisional: true },
      undefined,
    );
    const text = content.paragraphs.join(" ");
    expect(text).toContain("2");
    expect(text).toContain("provizoriu");
  });

  it("says nothing about provisionality once the number is settled", () => {
    // After the close the number cannot move, so qualifying it would be noise — and worse,
    // it would invite somebody to wait for a second number that is never coming.
    const content = buildTemplateContent(
      "REGISTRATION_CONFIRMED",
      "ro",
      { participantName: "Anna", eventTitle: "Cros", bibNumber: 2 },
      undefined,
    );
    expect(content.paragraphs.join(" ")).not.toContain("provizoriu");
  });
});
