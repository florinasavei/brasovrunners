import { describe, expect, it } from "vitest";
import { type ConfirmSpec, resolveChangedRows } from "@/shared/feedback/notice";

/**
 * §NNN — «Salvează tot clasamentul» asks first, naming the rows it changes (the owner, 2026-11-22: «salvează clasamentul trebuie să fie
 * sus floating și să confirm modificările salvate»). The page draws every line as it stands; at the press the browser compares each
 * posted box with it (`resolveChangedRows`) and the question counts the rows and names each with its boxes. Nothing changed, nothing
 * asked — the save goes through and the toast says nothing changed.
 */
const spec: ConfirmSpec = {
  title: "Salvezi clasamentul?",
  body: "",
  confirmLabel: "Salvează",
  cancelLabel: "Renunță",
  changedRows: {
    rows: [
      { key: "r[101]", label: "#101 Ana Pop", was: { time: "0:50:00", status: "FINISHED", chip: "", note: "" } },
      { key: "r[102]", label: "#102 Bia Marin", was: { time: "", status: "", chip: "", note: "" } },
      { key: "n[0]", label: "#210 Ingrid Mutter", was: { bib: "210", name: "Ingrid Mutter", sex: "", birthDate: "", time: "0:40:56", status: "FINISHED", chip: "", note: "", agreed: "on" } },
    ],
    boxes: { bib: "Nr.", name: "Nume", sex: "Sex", birthDate: "Data nașterii", time: "Timp", status: "Stare", chip: "Timp cip", note: "Notă", agreed: "Acordul pentru nume" },
    newLabel: "#{bib} {name}",
    newFallback: "Alergător neînscris",
    separator: ", ",
    forms: { one: "Se schimbă un rând.", few: "Se schimbă {count} rânduri.", other: "Se schimbă {count} de rânduri." },
    locale: "ro",
    max: 2,
    more: "și încă {count}",
  },
};

/** The form as posted: every box of the three drawn rows as drawn, then the changes over it; `undefined` takes a box off the form. */
function posted(changes: Record<string, string | undefined> = {}): { valueOf: (field: string) => string | null; names: string[] } {
  const values: Record<string, string | undefined> = {
    "r[101].time": "0:50:00",
    "r[101].status": "FINISHED",
    "r[101].chip": "",
    "r[101].note": "",
    "r[102].time": "",
    "r[102].status": "",
    "r[102].chip": "",
    "r[102].note": "",
    "n[0].bib": "210",
    "n[0].name": "Ingrid Mutter",
    "n[0].sex": "",
    "n[0].birthDate": "",
    "n[0].time": "0:40:56",
    "n[0].status": "FINISHED",
    "n[0].chip": "",
    "n[0].note": "",
    "n[0].agreed": "on",
    intent: "save",
    eventId: "e",
    ...changes,
  };
  const names = Object.keys(values).filter((name) => values[name] !== undefined);
  return { valueOf: (field) => values[field] ?? null, names };
}

const ask = (changes?: Record<string, string | undefined>) => {
  const { valueOf, names } = posted(changes);
  return resolveChangedRows(spec, valueOf, names);
};

describe("§NNN «Salvează tot clasamentul» names the rows it changes", () => {
  it("asks nothing when nothing moved — a box typed with spaces around it is the same box", () => {
    expect(ask()).toBeNull();
    expect(ask({ "r[101].note": "  " })).toBeNull();
  });

  it("counts the rows and names each with its boxes, in the line's order", () => {
    const asked = ask({ "r[101].time": "0:49:58", "r[101].status": "DNF", "n[0].sex": "FEMALE" });
    expect(asked?.body).toBe("Se schimbă 2 rânduri.");
    expect(asked?.lines).toEqual(["#101 Ana Pop: Timp, Stare", "#210 Ingrid Mutter: Sex"]);
    expect(asked?.changedRows).toBeUndefined();
    expect(asked?.title).toBe("Salvezi clasamentul?");
  });

  it("reads a tick taken off as a change, and a line emptied as one", () => {
    const asked = ask({ "n[0].agreed": undefined, "r[101].time": "", "r[101].status": "" });
    expect(asked?.lines).toEqual(["#101 Ana Pop: Timp, Stare", "#210 Ingrid Mutter: Acordul pentru nume"]);
  });

  it("names a line added in the browser by the number and the name typed in it, or by its word when it has neither", () => {
    expect(ask({ "n[1].bib": "555", "n[1].name": " Ion  Vasile ", "n[1].time": "47:00" })?.lines).toEqual(["#555 Ion Vasile: Nr., Nume, Timp"]);
    expect(ask({ "n[1].bib": "", "n[1].time": "47:00" })?.lines).toEqual(["Alergător neînscris: Timp"]);
    // A blank line added and left blank changes nothing.
    expect(ask({ "n[1].bib": "", "n[1].name": "", "n[1].time": "" })).toBeNull();
  });

  it("says one row in its own words, and past `max` lines the rest as a count", () => {
    expect(ask({ "r[102].time": "45:00" })?.body).toBe("Se schimbă un rând.");
    const many = ask({ "r[101].note": "x", "r[102].time": "45:00", "n[0].note": "y" });
    expect(many?.body).toBe("Se schimbă 3 rânduri.");
    expect(many?.lines).toEqual(["#101 Ana Pop: Notă", "#102 Bia Marin: Timp", "și încă 1"]);
  });

  it("never names a drawn row the form does not post, and leaves a spec without rows as it is", () => {
    expect(ask({ "r[102].time": undefined, "r[102].status": undefined, "r[102].chip": undefined, "r[102].note": undefined })).toBeNull();
    const plain: ConfirmSpec = { title: "t", body: "b", confirmLabel: "c", cancelLabel: "x" };
    expect(resolveChangedRows(plain, () => null, [])).toBe(plain);
  });
});
