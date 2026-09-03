import { describe, expect, it } from "vitest";
import {
  CANONICALIZATION_VERSION,
  canonicalizeEmail,
  InvalidEmailError,
  isValidEmail,
} from "@/modules/participants/domain/canonical-email";

/**
 * BR-REQ-032-01 — whitespace and case are ignored.
 * BR-REQ-032-02 — Gmail dots and tags.
 * BR-REQ-032-04 — canonicalization is versioned.
 *
 * The file SPECS names. These are the cheapest tests in the project and they guard the
 * participant's entire identity: get this wrong and the organizer's list on race morning
 * shows one runner twice, which §10.3 makes unfixable because there is no merge path.
 */

describe("BR-REQ-032-01 whitespace and case", () => {
  it("canonicalizes the exact example from the acceptance criteria", () => {
    const result = canonicalizeEmail(" Ana.Pop@Example.RO ");

    expect(result.canonicalEmail).toBe("ana.pop@example.ro");
    // Criterion 2: the submitted spelling survives, minus surrounding whitespace.
    expect(result.deliveryEmail).toBe("Ana.Pop@Example.RO");
  });

  it("treats case and surrounding whitespace as the same participant", () => {
    const a = canonicalizeEmail("ana@example.ro");
    const b = canonicalizeEmail("  ANA@EXAMPLE.RO  ");
    expect(a.canonicalEmail).toBe(b.canonicalEmail);
  });

  it("trims Unicode whitespace, not only ordinary spaces", () => {
    // A non-breaking space and a zero-width no-break space, which paste in from documents.
    expect(canonicalizeEmail(" ana@example.ro ").canonicalEmail).toBe("ana@example.ro");
    expect(canonicalizeEmail("﻿ana@example.ro").canonicalEmail).toBe("ana@example.ro");
  });
});

describe("BR-REQ-032-02 Gmail dots and tags", () => {
  it("treats dotted and undotted Gmail addresses as one inbox", () => {
    expect(canonicalizeEmail("a.n.a@gmail.com").canonicalEmail).toBe(
      canonicalizeEmail("ana@gmail.com").canonicalEmail,
    );
  });

  it("ignores a Gmail plus tag", () => {
    expect(canonicalizeEmail("ana+club@gmail.com").canonicalEmail).toBe(
      canonicalizeEmail("ana@gmail.com").canonicalEmail,
    );
  });

  it("collapses googlemail to gmail in the canonical value only", () => {
    const googlemail = canonicalizeEmail("ana@googlemail.com");
    const gmail = canonicalizeEmail("ana@gmail.com");

    expect(googlemail.canonicalEmail).toBe(gmail.canonicalEmail);
    // Criterion 3, the half that is easy to get wrong: each keeps its submitted domain.
    expect(googlemail.normalizedEmail).toBe("ana@googlemail.com");
    expect(googlemail.deliveryEmail).toBe("ana@googlemail.com");
    expect(gmail.normalizedEmail).toBe("ana@gmail.com");
  });

  it("keeps dots meaningful on a custom domain", () => {
    // On a custom domain these may be two different people. Applying Gmail's rule here would
    // silently merge them, and there is no way back.
    expect(canonicalizeEmail("a.n.a@example.ro").canonicalEmail).not.toBe(
      canonicalizeEmail("ana@example.ro").canonicalEmail,
    );
  });

  it("preserves a plus tag on a custom domain", () => {
    expect(canonicalizeEmail("ana+club@example.ro").canonicalEmail).toBe("ana+club@example.ro");
  });

  it("applies Gmail rules only to the two exact Google domains", () => {
    // A lookalike domain must not inherit the rule.
    expect(canonicalizeEmail("a.n.a@gmail.com.example.ro").canonicalEmail).toBe(
      "a.n.a@gmail.com.example.ro",
    );
    expect(canonicalizeEmail("a.n.a@notgmail.com").canonicalEmail).toBe("a.n.a@notgmail.com");
  });

  it("strips the tag before the dots, so a dotted tag cannot leak through", () => {
    expect(canonicalizeEmail("ana+my.club@gmail.com").canonicalEmail).toBe("ana@gmail.com");
  });
});

describe("BR-REQ-032-04 versioning", () => {
  it("records the version that produced the canonical value", () => {
    expect(canonicalizeEmail("ana@example.ro").canonicalizationVersion).toBe(
      CANONICALIZATION_VERSION,
    );
    expect(CANONICALIZATION_VERSION).toBe(1);
  });
});

describe("validation", () => {
  it.each([
    ["", "empty"],
    ["   ", "only whitespace"],
    ["ana", "no domain"],
    ["ana@", "empty domain"],
    ["@example.ro", "empty local part"],
    ["ana@@example.ro", "two at signs"],
    ["ana@example", "domain without a dot"],
    ["ana@.example.ro", "domain starting with a dot"],
    ["ana@example.ro.", "domain ending with a dot"],
    ["Ana <ana@example.ro>", "display-name form"],
    ["ana@example.ro, bob@example.ro", "two addresses"],
    ["an a@example.ro", "space inside the local part"],
    ["+tag@gmail.com", "nothing identifying left after canonicalization"],
    [".@gmail.com", "only a dot in the local part"],
    ["ana\u200B@example.ro", "zero-width space"],
    ["a\\b@example.ro", "backslash in the local part"],
    ["ana@exa\\mple.ro", "backslash in the domain"],
    ["ana@exam ple.ro", "space in the domain"],
    ["ana\u0000@example.ro", "NUL byte"],
  ])("rejects %j — %s", (input) => {
    expect(() => canonicalizeEmail(input)).toThrow(InvalidEmailError);
    expect(isValidEmail(input)).toBe(false);
  });

  it("does not put the address into the error message, which reaches logs", () => {
    try {
      canonicalizeEmail("secret.person@example.ro extra");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret.person");
      expect((error as InvalidEmailError).code).toBe("VALIDATION_ERROR");
    }
  });

  it("accepts the shapes real people submit", () => {
    for (const address of [
      "ana@example.ro",
      "ana.pop@example.ro",
      "ana+club@example.ro",
      "ana-pop@sub.example.ro",
      "ana_pop@example.co.uk",
      "a@b.ro",
      "ana123@example.ro",
    ]) {
      expect(isValidEmail(address), address).toBe(true);
    }
  });

  it("normalizes an internationalized domain to punycode so one domain compares equal", () => {
    // brașov.ro and its punycode form must not become two identities.
    const unicode = canonicalizeEmail("ana@brașov.example");
    expect(unicode.canonicalEmail.startsWith("ana@xn--")).toBe(true);
    expect(canonicalizeEmail(`ana@${unicode.canonicalEmail.split("@")[1]}`).canonicalEmail).toBe(
      unicode.canonicalEmail,
    );
  });
});
