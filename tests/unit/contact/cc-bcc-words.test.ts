import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { addressListRefusal, CONTACT_RECIPIENTS_MAX, parseAddressList } from "@/modules/contact/domain/recipients";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN — «CC» and «BCC» on «Pagini» → «Contact», in the words the
 * owner used, with one sentence saying what each does. The parser and the refusal are §457's,
 * shared with «Setări» → «Emailuri»: a box is read the same way on both pages.
 */
const contacts = (catalogue: typeof ro) => catalogue.Admin.emails.contacts;

describe("BR-REQ-070-04 the contact page's CC and BCC boxes", () => {
  it("labels the boxes «CC» and «BCC» and says what they do in one sentence, in both languages", () => {
    expect(contacts(ro).cc).toBe("CC");
    expect(contacts(ro).bcc).toBe("BCC");
    expect(contacts(en).cc).toBe("CC");
    expect(contacts(en).bcc).toBe("BCC");
    expect(contacts(ro).copiesHelp).toBe("CC: adresele apar în email; BCC: primesc o copie fără să apară.");
    expect(contacts(en).copiesHelp).toBe("CC: the addresses appear in the email; BCC: they get a copy without appearing.");
    for (const catalogue of [ro, en]) {
      for (const key of ["copiesHelp", "repeats", "toHelp", "ccHelp", "bccHelp"] as const) {
        expect(contacts(catalogue)[key].length).toBeLessThanOrEqual(200);
      }
      // The closed card's line names the copies in force, not only the "to".
      expect(contacts(catalogue).aside).toContain("{cc}");
      expect(contacts(catalogue).aside).toContain("{bcc}");
    }
  });

  it("reads a box one address per line as well as with commas (§457)", () => {
    expect(parseAddressList("ioana@example.org\r\nmihai@example.org\n\narhiva@example.org,")).toEqual([
      "ioana@example.org",
      "mihai@example.org",
      "arhiva@example.org",
    ]);
  });

  it("names the entry that is not an address, whichever box it is in", () => {
    expect(addressListRefusal([["club@example.com"], ["ioana.example.org"], []], CONTACT_RECIPIENTS_MAX)).toEqual({
      error: "INVALID_ADDRESSES",
      errorValues: { addresses: "ioana.example.org" },
    });
    const eleven = Array.from({ length: CONTACT_RECIPIENTS_MAX + 1 }, (_, index) => `copie${index}@example.org`);
    expect(addressListRefusal([["club@example.com"], [], eleven], CONTACT_RECIPIENTS_MAX)).toEqual({
      error: "TOO_MANY_ADDRESSES",
      errorValues: { max: String(CONTACT_RECIPIENTS_MAX) },
    });
  });
});
