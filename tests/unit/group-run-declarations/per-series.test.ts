import { describe, expect, it } from "vitest";
import { keptSignature, type SeriesSignature, signedStateFor, signerIdentity } from "@/modules/group-run-declarations/domain";
import { factsToKeep, readSignedFacts, seriesMergeValues, seriesRhythmPhrase, signatureCoversSeries } from "@/modules/group-run-declarations/series";
import { dropsParagraph, isPlacelessSeriesSentence, mergeLegalBody } from "@/modules/legal-documents/domain/merge-fields";
import { groupRunTrailEn, groupRunTrailRo } from "@/modules/legal-documents/templates/group-run-declaration";

/**
 * §NNN — one self-declaration per person per series of group runs. The owner, 2026-09-27: "a
 * returning runner signs once; it has no end date and is deleted only at their request".
 *
 * The pure half: who a signature is (the canonical address and the name, read loosely); which
 * signature a press keeps rather than writing a second — and that it never takes one away; what the
 * run's page says to the person who opened it from their own link; and the text's series sentence
 * and one-off sentence, one of which the renderer keeps.
 */

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

const row = (id: string, overrides: Partial<SeriesSignature> = {}): SeriesSignature => ({
  id,
  legalDocumentId: V1,
  email: "ana@example.ro",
  typedName: "Ana Popescu",
  acceptedAt: new Date("2026-10-01T08:00:00Z"),
  ...overrides,
});

describe("§NNN who a signature is", () => {
  it("reads the address canonically and the name without case, accents or extra spaces", () => {
    const ana = signerIdentity("ana@example.ro", "Ana Popescu");
    expect(ana).not.toBeNull();
    expect(signerIdentity("  Ana@Example.RO ", "ana  popescu ")).toBe(ana);
    expect(signerIdentity("ana@example.ro", "Ană Popescu")).toBe(ana);
  });

  it("tells two people on one address apart (a family, §389), and one person on two addresses", () => {
    expect(signerIdentity("ana@example.ro", "Ion Popescu")).not.toBe(signerIdentity("ana@example.ro", "Ana Popescu"));
    expect(signerIdentity("ana@example.com", "Ana Popescu")).not.toBe(signerIdentity("ana@example.ro", "Ana Popescu"));
  });

  it("is nobody for an address that is not one", () => {
    expect(signerIdentity("not an address", "Ana Popescu")).toBeNull();
  });
});

describe("§NNN which signature a press keeps", () => {
  const ana = { email: "ANA@example.ro", typedName: "ana popescu" };

  it("keeps none for a person's first signature, and never another person's", () => {
    expect(keptSignature([], ana, V1)).toBeNull();
    expect(keptSignature([row("ion", { typedName: "Ion Popescu" })], ana, V1)).toBeNull();
  });

  it("keeps the signature of the version in force, to be sent again to the address it was signed with", () => {
    expect(keptSignature([row("a1", { email: "Ana@Example.ro" })], ana, V1)).toMatchObject({ id: "a1", email: "Ana@Example.ro" });
  });

  it("keeps no older version's: the person signs the new one, and the older stays as it is", () => {
    expect(keptSignature([row("old")], ana, V2)).toBeNull();
  });

  it("keeps the earliest of the version in force; it names nothing to delete", () => {
    const rows = [
      row("later", { acceptedAt: new Date("2026-10-08T08:00:00Z") }),
      row("first", { acceptedAt: new Date("2026-10-01T08:00:00Z") }),
      row("older-version", { legalDocumentId: V2, acceptedAt: new Date("2026-09-01T08:00:00Z") }),
    ];
    const kept = keptSignature(rows, ana, V1);
    expect(kept?.id).toBe("first");
    expect(Object.keys(kept ?? {})).not.toContain("superseded");
  });

  it("keeps nothing for a signer whose address is not one: the service refuses the address first", () => {
    expect(keptSignature([row("a1")], { email: "nope", typedName: "Ana Popescu" }, V1)).toBeNull();
  });
});

describe("§NNN what the run's page says from the signer's own link", () => {
  const signed = { legalDocumentId: V1, version: 1, acceptedAt: new Date("2026-10-01T08:00:00Z") };

  it("says «already signed» for the version in force, and asks again once a newer one is", () => {
    expect(signedStateFor(signed, V1)).toEqual({ kind: "current", version: 1, acceptedAt: signed.acceptedAt });
    expect(signedStateFor(signed, V2)).toEqual({ kind: "renew", version: 1, acceptedAt: signed.acceptedAt });
  });

  it("says nothing without a declaration the link names", () => {
    expect(signedStateFor(undefined, V1)).toBeNull();
  });
});

describe("§NNN the series' rhythm, in the declaration's language", () => {
  const TZ = "Europe/Bucharest";
  // Tuesdays at 18:30 in Brașov (15:30 UTC in October).
  const tuesdays = [6, 13, 20].map((day) => ({ startsAt: new Date(`2026-10-${String(day).padStart(2, "0")}T15:30:00.000Z`) }));

  it("says a weekly run's day and hour", () => {
    expect(seriesRhythmPhrase(tuesdays, TZ, "ro")).toBe("în fiecare marți, la 18:30");
    expect(seriesRhythmPhrase(tuesdays, TZ, "en")).toBe("every Tuesday at 18:30");
  });

  it("says a fortnightly one's, and points dates with no weekly shape to the site", () => {
    // Thursdays two weeks apart at 08:00 in Brașov, all before the clocks change on 25 October.
    const fortnight = ["2026-09-03", "2026-09-17", "2026-10-01"].map((day) => ({ startsAt: new Date(`${day}T05:00:00.000Z`) }));
    expect(seriesRhythmPhrase(fortnight, TZ, "ro")).toBe("o dată la două săptămâni, joi, la 08:00");
    expect(seriesRhythmPhrase(fortnight, TZ, "en")).toBe("every other Thursday at 08:00");
    const odd = [{ startsAt: new Date("2026-10-01T05:00:00Z") }, { startsAt: new Date("2026-10-04T05:00:00Z") }, { startsAt: new Date("2026-10-19T05:00:00Z") }];
    expect(seriesRhythmPhrase(odd, TZ, "ro")).toBe("la datele anunțate pe site-ul clubului");
    expect(seriesRhythmPhrase(odd, TZ, "en")).toBe("on the dates announced on the club's website");
  });
});

describe("§NNN the series sentence and the one-off sentence", () => {
  const base = { participant: "Ana Popescu", event: "Tura de marți", eventDate: "marți, 6 oct. 2026", eventLocation: "Parcul Titulescu", minimumAge: "18 ani" };
  const series = { key: "GROUP_RUN\ntura de marți", title: "Tura de marți", rhythm: "în fiecare marți, la 18:30", place: "Parcul Titulescu" };
  const merged = (values: Record<string, string>) => JSON.stringify(mergeLegalBody(groupRunTrailRo, values));

  it("keeps the series sentence for a run that is one of a series, with its name, rhythm and place, and drops the one-off sentence", () => {
    const text = merged({ ...base, ...(seriesMergeValues(groupRunTrailRo, series) as Record<string, string>) });
    expect(text).toContain("Declarația este valabilă pentru toate alergările seriei Tura de marți — în fiecare marți, la 18:30, cu plecare de obicei din Parcul Titulescu —");
    expect(text).not.toContain("Declarația este pentru alergarea de grup");
    expect(text).not.toContain("marți, 6 oct. 2026");
    // One series sentence: the shape without the place is dropped while there is a place.
    expect(text).not.toContain("seriei Tura de marți — în fiecare marți, la 18:30 — la care");
    expect(text.match(/Declarația este valabilă pentru toate alergările seriei/g)).toHaveLength(1);
  });

  it("keeps the one-off sentence for a run of one date, with its date and place, and drops the series sentence", () => {
    const text = merged({ ...base, ...(seriesMergeValues(groupRunTrailRo, null) as Record<string, string>) });
    expect(text).toContain("Declarația este pentru alergarea de grup Tura de marți, marți, 6 oct. 2026, cu plecare din Parcul Titulescu.");
    expect(text).not.toContain("toate alergările seriei");
  });

  it("reads the same in English", () => {
    const seriesText = JSON.stringify(mergeLegalBody(groupRunTrailEn, { ...base, ...(seriesMergeValues(groupRunTrailEn, { ...series, rhythm: "every Tuesday at 18:30" }) as Record<string, string>) }));
    expect(seriesText).toContain("valid for every run of the series Tura de marți — every Tuesday at 18:30, usually starting from Parcul Titulescu —");
    expect(seriesText).not.toContain("This declaration is for the group run");
    const oneText = JSON.stringify(mergeLegalBody(groupRunTrailEn, { ...base, ...(seriesMergeValues(groupRunTrailEn, null) as Record<string, string>) }));
    expect(oneText).toContain("This declaration is for the group run Tura de marți on marți, 6 oct. 2026");
    expect(oneText).not.toContain("every run of the series");
  });

  it("gives a text that names no series field no series value, so an older version loses no sentence", () => {
    const older = { sections: [{ paragraphs: ["Subsemnatul/a {{participant}}, particip la alergarea {{event}} din {{eventDate}}."] }] };
    expect(seriesMergeValues(older, series)).toEqual({});
    expect(dropsParagraph(older.sections[0].paragraphs[0], { ...base })).toBe(false);
  });

  it("drops a paragraph naming the date and no series field only while the series has a value", () => {
    expect(dropsParagraph("la {{event}}, {{eventDate}}", { series: "Tura" })).toBe(true);
    expect(dropsParagraph("la {{event}}, {{eventDate}}", { series: "" })).toBe(false);
    expect(dropsParagraph("seria {{series}}, {{eventDate}}", { series: "Tura" })).toBe(false);
    expect(dropsParagraph("seria {{series}}", { series: "" })).toBe(true);
  });
});

describe("§NNN what a signature keeps of the blanks", () => {
  it("keeps the run's and the series' facts, never a name or a document", () => {
    const kept = factsToKeep({ participant: "Ana", idDocument: "CI BV 1", event: "Tura", eventDate: "marți", series: "", seriesRhythm: "", minimumAge: "18 ani" });
    expect(kept).toEqual({ event: "Tura", eventDate: "marți", series: "", seriesRhythm: "", minimumAge: "18 ani" });
  });

  it("reads them back, and nothing from a value nobody wrote this way", () => {
    expect(readSignedFacts({ event: "Tura", series: "Tura", participant: "Ana", eventDate: 7 })).toEqual({ event: "Tura", series: "Tura" });
    expect(readSignedFacts(null)).toBeNull();
    expect(readSignedFacts([])).toBeNull();
    expect(readSignedFacts({ participant: "Ana" })).toBeNull();
  });
});

/*
  §NNN, the review's nit — a series whose place is not written in that language: the series sentence
  keeps its second shape, without «cu plecare de obicei din …», and never drops both it and the one-off.
*/
describe("§NNN the series sentence without a place", () => {
  const base = { participant: "Ana Popescu", event: "Tura de marți", eventDate: "marți, 6 oct. 2026", eventLocation: "", minimumAge: "18 ani" };
  const placeless = { key: "GROUP_RUN\ntura de marți", title: "Tura de marți", rhythm: "în fiecare marți, la 18:30", place: "  " };

  it("keeps the shape without the place clause, and drops the one with it and the one-off sentence", () => {
    const values: Record<string, string> = { ...base, ...(seriesMergeValues(groupRunTrailRo, placeless) as Record<string, string>) };
    expect(values.seriesPlace).toBe("");
    const text = JSON.stringify(mergeLegalBody(groupRunTrailRo, values));
    expect(text).toContain("Declarația este valabilă pentru toate alergările seriei Tura de marți — în fiecare marți, la 18:30 — la care particip de la semnare");
    expect(text).not.toContain("cu plecare de obicei din");
    expect(text).not.toContain("Declarația este pentru alergarea de grup");
    expect(text.match(/Declarația este valabilă pentru toate alergările seriei/g)).toHaveLength(1);
  });

  it("reads the same in English", () => {
    const values = { ...base, ...(seriesMergeValues(groupRunTrailEn, { ...placeless, rhythm: "every Tuesday at 18:30" }) as Record<string, string>) };
    const text = JSON.stringify(mergeLegalBody(groupRunTrailEn, values));
    expect(text).toContain("valid for every run of the series Tura de marți — every Tuesday at 18:30 — that I take part in");
    expect(text).not.toContain("usually starting from");
    expect(text).not.toContain("This declaration is for the group run");
  });

  it("drops both series shapes on a one-off run, keeping the one-off sentence", () => {
    const text = JSON.stringify(mergeLegalBody(groupRunTrailRo, { ...base, ...(seriesMergeValues(groupRunTrailRo, null) as Record<string, string>) }));
    expect(text).not.toContain("toate alergările seriei");
    expect(text).toContain("Declarația este pentru alergarea de grup Tura de marți");
  });

  it("tells the two shapes apart, and keeps a text's only series sentence with a dotted place rather than dropping it", () => {
    expect(isPlacelessSeriesSentence("seria {{series}} — {{seriesRhythm}} — la care")).toBe(true);
    expect(isPlacelessSeriesSentence("seria {{series}} — {{seriesRhythm}}, din {{seriesPlace}}")).toBe(false);
    expect(isPlacelessSeriesSentence("alergarea {{event}}, {{eventDate}}")).toBe(false);
    // A club's text with one series sentence, the place in it: no place gives it no value to drop it by.
    const onlyPlaced = { sections: [{ paragraphs: ["Seria {{series}} — {{seriesRhythm}}, din {{seriesPlace}}.", "Alergarea {{event}}, {{eventDate}}."] }] };
    const values = seriesMergeValues(onlyPlaced, placeless);
    expect(values).toEqual({ series: "Tura de marți", seriesRhythm: "în fiecare marți, la 18:30" });
    const kept = mergeLegalBody(onlyPlaced, { ...base, ...values }).sections[0].paragraphs;
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain("Seria Tura de marți — în fiecare marți, la 18:30, din");
  });
});

/*
  §NNN, the review's second blocker — a signature covers the series only when the text it signs says
  so: the platform's text names {{series}}; the version approved on production before it names one run.
*/
describe("§NNN which text a series signature needs", () => {
  it("covers the series under a text that names {{series}}, and one date under one that does not", () => {
    expect(signatureCoversSeries(groupRunTrailRo)).toBe(true);
    expect(signatureCoversSeries(groupRunTrailEn)).toBe(true);
    expect(signatureCoversSeries({ sections: [{ paragraphs: ["Particip la alergarea {{event}}, {{eventDate}}, din {{eventLocation}}."] }] })).toBe(false);
    expect(signatureCoversSeries(null)).toBe(false);
  });
});
