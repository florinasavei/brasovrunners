import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { contactRecipientsSchema, DEFAULT_CONTACT_RECIPIENTS } from "@/modules/contact/domain/recipients";
import { shouldHoldBack } from "@/modules/contact/held-back";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN (amends §310) — the tick that stops «[posibil spam]» messages
 * from being emailed: the decision, its default, and the card's words.
 */
describe("BR-REQ-070-04 the tick that holds back suspected spam", () => {
  it("holds back only a suspicious message, and only with the tick on", () => {
    expect(shouldHoldBack({ suspicious: true }, true)).toBe(true);
    expect(shouldHoldBack({ suspicious: false }, true)).toBe(false);
    expect(shouldHoldBack({ suspicious: true }, false)).toBe(false);
    expect(shouldHoldBack({ suspicious: false }, false)).toBe(false);
  });

  it("is off by default: a row saved before the tick existed, and the empty default, read as unticked", () => {
    expect(contactRecipientsSchema.parse({ to: ["club@example.org"] }).holdBackSuspected).toBe(false);
    expect(DEFAULT_CONTACT_RECIPIENTS.holdBackSuspected).toBe(false);
    expect(contactRecipientsSchema.parse({ holdBackSuspected: true }).holdBackSuspected).toBe(true);
  });

  it("words the tick in both languages, with a Bifat/Debifat line and a count in three forms", () => {
    const words = (catalogue: typeof ro) => catalogue.Admin.emails.contacts;
    expect(words(ro).holdBack).toBe("Nu-mi trimite mesajele care par spam");
    expect(words(en).holdBack).toBe("Don't send me messages that look like spam");
    expect(words(ro).holdBackHelp).toMatch(/^Bifat:.*Debifat:/);
    expect(words(en).holdBackHelp).toMatch(/^Ticked:.*Unticked:/);
    for (const catalogue of [ro, en]) {
      for (const form of ["one", "few", "other"] as const) expect(words(catalogue).heldBack[form]).toContain("{count}");
    }
  });

  it("draws the tick and the count on the card, and only the Administrator's form carries the tick", () => {
    const panel = readFileSync(path.join(process.cwd(), "src/modules/contact/ui/ContactRecipientsPanel.tsx"), "utf8");
    expect(panel).toContain('name="holdBackSuspected"');
    expect(panel).toContain("defaultChecked={recipients.holdBackSuspected}");
    expect(panel).toContain("emails.contacts.heldBack.");
    // The tick sits inside the form that only `mayEdit` renders.
    expect(panel.indexOf("{!mayEdit ? (")).toBeLessThan(panel.indexOf('name="holdBackSuspected"'));
    const action = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/pages/contact/actions.ts"), "utf8");
    expect(action).toContain('holdBackSuspected: form.get("holdBackSuspected") === "on"');
  });
});
