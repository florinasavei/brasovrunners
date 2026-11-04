import { describe, expect, it } from "vitest";
import { emailMessageType } from "@/db/schema/email-outbox";
import { catalogueOf } from "@/i18n/catalogue";
import { isJobCause, isPressCause, mainTypesOf, PRESS_CAUSE_NAMES, PRESS_CAUSES } from "@/modules/notifications/domain/press-causes";

/**
 * The closed list of what queues an email (the design «telling the owner about every email a staff press sends»,
 * slice 1): each press's cause and the two jobs', stamped on every row as `email_outbox.cause`. «Emailuri azi» names
 * each press by its cause, so every cause has its words in both catalogues — the page reads the merged catalogue,
 * the club's own sentences over the platform's — and every main type it names is a message type that exists.
 */
const lookup = (catalogue: Record<string, unknown>, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), catalogue);

describe("the press causes", () => {
  it("has words for every cause in both catalogues", () => {
    for (const locale of ["ro", "en"] as const) {
      const catalogue = catalogueOf(locale) as unknown as Record<string, unknown>;
      for (const cause of PRESS_CAUSE_NAMES) {
        const words = lookup(catalogue, `Admin.emails.causes.${cause}`);
        expect(typeof words, `${locale}: ${cause}`).toBe("string");
        expect((words as string).trim(), `${locale}: ${cause}`).not.toBe("");
      }
    }
  });

  it("names only message types that exist, each once per cause", () => {
    const types = new Set<string>(emailMessageType.enumValues);
    for (const cause of PRESS_CAUSE_NAMES) {
      const main = mainTypesOf(cause);
      for (const type of main) expect(types.has(type), `${cause}: ${type}`).toBe(true);
      expect(new Set(main).size, cause).toBe(main.length);
    }
  });

  it("is a closed set of `<area>.<verb>` tokens: the two jobs, and every staff area's presses", () => {
    for (const cause of PRESS_CAUSE_NAMES) expect(cause).toMatch(/^(registrations|events|volunteers|club|job)\.[a-zA-Z]+$/);
    expect(PRESS_CAUSE_NAMES.filter(isJobCause).sort()).toEqual(["job.emailOutbox", "job.registrationMaintenance"]);
    // A job acts on nobody in particular: it names no main email.
    for (const cause of PRESS_CAUSE_NAMES.filter(isJobCause)) expect(PRESS_CAUSES[cause]).toEqual([]);
  });

  it("reads a stored cause back only when it is one of these", () => {
    expect(isPressCause("registrations.cancel")).toBe(true);
    expect(isPressCause("job.emailOutbox")).toBe(true);
    for (const value of ["registrations.unknown", "toString", "", null, undefined, 3]) expect(isPressCause(value), String(value)).toBe(false);
  });
});
