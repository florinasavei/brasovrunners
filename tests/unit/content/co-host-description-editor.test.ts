import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { coHostLinkRowSchema, coHostRowSchema, eventFieldsSchema } from "@/modules/content/events/fields";
import CoHostRowsEditor from "@/modules/content/events/ui/CoHostRowsEditor";
import { MAX_CO_HOST_DESCRIPTION } from "@/modules/events/domain/co-hosts";
import { htmlConstraints } from "@/shared/forms/constraints";
import { RecallProvider } from "@/shared/forms/recall";

/**
 * BR-REQ-011-01 criterion 16 (§NNN) — "Despre parteneriat" in the partner's card: two boxes,
 * Română and English, right under the partner's name, whose ceiling is read off the schema, and
 * which come back exactly as typed after a refused save (§315) with the empty side marked.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const LABELS: ComponentProps<typeof CoHostRowsEditor>["labels"] = {
  add: "Adaugă un partener",
  remove: "Șterge partenerul",
  moveUp: "Mută mai sus partenerul",
  moveDown: "Mută mai jos partenerul",
  partnerNew: "Partener nou",
  name: "Numele partenerului",
  about: "Despre parteneriat",
  descriptionRo: "Română",
  descriptionEn: "English",
  descriptionHelp: "Opțional, în ambele limbi.",
  identical: "Textul în engleză e identic cu cel în română — e tradus?",
  kind: "Tip",
  url: "Adresa (https://…)",
  labelRo: "Eticheta în română (opțional)",
  labelEn: "Eticheta în engleză (opțional)",
  addLink: "Adaugă un link",
  removeLink: "Șterge linkul",
  moveLinkUp: "Mută mai sus linkul",
  moveLinkDown: "Mută mai jos linkul",
  link: "Linkul",
  ofPartner: "al partenerului {p}",
};

const KIND_LABELS = {
  SITE: "Site-ul partenerului",
  EVENT: "Evenimentul partenerului",
  REGISTRATION: "Înscriere la partener",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  STRAVA: "Strava",
  OTHER: "Link",
} as const;

const CONSTRAINTS = {
  url: htmlConstraints(coHostLinkRowSchema.shape.url),
  label: htmlConstraints(coHostLinkRowSchema.shape.labelRo),
  description: htmlConstraints(coHostRowSchema.shape.descriptionRo),
};

function render(initial: ComponentProps<typeof CoHostRowsEditor>["initial"], recalled?: { values: Record<string, string[]>; fields: string[] }) {
  const editor = createElement(CoHostRowsEditor, { initial, labels: LABELS, kindLabels: KIND_LABELS, constraints: CONSTRAINTS });
  if (!recalled) return renderToStaticMarkup(editor);
  return renderToStaticMarkup(
    createElement(
      RecallProvider,
      { value: { values: recalled.values, fields: recalled.fields, generation: 1, fieldError: "Verifică acest câmp." } } as unknown as ComponentProps<
        typeof RecallProvider
      >,
      editor,
    ),
  );
}

/** The `<textarea>` a box posts under `name`, as the browser receives it, and what it holds. */
function textarea(html: string, name: string): { tag: string; value: string } {
  const escaped = name.replace(/[[\]]/g, "\\$&");
  const match = new RegExp(`(<textarea[^>]*name="${escaped}"[^>]*>)([^<]*)</textarea>`).exec(html);
  return { tag: match?.[1] ?? "", value: match?.[2] ?? "" };
}

describe("BR-REQ-011-01 criterion 16 the partner's description in the editor (§NNN)", () => {
  it("reads the boxes' ceiling off the schema, so the browser refuses what the server would", () => {
    expect(CONSTRAINTS.description).toEqual({ maxLength: MAX_CO_HOST_DESCRIPTION });
  });

  it("draws both boxes under the name, each posting its own language, with the stored text", () => {
    const html = render([
      { name: "Brașov Running Festival", descriptionRo: "Alergăm împreună.", descriptionEn: "We run together.", links: [] },
    ]);
    const ro = textarea(html, "event.coHosts[0].descriptionRo");
    const en = textarea(html, "event.coHosts[0].descriptionEn");
    expect(ro.value).toBe("Alergăm împreună.");
    expect(en.value).toBe("We run together.");
    expect(ro.tag).toContain(`maxLength="${MAX_CO_HOST_DESCRIPTION}"`);
    // Under the name, before the partner's links.
    expect(html.indexOf('name="event.coHosts[0].name"')).toBeLessThan(html.indexOf('name="event.coHosts[0].descriptionRo"'));
    expect(html.indexOf('name="event.coHosts[0].descriptionEn"')).toBeLessThan(html.indexOf('name="event.coHosts[0].links[0].url"'));
    expect(html).toContain("Despre parteneriat");
  });

  it("opens a half-written pair with its half, so it can be completed", () => {
    const html = render([{ name: "Brașov Running Festival", descriptionRo: "Alergăm împreună.", descriptionEn: "", links: [] }]);
    expect(textarea(html, "event.coHosts[0].descriptionRo").value).toBe("Alergăm împreună.");
    expect(textarea(html, "event.coHosts[0].descriptionEn").value).toBe("");
  });

  it("comes back as typed after a refused save, on the card it was typed in, the empty side marked", () => {
    // What the form posted: two cards, the second described in Romanian only.
    const values = {
      "event.coHosts[0].name": ["Salvamont"],
      "event.coHosts[0].descriptionRo": [""],
      "event.coHosts[0].descriptionEn": [""],
      "event.coHosts[1].name": ["Brașov Running Festival"],
      "event.coHosts[1].descriptionRo": ["Alergăm împreună duminică."],
      "event.coHosts[1].descriptionEn": [""],
      "event.coHosts[1].links[0].kind": ["REGISTRATION"],
      "event.coHosts[1].links[0].url": ["https://festival.example.test/inscriere"],
      "event.coHosts[1].links[0].labelRo": [""],
      "event.coHosts[1].links[0].labelEn": [""],
    };
    const html = render([], { values, fields: ["event.coHosts[1].descriptionEn"] });
    expect(textarea(html, "event.coHosts[1].descriptionRo").value).toBe("Alergăm împreună duminică.");
    const english = textarea(html, "event.coHosts[1].descriptionEn");
    expect(english.value).toBe("");
    expect(english.tag).toContain('aria-invalid="true"');
    // The summary's link lands on this box.
    expect(english.tag).toContain('id="field-event.coHosts[1].descriptionEn"');
    expect(textarea(html, "event.coHosts[0].descriptionEn").tag).not.toContain('aria-invalid="true"');

    // And the names it posts are the ones the save reads and the schema judges: the round trip.
    const reader = read("src/app/[locale]/admin/actions.ts");
    expect(reader).toContain(String.raw`/^event\.coHosts\[(\d+)\]\.(name|descriptionRo|descriptionEn)$/`);
    const parsed = eventFieldsSchema.shape.coHosts.safeParse([
      { name: "Salvamont", descriptionRo: "", descriptionEn: "", links: [] },
      { name: "Brașov Running Festival", descriptionRo: "Alergăm împreună duminică.", descriptionEn: "", links: [] },
    ]);
    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toEqual(["1.descriptionEn"]);
  });
});
