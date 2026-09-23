import { describe, expect, it } from "vitest";
import {
  contactRecipientsSchema,
  formatAddressList,
  parseAddressList,
  resolveContactRecipients,
} from "@/modules/contact/domain/recipients";

/**
 * BR-REQ-070-04 criterion 3, `DECISIONS.md` §164 — who reads what the contact form sends.
 *
 * The reading order is the whole of the decision: the club's own list when it named one,
 * `CONTACT_FORM_TO` while it has not, and the form off when neither answers. A deployment
 * must never lose its way out because somebody opened a screen and saved it empty by mistake
 * — which is exactly what the fallback is for.
 */
describe("BR-REQ-070-04 the contact form's recipients", () => {
  it("reads a typed line as a list, whichever separator the person used", () => {
    expect(parseAddressList("club@example.com, amalia@example.org")).toEqual(["club@example.com", "amalia@example.org"]);
    expect(parseAddressList(" club@example.com ;amalia@example.org , ")).toEqual(["club@example.com", "amalia@example.org"]);
    expect(parseAddressList("   ")).toEqual([]);
    // And back the way it came, so a save round-trips to the same text.
    expect(formatAddressList(["club@example.com", "amalia@example.org"])).toBe("club@example.com, amalia@example.org");
  });

  it("refuses an entry that is not an address, and accepts an empty list", () => {
    expect(contactRecipientsSchema.safeParse({ to: ["club@example.com"], cc: [] }).success).toBe(true);
    expect(contactRecipientsSchema.safeParse({ to: [], cc: [] }).success).toBe(true);
    expect(contactRecipientsSchema.safeParse({ to: ["nope"], cc: [] }).success).toBe(false);
    expect(contactRecipientsSchema.safeParse({ to: ["club@example.com"], cc: ["amalia at example.org"] }).success).toBe(false);
    // The hidden copies (2026-09-22) are validated like the other two, and refused whole.
    expect(contactRecipientsSchema.safeParse({ to: [], cc: [], bcc: ["x@example.com"] }).success).toBe(true);
    expect(contactRecipientsSchema.safeParse({ to: ["club@example.com"], cc: [], bcc: ["x at example.com"] }).success).toBe(false);
    // Nothing else may ride along in a settings row.
    expect(contactRecipientsSchema.safeParse({ to: [], cc: [], bcc: [], replyTo: ["x@example.com"] }).success).toBe(false);
  });

  it("reads a row stored before the hidden copies existed as having none", () => {
    // `platform_settings.contactRecipients` rows written under §164 carry `to` and `cc` only;
    // there is no migration for a JSON setting, so the schema is what makes them still read.
    expect(contactRecipientsSchema.parse({ to: ["club@example.com"], cc: ["amalia@example.org"] })).toEqual({
      to: ["club@example.com"],
      cc: ["amalia@example.org"],
      bcc: [],
    });
  });

  it("prefers the club's own list, falls back to the environment, and answers nobody with nobody", () => {
    const environment = ["deployed@example.com"];

    expect(resolveContactRecipients({ to: ["club@example.com"], cc: ["amalia@example.org"], bcc: ["arhiva@example.org"] }, environment)).toEqual({
      to: ["club@example.com"],
      cc: ["amalia@example.org"],
      bcc: ["arhiva@example.org"],
      source: "setting",
    });

    // The copy lists are the app's whichever half answered for the "to" list: a colleague's
    // copy must not wait on the club moving the main list into the app.
    expect(resolveContactRecipients({ to: [], cc: ["amalia@example.org"], bcc: ["arhiva@example.org"] }, environment)).toEqual({
      to: environment,
      cc: ["amalia@example.org"],
      bcc: ["arhiva@example.org"],
      source: "environment",
    });

    expect(resolveContactRecipients(null, environment)).toEqual({ to: environment, cc: [], bcc: [], source: "environment" });
    expect(resolveContactRecipients({ to: [], cc: [], bcc: [] }, [])).toEqual({ to: [], cc: [], bcc: [], source: "none" });
    expect(resolveContactRecipients(null, [])).toEqual({ to: [], cc: [], bcc: [], source: "none" });
  });

  it("writes the same mailbox once, however many boxes it was typed into", () => {
    // Nodemailer builds the envelope from every list, so a repeat is a second RCPT TO and a
    // name in two headers. The first spelling is the one kept (§164); "to" beats "cc" beats
    // "bcc", so an address that is a recipient is never also a hidden copy.
    const parsed = contactRecipientsSchema.parse({
      to: ["club@example.com", "Club@Example.com"],
      cc: ["CLUB@example.com", "amalia@example.org", "amalia@example.org"],
      bcc: ["AMALIA@example.org", "club@EXAMPLE.com", "arhiva@example.org", "Arhiva@example.org"],
    });
    expect(parsed).toEqual({ to: ["club@example.com"], cc: ["amalia@example.org"], bcc: ["arhiva@example.org"] });

    // And against the environment's list too, for a deployment that has not moved it yet.
    expect(
      resolveContactRecipients(
        { to: [], cc: ["Deployed@example.com", "amalia@example.org"], bcc: ["deployed@EXAMPLE.com", "arhiva@example.org"] },
        ["deployed@example.com"],
      ),
    ).toEqual({
      to: ["deployed@example.com"],
      cc: ["amalia@example.org"],
      bcc: ["arhiva@example.org"],
      source: "environment",
    });
  });
});
