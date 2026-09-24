import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-011-01 criterion 20 (`DECISIONS.md` §332, §315) — a refused link is named by its row.
 *
 * The refusal summary lists each field a refusal names as a link to its box, under the label
 * `eventFormFieldLabels` gives that box's `name`. For the links that label is the row and what
 * is wrong with it — "Linkul 2: adresa trebuie să înceapă cu https://" — so the organizer is
 * sent to the second row on the screen rather than to "Linkuri: Adresa" among eight.
 *
 * The labels are built from the catalogue on the server; here the catalogue is the real one,
 * handed to the function through a translator made from the same JSON the app ships.
 */
let catalogue: Record<string, unknown> = ro;
let locale: "ro" | "en" = "ro";
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale, messages: catalogue, namespace: namespace as never }),
}));

const { eventFormFieldLabels } = await import("@/modules/content/events/ui/field-labels");

describe("BR-REQ-011-01 criterion 20 the refusal summary names the link's row", () => {
  it("names the address of each row by its number, in Romanian", async () => {
    catalogue = ro;
    locale = "ro";
    const labels = await eventFormFieldLabels();
    expect(labels["event.links[1].url"]).toBe("Linkul 2: adresa trebuie să înceapă cu https://");
    expect(labels["event.links[0].url"]).toBe("Linkul 1: adresa trebuie să înceapă cu https://");
    expect(labels["event.links[11].url"]).toBe("Linkul 12: adresa trebuie să înceapă cu https://");
    expect(labels["event.links[2].labelEn"]).toBe("Linkul 3: eticheta în engleză are cel mult 80 de caractere");
    expect(labels["event.links[0].kind"]).toBe("Linkul 1: alege tipul din listă");
    // The whole list, for "more than twelve".
    expect(labels["event.links"]).toBe("Linkuri și fișiere: cel mult 12 pe un eveniment");
    // A partner's link, named by both the card and the row.
    expect(labels["event.coHosts[1].links[2].url"]).toBe("Partenerul 2, linkul 3: adresa trebuie să înceapă cu https://");
  });

  it("names them in English on the English backoffice", async () => {
    catalogue = en;
    locale = "en";
    const labels = await eventFormFieldLabels();
    expect(labels["event.links[1].url"]).toBe("Link 2: the address must start with https://");
    expect(labels["event.links"]).toBe("Links and files: at most 12 on one event");
  });
});

/**
 * `costRule` (`content/events/fields.ts`) names `event.costAmount` only for a `PAID` event and
 * `event.costUrl` only for a `DONATION` one, so each has one real label — never the raw name a
 * caller sees when `ActionForm.labelOf` finds none (§343).
 */
describe("the cost amount and the donation link are named, not left as their own path", () => {
  it("gives «Suma» and «Link pentru donație» in Romanian", async () => {
    catalogue = ro;
    locale = "ro";
    const labels = await eventFormFieldLabels();
    expect(labels["event.costAmount"]).toBe("Suma");
    expect(labels["event.costUrl"]).toBe("Link pentru donație");
  });

  it("gives «Amount» and «Donation link» in English", async () => {
    catalogue = en;
    locale = "en";
    const labels = await eventFormFieldLabels();
    expect(labels["event.costAmount"]).toBe("Amount");
    expect(labels["event.costUrl"]).toBe("Donation link");
  });
});
