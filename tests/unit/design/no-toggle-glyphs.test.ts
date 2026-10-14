import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { ALLOWED, PINNED } from "./guards-allowlist";
import { byFile, holdRatchet, importFacts, type Hit, type Source, SOURCES, stringLiterals } from "./scan";

/**
 * BR-REQ-041-01, §752, §766 — a setting is a tick box, never a toggle (the owner, 2026-10-14, of a button
 * that flipped a setting with the toggle glyph drawn on it: «nu-mi place deloc acest tip de „bifă”, nu mai
 * folosi niciodată acest tip de element»).
 *
 * The house's answer is a real tick: the `CheckboxField` inside a save form, or, for a press that saves at
 * once and may ask first, `TickButton` — a plain submit drawn as the checkbox, `role="checkbox"` and
 * `aria-checked`, its words naming the setting, 44 pixels, working with scripts off (the to-do list's
 * pattern, §752). A choice among several is a radio (`RadioField`).
 *
 * What this refuses, in every source file under `src/` (an AST walk, the same ratchet as the other design
 * guards — `guards-allowlist.ts`, whose `toggles` list is empty and has no reason to grow):
 *
 * 1. A string literal that is a toggle glyph's name — `turnOn`, `turnOff`, `toggleOn`, `toggleOff` —
 *    wherever it stands, so `icon="turnOn"`, `icon={on ? "turnOff" : "turnOn"}` and a registry key written
 *    as a string all fail. (A catalogue key such as `t("botCheck.turnOn")` is a longer literal and is the
 *    words of a confirm button, not a glyph.)
 * 2. An import of one of Material's toggle icons (`@mui/icons-material/ToggleOn`, `ToggleOff` and their
 *    Outlined, Rounded, Sharp, TwoTone forms), the registry included: the glyph has no place in the house.
 * 3. An import of `Switch` from `@mui/material` (or `@mui/material/Switch`): the sliding switch is the same
 *    element under another name.
 *
 * And the registry itself: `ACTION_ICONS` has no `turnOn` or `turnOff`, so the type of an icon name
 * refuses them too. A failure prints `file:line — what matched`.
 */
const GLYPH_NAMES = new Set(["turnOn", "turnOff", "toggleOn", "toggleOff"]);
const TOGGLE_ICON = /^@mui\/icons-material\/Toggle(?:On|Off)(?:Outlined|Rounded|Sharp|TwoTone)?$/;
const SWITCH = /^@mui\/material\/Switch$/;

/** What one source file does that the rule refuses, with its line. */
function toggleHits(source: Source): Hit[] {
  const literals = stringLiterals(source)
    .filter((literal) => GLYPH_NAMES.has(literal.text))
    .map((literal) => ({ file: source.file, line: literal.line, text: `the toggle glyph name "${literal.text}"` }));
  const imports = importFacts(source)
    .filter((fact) => !fact.typeOnly)
    .filter(
      (fact) =>
        TOGGLE_ICON.test(fact.specifier) || SWITCH.test(fact.specifier) || (fact.specifier === "@mui/material" && fact.names.some((name) => name === "Switch" || name === "*")),
    )
    .map((fact) => ({ file: source.file, line: fact.line, text: `import of ${fact.names.join(", ")} from ${fact.specifier}` }));
  return [...literals, ...imports];
}

const sample = (text: string): Source => ({ file: "src/x.tsx", text, tree: ts.createSourceFile("x.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) });

const offenders = byFile(SOURCES.flatMap(toggleHits));

describe("§766 a setting is a tick box, never a toggle", () => {
  it("scans the whole of src/ and knows what it is looking for", () => {
    expect(SOURCES.length).toBeGreaterThan(500);
    // The tick's glyphs are the registry's, and stay.
    expect(Object.keys(ACTION_ICONS)).toEqual(expect.arrayContaining(["tickOn", "tickOff"]));
    expect(SOURCES.some((source) => source.file === "src/shared/ui/TickButton.tsx")).toBe(true);
  });

  it("has no toggle glyph in the registry", () => {
    const names = Object.keys(ACTION_ICONS);
    for (const gone of GLYPH_NAMES) expect(names, `ACTION_ICONS.${gone}`).not.toContain(gone);
  });

  it("writes no toggle glyph name, imports no toggle icon and no Material switch", () => {
    holdRatchet("toggles", offenders, ALLOWED.toggles, PINNED.toggles, "A setting is a tick box: `TickButton` for a press that saves at once, `CheckboxField` in a save form (§766).");
  });

  it("the tripwire sees each way of drawing a toggle, and lets the tick and the words through", () => {
    expect(toggleHits(sample('<GlyphButton icon="turnOn" type="submit">Pornește</GlyphButton>'))).toHaveLength(1);
    expect(toggleHits(sample('<GlyphSubmitButton icon={on ? "turnOff" : "turnOn"} label="x" pendingLabel="y" />'))).toHaveLength(2);
    // A quoted key and a constant are strings; a bare key is an identifier, which the registry test above catches.
    expect(toggleHits(sample('const map = { turnOn: ToggleOnIcon, "turnOff": ToggleOffIcon };\nconst name = "turnOff";'))).toHaveLength(2);
    expect(toggleHits(sample('import ToggleOnIcon from "@mui/icons-material/ToggleOn";'))).toHaveLength(1);
    expect(toggleHits(sample('import ToggleOffIcon from "@mui/icons-material/ToggleOffOutlined";'))).toHaveLength(1);
    expect(toggleHits(sample('import Switch from "@mui/material/Switch";'))).toHaveLength(1);
    expect(toggleHits(sample('import { Box, Switch } from "@mui/material";'))).toHaveLength(1);
    expect(toggleHits(sample('const Lazy = () => import("@mui/icons-material/ToggleOn");'))).toHaveLength(1);
    // The tick, the words of a confirm button, a radio and the theme's own mode button are not toggles.
    expect(toggleHits(sample('<TickButton checked={on}>Verificarea anti-bot pornită</TickButton>'))).toEqual([]);
    expect(toggleHits(sample('<GlyphButton icon={on ? "tickOn" : "tickOff"} />'))).toEqual([]);
    expect(toggleHits(sample('confirmLabel: t("botCheck.turnOff"), label: t(`x.${on ? "turnOn" : "turnOff"}`)'))).toHaveLength(2);
    expect(toggleHits(sample('const label = t("botCheck.honeypot.turnOn");'))).toEqual([]);
    expect(toggleHits(sample('import Checkbox from "@mui/material/Checkbox";\nimport Box from "@mui/material";'))).toEqual([]);
    expect(toggleHits(sample('// the turnOn glyph is gone\nconst note = "no toggle here";'))).toEqual([]);
  });
});
