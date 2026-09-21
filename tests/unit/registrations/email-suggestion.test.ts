import { describe, expect, it } from "vitest";
import { suggestEmail } from "@/modules/registrations/domain/email-suggestion";

/**
 * `DECISIONS.md` §233 — the check that catches the addresses that actually lost this club
 * people, all of which were syntactically perfect.
 *
 * The property that matters most is the **silence**: a suggestion that is wrong about a real
 * address teaches people to dismiss the next one, and the next one might be the right one.
 * So most of these assert that nothing is offered.
 */
describe("§233 did you mean", () => {
  it("catches the misspelling that bounced three times in QA", () => {
    // `…@gmail.con` — §206's evidence, and the reason the address is typed twice at all.
    expect(suggestEmail("ana@gmail.con")).toBe("ana@gmail.com");
  });

  it("catches the usual slips at the big providers", () => {
    expect(suggestEmail("ion@gmial.com")).toBe("ion@gmail.com");
    expect(suggestEmail("ion@yaho.com")).toBe("ion@yahoo.com");
    expect(suggestEmail("ion@hotmial.com")).toBe("ion@hotmail.com");
    expect(suggestEmail("ion@outlok.com")).toBe("ion@outlook.com");
  });

  it("catches an ending that is no top-level domain, whatever the name in front", () => {
    // `.con` is `.com` with a slipped finger and is not delegated to anybody, so this is safe
    // for a domain the table has never seen — which is most of them.
    expect(suggestEmail("cineva@clubulmeu.con")).toBe("cineva@clubulmeu.com");
    expect(suggestEmail("cineva@primaria-brasov.rp")).toBe("cineva@primaria-brasov.ro");
  });

  it("keeps the name as they capitalised it, and lowercases only the domain", () => {
    // The part before the @ is theirs; the part after it is not case-sensitive anyway.
    expect(suggestEmail("Ana.Pop@GMAIL.CON")).toBe("Ana.Pop@gmail.com");
  });

  it("says nothing about an address that is already right", () => {
    for (const address of ["ana@gmail.com", "ana@yahoo.com", "ana@clubul-nostru.ro"]) {
      expect(suggestEmail(address), address).toBeNull();
    }
  });

  it("says nothing about a real domain it has never heard of", () => {
    /*
      The reason this is a table and not an edit-distance guess. A distance function would
      offer `gmail.com` to somebody at a company domain one letter away, and being wrong once
      is what makes the next suggestion ignorable.
    */
    for (const address of ["ana@flyward.eu", "ana@gmal.ro", "ana@ymail.com", "ana@mail.ru"]) {
      expect(suggestEmail(address), address).toBeNull();
    }
  });

  it("says nothing it cannot know, including the domain that actually failed", () => {
    /*
      `prinicipal33.com` is what one of the owner's own registrations went to; Mailgun refused
      it with "No MX for prinicipal33.com". It is a plausible domain and only DNS knows it has
      no mail server, so this is silent about it — and being silent is right, because refusing
      what it cannot verify would turn a typo into a lockout (§205).
    */
    expect(suggestEmail("florin.asavei@prinicipal33.com")).toBeNull();
  });

  it("says nothing about something that is not an address yet", () => {
    for (const value of ["", "ana", "ana@", "@gmail.con", "   "]) {
      expect(suggestEmail(value), JSON.stringify(value)).toBeNull();
    }
  });
});
