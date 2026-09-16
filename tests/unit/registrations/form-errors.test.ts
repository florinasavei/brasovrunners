import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  parseInvalidFields,
  REGISTRATION_FORM_FIELDS,
} from "@/modules/registrations/form-errors";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";

/**
 * BR-REQ-031-01, BR-REQ-031-04 — the rejected-field list the registration form renders.
 *
 * The names travel back from the server action in a query parameter, so they are both
 * attacker-supplied and easy to drift out of step with the form itself. Three things are
 * checked here, and each has a failure that reaches a visitor: an unknown name rendering a raw
 * message key back onto the page, a name with no label in one locale, and a name the form
 * never actually posts.
 */
describe("BR-REQ-031-01 parseInvalidFields", () => {
  it("returns nothing for an absent or empty parameter", () => {
    expect(parseInvalidFields(undefined)).toEqual([]);
    expect(parseInvalidFields("")).toEqual([]);
    expect(parseInvalidFields(",,")).toEqual([]);
  });

  it("keeps the fields it knows", () => {
    expect(parseInvalidFields("firstName,email")).toEqual(["firstName", "email"]);
  });

  it("drops anything that is not a field of this form", () => {
    // Anybody can type `?fields=`. Without the filter this reaches `t("fieldNames.<x>")`,
    // which renders the key itself — reflected content on the one public form in the product.
    expect(parseInvalidFields("firstName,<script>,role,email")).toEqual(["firstName", "email"]);
    expect(parseInvalidFields("honeypot,renderedAt,locale")).toEqual([]);
  });

  it("lists them in the order they are met on the page, not the order of the URL", () => {
    // The summary at the top is a route down the form; listing "email" above "first name"
    // because the server happened to report it first sends somebody upwards.
    expect(parseInvalidFields("email,lastName,firstName")).toEqual([
      "firstName",
      "lastName",
      "email",
    ]);
  });

  it("never repeats a field, however many times the parameter names it", () => {
    expect(parseInvalidFields("email,email,email")).toEqual(["email"]);
  });
});

describe("BR-REQ-031-04 every rejected field can be named and reached", () => {
  it("has a label in both catalogues", () => {
    for (const field of REGISTRATION_FORM_FIELDS) {
      expect(
        (ro.Registration.fieldNames as Record<string, string>)[field],
        `ro label for ${field}`,
      ).toBeTruthy();
      expect(
        (en.Registration.fieldNames as Record<string, string>)[field],
        `en label for ${field}`,
      ).toBeTruthy();
    }
  });

  it("names only fields the form actually posts", () => {
    // `readRegistrationForm` is the one place the rendered names are read (`form-mapping.ts`).
    // A name here that it does not produce is a summary entry linking to an anchor that does
    // not exist, which reads as a dead link on an error page.
    const posted = new Set(Object.keys(readRegistrationForm(new FormData(), "ro")));
    for (const field of REGISTRATION_FORM_FIELDS) {
      expect(posted.has(field), `${field} is not read by readRegistrationForm`).toBe(true);
    }
  });

  it("carries every field the schema can reject and a participant can correct", () => {
    // `listOptOut`, `resultsNameConsent` and `clubMemberDeclared` are deliberately absent: a
    // checkbox is either ticked or not, so it cannot fail validation and a summary entry for
    // one could never appear. `privacyAcknowledged` is the exception and is in the list,
    // because `z.literal(true)` rejects an unticked one.
    const posted = Object.keys(readRegistrationForm(new FormData(), "ro"));
    const notShown = posted.filter(
      (name) => !(REGISTRATION_FORM_FIELDS as readonly string[]).includes(name),
    );
    expect(notShown.sort()).toEqual([
      "clubMemberDeclared",
      "honeypot",
      "listOptOut",
      "locale",
      "renderedAt",
      "resultsNameConsent",
    ]);
  });
});
