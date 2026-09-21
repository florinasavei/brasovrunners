import { describe, expect, it } from "vitest";
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
