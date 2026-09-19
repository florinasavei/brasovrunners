import { describe, expect, it } from "vitest";
import {
  CONTACT_MESSAGE_MAX,
  contactFields,
  parseContactError,
  parseContactErrorFields,
} from "@/modules/contact/fields";
import { readContactInput } from "@/modules/contact/service";
import { openFormDraft, sealFormDraft } from "@/modules/registrations/form-draft";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-070-04 criterion 2 — the contact form's three boxes are validated like the
 * registration form's, and a rejection names the boxes and nothing else.
 */
const VALID = {
  name: "Ana Popescu",
  email: "ana@example.com",
  message: "Bună, la ce oră începe alergarea de duminică?",
  locale: "ro" as const,
};

describe("BR-REQ-070-04 the contact form's fields", () => {
  it("accepts a person's message and trims what a phone keyboard adds", () => {
    const parsed = contactFields.parse({ ...VALID, name: " Ana Popescu ", email: " ana@example.com ", message: " Salut! " });
    expect(parsed.name).toBe("Ana Popescu");
    expect(parsed.email).toBe("ana@example.com");
    expect(parsed.message).toBe("Salut!");
  });

  it("refuses a missing name, a malformed address, an empty message and one past the cap, naming each box", () => {
    const rejectedFields = (input: Record<string, unknown>) => {
      try {
        readContactInput(input);
      } catch (error) {
        if (isDomainError(error)) return error.fields;
        throw error;
      }
      return null;
    };
    expect(rejectedFields({ ...VALID, name: "  " })).toEqual(["name"]);
    expect(rejectedFields({ ...VALID, email: "ana@" })).toEqual(["email"]);
    expect(rejectedFields({ ...VALID, message: "" })).toEqual(["message"]);
    expect(rejectedFields({ ...VALID, message: "x".repeat(CONTACT_MESSAGE_MAX + 1) })).toEqual(["message"]);
    // Every box at once, in the form's order rather than the schema's.
    expect(rejectedFields({ locale: "ro" })).toEqual(["name", "email", "message"]);
    expect(rejectedFields(VALID)).toBeNull();
  });

  it("keeps the longest message a rejection can carry: the cap fits the draft cookie", () => {
    // The page promises "your message is still written below" on every rejection, and the
    // draft cookie drops a draft it cannot hold (§142) — so the cap must fit, with the longest
    // name and address the boxes allow and a Romanian paragraph's diacritics and line breaks.
    const paragraph = "Bună ziua,\nla ce oră începe alergarea de duminică și unde ne întâlnim? Mulțumesc, aștept răspunsul. ";
    const message = paragraph.repeat(Math.ceil(CONTACT_MESSAGE_MAX / paragraph.length)).slice(0, CONTACT_MESSAGE_MAX);
    const values = { name: "N".repeat(120), email: `${"a".repeat(64)}@${"b".repeat(250)}.com`, message };
    const sealed = sealFormDraft(values, "test-secret");
    expect(sealed).not.toBeNull();
    expect(openFormDraft(sealed ?? "", "test-secret")).toEqual(values);
  });

  it("refuses a name with a line break, which would be a second mail header", () => {
    expect(contactFields.safeParse({ ...VALID, name: "Ana\r\nBcc: x@example.com" }).success).toBe(false);
  });

  it("matches the error parameters against the known lists, never trusting the URL", () => {
    expect(parseContactErrorFields("email,message,<script>")).toEqual(["email", "message"]);
    expect(parseContactErrorFields(undefined)).toEqual([]);
    expect(parseContactError("LIMITED")).toBe("LIMITED");
    expect(parseContactError("anything")).toBeNull();
  });

  it("has a label for every field and a sentence for every error, in both catalogues", () => {
    for (const catalogue of [ro, en]) {
      const contact = catalogue.Contact as { fieldNames: Record<string, string>; errors: Record<string, string> };
      for (const field of ["name", "email", "message", "captcha"]) expect(contact.fieldNames[field]).toBeTruthy();
      for (const code of ["LIMITED", "DELIVERY", "DELIVERY_NO_ADDRESS", "UNAVAILABLE", "captcha", "generic"]) {
        expect(contact.errors[code], code).toBeTruthy();
      }
    }
  });
});
