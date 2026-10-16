import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { Checkpoint } from "@/modules/event-checkpoints/domain/checkpoint";
import type { GpxProposal } from "@/modules/event-checkpoints/domain/gpx-waypoints";
import { parseGpxElevation } from "@/modules/routes/elevation/parse";
import { withClientWords } from "../../helpers/client-words";
import { elevationGpx } from "../../helpers/elevation-gpx";

/**
 * §757 — the card «Puncte de control» as the editor draws it (BR-REQ-050-02, BR-REQ-041-01 criterion 6):
 * its closed line and when it opens by itself, one block per saved point with every box named
 * `cp[i].…`, the spare rows for new ones, «Scoate» on a saved point only, the GPX's offer and its
 * preview with what is ticked, a reader's list with no form, both languages. The forms are plain
 * posts — nothing here needs a script.
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/app/[locale]/admin/events/[id]/checkpoint-actions", () => ({
  saveCheckpointsAction: async () => null,
  addGpxCheckpointsAction: async () => null,
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getLocale: async () => language,
  getMessages: async () => messages[language],
  getTranslations: async (namespace: string | { namespace: string }) => {
    const path = typeof namespace === "string" ? namespace : namespace.namespace;
    const scoped = path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], messages[language]) as Record<string, string>;
    return createTranslator({ locale: language, messages: scoped, namespace: undefined });
  },
}));

const { default: CheckpointsCard } = await import("@/modules/content/events/ui/CheckpointsCard");

const EVENT = "11111111-1111-4111-8111-111111111111";

const point = (id: string, km: number, over: Partial<Checkpoint> = {}): Checkpoint => ({
  id,
  nameRo: `Punct ${id}`,
  nameEn: `Point ${id}`,
  km,
  kinds: ["WATER"],
  cutoffMinutes: null,
  cutoffClock: null,
  noteRo: null,
  noteEn: null,
  onProfile: true,
  ...over,
});

const proposal = (name: string, km: number, over: Partial<GpxProposal> = {}): GpxProposal => ({ name, km, kinds: [], offMeters: 4, tooFar: false, ...over });

const base = { locale: "ro" as const, eventId: EVENT, checkpoints: [] as Checkpoint[], mayEdit: true, routeKm: 21.1 as number | null, profile: null, distanceMeters: null, gpx: null, previewOpen: false };

async function render(props: Partial<Parameters<typeof CheckpointsCard>[0]> = {}) {
  return renderToStaticMarkup(withClientWords(await CheckpointsCard({ ...base, ...props }), language));
}

describe("§757 the card «Puncte de control»", () => {
  it("is a named card of «Traseul» (§763): closed by default, a level-3 heading, its closed line saying there is none", async () => {
    const html = await render();
    expect(html).toContain("Puncte de control");
    expect(html).toContain("niciun punct");
    expect(html).toMatch(/<details[^>]*id="box-checkpoints"/);
    expect(html).not.toMatch(/<details[^>]*id="box-checkpoints"[^>]*open/);
    expect(/<(h[2-5])\b/.exec(html.slice(html.indexOf('id="box-checkpoints"')))?.[1]).toBe("h3");
  });

  it("draws no <form> of its own: every box and its button name the list's form (`form=`), which stands beside the save form", async () => {
    const html = await render({ checkpoints: [point("a", 5)] });
    expect(html).not.toContain("<form");
    const named = [...html.matchAll(/<input\b[^>]*\sname="[^"]*"[^>]*>|<button\b[^>]*type="submit"[^>]*>/g)].map((match) => match[0]);
    expect(named.length).toBeGreaterThan(20);
    for (const control of named) expect(control, control).toContain('form="checkpoints-form"');
  });

  it("stays closed with points saved, counting them in Romanian's three forms", async () => {
    for (const [count, words] of [
      [1, "1 punct"],
      [2, "2 puncte"],
      [20, "20 de puncte"],
    ] as const) {
      const checkpoints = Array.from({ length: count }, (_, i) => point(`p${i}`, i + 1));
      const html = await render({ checkpoints });
      expect(html).toContain(words);
      expect(html).not.toMatch(/<details[^>]*id="box-checkpoints"[^>]*open/);
    }
  });

  it("says the route's length, the limit a kilometre is held to", async () => {
    expect(await render()).toContain("Lungimea traseului: 21,1 km");
    expect(await render({ routeKm: null })).not.toContain("Lungimea traseului");
  });

  it("draws one block per saved point and every box under its own name, the saved id carried", async () => {
    const html = await render({ checkpoints: [point("a", 5, { cutoffMinutes: 75, cutoffClock: "10:15", kinds: ["WATER", "FOOD"] }), point("b", 12.5)] });
    expect(html.match(/data-testid="checkpoint-edit-row"/g)).toHaveLength(2);
    for (const index of [0, 1]) {
      for (const field of ["km", "nameRo", "nameEn", "cutoffHours", "cutoffMinutesPart", "noteRo", "noteEn"]) expect(html).toContain(`name="cp[${index}].${field}"`);
      expect(html).toContain(`name="cp[${index}].kinds"`);
      expect(html).toContain(`name="cp[${index}].remove"`);
    }
    expect(html).toContain('name="cp[0].id" value="a"');
    expect(html).toContain('name="cp[1].id" value="b"');
    // The saved values, as typed back: the kilometre with its point, the time limit as hours and minutes.
    expect(html).toMatch(/name="cp\[0\]\.km"[^>]*value="5"/);
    expect(html).toMatch(/name="cp\[0\]\.cutoffHours"[^>]*value="1"/);
    expect(html).toMatch(/name="cp\[0\]\.cutoffMinutesPart"[^>]*value="15"/);
    // A point with no limit has two empty boxes.
    expect(html).toMatch(/name="cp\[1\]\.cutoffHours"[^>]*value=""/);
    expect(html).toMatch(/name="cp\[1\]\.cutoffMinutesPart"[^>]*value=""/);
    expect(html).toMatch(/name="cp\[1\]\.km"[^>]*value="12.5"/);
  });

  it("asks «Timp limită» with the race's own two boxes — the same component, the same words and limits — each naming the list's form (§770)", async () => {
    const html = await render({ checkpoints: [point("a", 5, { cutoffMinutes: 90, cutoffClock: "10:30" })] });
    const fieldset = html.slice(html.indexOf('data-testid="checkpoint-cutoff-fieldset"'));
    expect(fieldset.slice(0, fieldset.indexOf("</fieldset>"))).toContain("Timp limită");
    const input = (name: string) => html.match(new RegExp(`<input[^>]*name="${name.replace(/[[\]]/g, "\\$&")}"[^>]*>`))?.[0] ?? "";
    const hours = input("cp[0].cutoffHours");
    const minutes = input("cp[0].cutoffMinutesPart");
    // The race's boxes: a whole number of hours up to a week's worth, minutes up to 59 (`duration.ts`).
    expect(hours).toContain('max="168"');
    expect(minutes).toContain('max="59"');
    for (const box of [hours, minutes]) {
      expect(box).toContain('form="checkpoints-form"');
      expect(box).toContain('inputMode="numeric"');
    }
    // The labels are the race's own, «Ore» and «Minute».
    expect(html).toContain(">Ore<");
    expect(html).toContain(">Minute<");
    expect(html).toContain("De la start: până atunci trebuie să treacă ultimul alergător. Lasă gol dacă nu e limită.");
    // No time of the day is asked any more.
    expect(html).not.toContain("cp[0].cutoff\"");
    expect(html).not.toContain("Ora limită");
  });

  it("says the saved limit and the clock it closes at on the point's closed line, when the start has an hour (§770)", async () => {
    const html = await render({ checkpoints: [point("a", 5, { cutoffMinutes: 90, cutoffClock: "10:30" }), point("b", 8, { cutoffMinutes: 45, cutoffClock: null })] });
    expect(html).toContain("timp limită 1 h 30 min · se închide la 10:30");
    expect(html).toContain("timp limită 45 min");
  });

  it("offers the five kinds as words, «Direcționare» among them, ticks the saved ones, and posts them under one name", async () => {
    const html = await render({ checkpoints: [point("a", 5, { kinds: ["WATER", "DIRECTION"] })] });
    const first = html.slice(html.indexOf('data-testid="checkpoint-edit-row"'), html.indexOf('data-testid="checkpoint-add"'));
    for (const word of ["Apă", "Mâncare", "Prim ajutor", "Cronometrare", "Direcționare"]) expect(first).toContain(word);
    const box = (kind: string) => first.match(new RegExp(`<input[^>]*name="cp\\[0\\]\\.kinds"[^>]*value="${kind}"[^>]*>`))?.[0] ?? "";
    expect(box("WATER")).toContain("checked");
    expect(box("DIRECTION")).toContain("checked");
    expect(box("FOOD")).not.toContain("checked");
    expect(box("FIRST_AID")).not.toContain("checked");
    expect(box("TIMING")).not.toContain("checked");
    // Five ticks per point, each naming the list's form.
    expect(first.match(/name="cp\[0\]\.kinds"/g)).toHaveLength(5);
    expect(box("DIRECTION")).toContain('form="checkpoints-form"');
    // And on a spare row too.
    const add = html.slice(html.indexOf('data-testid="checkpoint-add"'));
    expect(add.match(/name="cp\[1\]\.kinds"/g)).toHaveLength(5);
    expect(add).toContain('name="cp[1].kinds" value="DIRECTION"');
  });

  it("draws three spare rows for new points under «Adaugă puncte», numbered after the saved ones, with no «Scoate»", async () => {
    const html = await render({ checkpoints: [point("a", 5)] });
    const add = html.slice(html.indexOf('data-testid="checkpoint-add"'));
    expect(add.match(/data-testid="checkpoint-new-row"/g)).toHaveLength(3);
    for (const index of [1, 2, 3]) expect(add).toContain(`name="cp[${index}].km"`);
    // No «Scoate» box on a spare row (React's own inline script says `removeChild`, so the box's name is what is looked for).
    expect(add).not.toMatch(/name="cp\[\d+\]\.remove"/);
    expect(add).toContain('name="cp[1].id" value=""');
  });

  it("opens the add panel by itself while there are no points, and fills the whole sheet's worth when full", async () => {
    expect(await render()).toMatch(/<details[^>]*data-testid="checkpoint-add"[^>]*open|<details[^>]*open[^>]*data-testid="checkpoint-add"/);
    const full = Array.from({ length: 30 }, (_, i) => point(`p${i}`, i + 1));
    const html = await render({ checkpoints: full });
    expect(html).not.toContain('data-testid="checkpoint-add"');
    expect(html).toContain("Sunt deja 30 de puncte");
  });

  it("has a save button with its glyph and its words, tall enough for a thumb", async () => {
    const html = await render();
    expect(html).toContain("Salvează punctele");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>[^]*Salvează punctele/);
  });

  it("is a reader's list with no form for a role that cannot write", async () => {
    const html = await render({ mayEdit: false, checkpoints: [point("a", 5, { cutoffMinutes: 75, cutoffClock: "10:15", kinds: ["WATER", "FOOD", "DIRECTION"] })] });
    expect(html).toContain("Poți citi lista");
    expect(html).toContain('data-testid="checkpoints-read-only"');
    expect(html).toContain("5 km — Punct a · Apă, Mâncare, Direcționare · timp limită 1 h 15 min · se închide la 10:15");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Salvează punctele");
    expect(html).not.toMatch(/<details[^>]*id="box-checkpoints"[^>]*open/);
  });

  it("leaves out of a reader's line what a point does not have: no bare dash, «fără timp limită» as the page says it", async () => {
    const html = await render({ mayEdit: false, checkpoints: [point("a", 5, { kinds: [] })] });
    expect(html).toContain("5 km — Punct a · fără timp limită");
    expect(html).not.toContain("· —");
    expect(html).not.toContain("timp limită —");
  });

  it("is in both languages", async () => {
    language = "en";
    try {
      const html = await render({ locale: "en", checkpoints: [point("a", 5, { cutoffMinutes: 75, cutoffClock: "10:15" })] });
      expect(html).toContain("Checkpoints");
      expect(html).toContain("Save the points");
      expect(html).toContain("Name (Romanian)");
      expect(html).toContain("Name (English)");
      expect(html).toContain("1 point");
      expect(html).toContain("Time limit");
      expect(html).toContain("Direction");
      expect(html).toContain("time limit 1 h 15 min · closes at 10:15");
      expect(html).not.toContain("Cut-off");
      expect(html).toContain("The route is 21.1 km long");
    } finally {
      language = "ro";
    }
  });
});

describe("§802 the profile's tick and preview on the card", () => {
  const PROFILE = parseGpxElevation(elevationGpx())!;
  const tickOf = (html: string, index: number) => new RegExp(`<input\\b[^>]*name="cp\\[${index}\\]\\.onProfile"[^>]*>`).exec(html)?.[0] ?? "";

  it("draws «Arată pe profilul traseului» on every saved point and every spare row, with the marker that the box was drawn", async () => {
    const html = await render({ checkpoints: [point("a", 5), point("b", 7, { onProfile: false })] });
    // Two saved points and three spare rows: five boxes, five markers.
    expect(html.match(/name="cp\[\d\]\.onProfile"/g)).toHaveLength(5);
    expect(html.match(/name="cp\[\d\]\.onProfileShown" value="1"/g)).toHaveLength(5);
    expect(html.match(/Arată pe profilul traseului/g)?.length).toBeGreaterThanOrEqual(5);
    // Every one of them posts with the list's form (§763), like the other boxes.
    for (const box of html.match(/<input\b[^>]*name="cp\[\d\]\.onProfile(?:Shown)?"[^>]*>/g) ?? []) expect(box, box).toContain('form="checkpoints-form"');
  });

  it("is ticked for a saved point that is on the chart and a new row, and unticked for a point the club took off", async () => {
    const html = await render({ checkpoints: [point("a", 5), point("b", 7, { onProfile: false })] });
    expect(tickOf(html, 0)).toContain("checked");
    expect(tickOf(html, 1)).not.toContain("checked");
    // The spare rows begin ticked.
    expect(tickOf(html, 2)).toContain("checked");
    expect(tickOf(html, 4)).toContain("checked");
  });

  it("says beside each tick that an unticked point stays in the table and on the page, and that neither the page's profile nor the race number's draws it", async () => {
    const html = await render();
    // The sentence is the tick's own help, in its own row: no standalone paragraph at the top of the card.
    expect(html).not.toContain('data-testid="checkpoints-profile-help"');
    expect(html).toContain("Punctele debifate rămân în tabel și pe pagină; nici profilul paginii, nici cel de pe numărul de concurs nu le desenează.");
    expect(html).not.toContain("Numărul de concurs le arată după setarea");
  });

  it("draws the preview «Așa apare pe pagină» above the rows: the page's chart, small, with the pins of the ticked points only", async () => {
    const html = await render({ profile: PROFILE, checkpoints: [point("a", 5), point("b", 7, { onProfile: false }), point("c", 8, { kinds: ["FOOD"] })] });
    expect(html).toContain('data-testid="checkpoints-preview"');
    expect(html).toContain("Așa apare pe pagină");
    expect(html).toContain('data-variant="compact"');
    expect(html.match(/data-testid="elevation-pin"/g)).toHaveLength(2);
    expect(html).toContain("<title>Punct a</title>");
    expect(html).not.toContain("<title>Punct b</title>");
    expect(html).toContain("Se schimbă după „Salvează punctele”, nu în timp ce scrii.");
    // Above the rows: before the boxes of the first point.
    expect(html.indexOf('data-testid="checkpoints-preview"')).toBeLessThan(html.indexOf('data-testid="checkpoints-fields"'));
    expect(html).toContain("Profilul traseului: 9,0 km, de la 608 la 828 m");
  });

  it("spans the route's typed length, as the page does", async () => {
    expect(await render({ profile: PROFILE, distanceMeters: 21_100 })).toContain("Profilul traseului: 21,1 km, de la");
  });

  it("says where the profile comes from when the route has no GPX with altitudes, and draws no chart", async () => {
    const html = await render({ profile: null });
    expect(html).toContain('data-testid="checkpoints-preview-none"');
    expect(html).toContain("Profilul apare pe pagină când traseul are un fișier GPX cu altitudini.");
    expect(html).not.toContain('data-testid="elevation-chart"');
  });

  it("is drawn for a role that may only read, without the sentence about saving, and with no box to tick", async () => {
    const html = await render({ mayEdit: false, profile: PROFILE, checkpoints: [point("a", 5)] });
    expect(html).toContain('data-testid="checkpoints-preview"');
    expect(html).not.toContain("Se schimbă după");
    expect(html).not.toContain("onProfile");
  });

  it("is in both languages", async () => {
    language = "en";
    try {
      const html = await render({ locale: "en", profile: PROFILE, checkpoints: [point("a", 5, { onProfile: false }), point("c", 8, { kinds: ["FOOD"] })] });
      expect(html).toContain("Show on the route profile");
      expect(html).toContain("Unticked points stay in the table and on the page; neither the page&#x27;s profile nor the race number&#x27;s draws them.");
      expect(html).toContain("How it appears on the page");
      expect(html).toContain("It changes after “Save the points”, not while you type.");
      expect(html).not.toContain("The race number shows them");
      expect(html).toContain("Route profile: 9.0 km, from 608 to 828 m");
      expect(html).toContain("<title>Point c</title>");
      expect(html).not.toContain("<title>Point a</title>");
      expect(await render({ locale: "en", profile: null })).toContain("The profile appears on the page once the route has a GPX file with altitudes.");
    } finally {
      language = "ro";
    }
  });
});

describe("§757 «Ia punctele din GPX» on the card", () => {
  const gpx = (offered: GpxProposal[], ignored = 0) => ({ key: "test/route-gpx/00000000-0000-4000-8000-000000000000/t.gpx", offered, ignored });

  it("offers a link to the preview only when the file has points that sit on the track, and only to a role that writes", async () => {
    expect(await render()).not.toContain('data-testid="checkpoints-gpx-offer"');
    const html = await render({ gpx: gpx([proposal("Izvor", 0.8)]) });
    expect(html).toContain('data-testid="checkpoints-gpx-offer"');
    expect(html).toContain("Ia punctele din GPX");
    expect(html).toContain("checkpointsGpx=1");
    expect(html).not.toContain('data-testid="checkpoints-gpx-preview"');
    expect(await render({ mayEdit: false, gpx: gpx([proposal("Izvor", 0.8)]) })).not.toContain("Ia punctele din GPX");
  });

  it("previews the points with their kilometre and guessed kinds, each ticked to be added, in a form of its own", async () => {
    const html = await render({ previewOpen: true, gpx: gpx([proposal("Izvor", 0.8, { kinds: ["WATER"] }), proposal("Cabana", 1.56)], 1) });
    expect(html).toContain('data-testid="checkpoints-gpx-preview"');
    expect(html.match(/data-testid="checkpoints-gpx-row"/g)).toHaveLength(2);
    expect(html).toContain("0,8 km — Izvor (Apă)");
    expect(html).toContain("1,56 km — Cabana (fără tip)");
    expect(html).toMatch(/name="pick"[^>]*value="0"[^>]*checked|name="pick"[^>]*checked[^>]*value="0"|checked[^>]*name="pick"[^>]*value="0"/);
    expect(html).toContain('name="gpxKey" value="test/route-gpx/');
    expect(html).toContain("Adaugă punctele alese");
    expect(html).toContain("Închide previzualizarea");
    // The ones too far from the track are counted, not offered.
    expect(html).toContain("1 punct din fișier e la peste 300 m de traseu");
    // The preview's form is its own, apart from the list's: each of its boxes and its button name it (§763).
    const preview = html.slice(html.indexOf('id="box-checkpoints-gpx"'), html.indexOf('data-testid="checkpoints-fields"'));
    const named = [...preview.matchAll(/<input\b[^>]*\sname="[^"]*"[^>]*>|<button\b[^>]*type="submit"[^>]*>/g)].map((match) => match[0]);
    expect(named.length).toBeGreaterThan(3);
    for (const control of named) expect(control, control).toContain('form="checkpoints-gpx-form"');
  });

  it("asks a name in each language for every point: the file's name in the Romanian box, the English box empty for the club", async () => {
    const html = await render({ previewOpen: true, gpx: gpx([proposal("Izvor", 0.8)]) });
    expect(html).toMatch(/name="cp\[0\]\.nameRo"[^>]*value="Izvor"|value="Izvor"[^>]*name="cp\[0\]\.nameRo"/);
    expect(html).toMatch(/name="cp\[0\]\.nameEn"/);
    expect(html).not.toMatch(/name="cp\[0\]\.nameEn"[^>]*value="Izvor"|value="Izvor"[^>]*name="cp\[0\]\.nameEn"/);
    expect(html).toContain("scrie-l și în engleză");
  });

  it("counts the points past the route's end, with the route's length, apart from the ones off the track", async () => {
    const html = await render({ previewOpen: true, gpx: { ...gpx([proposal("Izvor", 0.8)], 0), beyondRoute: 2 } });
    expect(html).toContain("2 puncte din fișier sunt dincolo de sfârșitul traseului (21,1 km)");
    expect(html).not.toContain("la peste 300 m de traseu");
  });

  it("does not offer a point that is already on the list, and says so", async () => {
    const html = await render({ previewOpen: true, checkpoints: [point("Izvor", 0.8, { nameRo: "Izvor", nameEn: "Izvor" })], gpx: gpx([proposal("Izvor", 0.8), proposal("Cabana", 1.56)]) });
    expect(html).toContain("0,8 km — Izvor: deja pe listă");
    expect(html).not.toMatch(/name="pick"[^>]*value="0"/);
    // The second keeps its place in the offered list: the index posted is the proposal's own.
    expect(html).toMatch(/name="pick"[^>]*value="1"/);
  });
});
