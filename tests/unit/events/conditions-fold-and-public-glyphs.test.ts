import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { BUTTON_GLYPH_PX } from "@/shared/ui/button-glyph";

/**
 * §498 — the owner, 2026-09-27, of the group run's sign button on the event page: "that button
 * needs to be smaller an have an icon (as do all the butons from this website)", and the brief
 * around it: the rules, the photographs notice and the self-declaration under one closed
 * «Condiții de participare» fold, the declaration's heading without «(opțional)».
 *
 * Source-level, like `action-icons.test.ts` and `page-sections.test.ts`: the page reads cached
 * rows, and what is held here — the fold's shape and every public button's glyph — is written in
 * the source.
 */

const ROOT = path.resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const PAGE = read("src/app/[locale]/events/[slug]/page.tsx");
const OFFER = read("src/modules/group-run-declarations/ui/DeclarationOffer.tsx");

describe("§498 «Condiții de participare»", () => {
  const fold = PAGE.slice(PAGE.indexOf('data-testid="conditions-fold"'), PAGE.indexOf("<OpenFoldFromHash />"));

  it("is one closed native fold after the programme and before the start list, titled by a real h2 in its summary", () => {
    expect(fold.length).toBeGreaterThan(0);
    expect(PAGE.indexOf('data-testid="conditions-fold"')).toBeGreaterThan(PAGE.indexOf("<EventProgramme "));
    expect(PAGE.indexOf('data-testid="conditions-fold"')).toBeLessThan(PAGE.indexOf("<StartList "));
    // Closed on arrival: no `open` on the details, whatever the address says (a fragment opens it).
    const details = PAGE.slice(PAGE.lastIndexOf('component="details"', PAGE.indexOf('data-testid="conditions-fold"')), PAGE.indexOf('data-testid="conditions-fold"'));
    expect(details).not.toMatch(/\bopen[=\s]/);
    expect(fold).toMatch(/<Box component="summary">\s*<Typography component="h2" id="conditions-title"/);
    expect(fold).toContain('t("conditions.heading")');
  });

  it("holds the rules, then the photographs notice, then the self-declaration — each drawn nowhere else", () => {
    const at = (needle: string) => fold.indexOf(needle);
    expect(at('id="rules"')).toBeGreaterThan(-1);
    expect(at("<EventPhotosNotice />")).toBeGreaterThan(at('id="rules"'));
    expect(at("<DeclarationOffer ")).toBeGreaterThan(at("<EventPhotosNotice />"));
    for (const needle of ['id="rules"', "<DeclarationOffer ", "<EventPhotosNotice />"]) {
      expect(PAGE.split(needle).length - 1, needle).toBe(1);
    }
    // The parts are h3s under the fold's h2.
    expect(fold).toMatch(/<Typography component="h3" id="rules-title"/);
    expect(OFFER).toMatch(/<Typography component="h3" variant="h3" id="declaratie-heading"/);
  });

  it("opens itself for `#rules` and `#declaratie`: the backoffice's hash island is mounted with it", () => {
    expect(PAGE).toContain('import OpenFoldFromHash from "@/shared/ui/OpenFoldFromHash";');
    expect(OFFER).toContain('id="declaratie"');
  });

  it("names the fold in both languages, and the declaration without «(opțional)»", () => {
    expect(ro.Event.conditions.heading).toBe("Condiții de participare");
    expect(en.Event.conditions.heading).toBe("Participation rules");
    expect(ro.Event.groupRunDeclaration.heading).toBe("Declarație pe propria răspundere");
    expect(en.Event.groupRunDeclaration.heading).toBe("Self-declaration");
    for (const heading of [ro.Event.groupRunDeclaration.heading, en.Event.groupRunDeclaration.heading]) {
      expect(heading).not.toMatch(/opțional|optional/i);
    }
  });

  it("asks for the declaration without calling it optional: no «Dacă vrei», no \"If you wish\"", () => {
    // Once for every date of the run since §NNN.
    expect(ro.Event.groupRunDeclaration.line).toBe(
      "Semnează declarația pe propria răspundere: o primești pe email. La o alergare care se repetă o semnezi o singură dată, pentru toată seria {event}; clubul o păstrează cât timp vii la alergări și o șterge când îi ceri.",
    );
    expect(en.Event.groupRunDeclaration.line).toBe(
      "Sign the self-declaration: you get it by email. For a run that repeats you sign it once, for the whole {event} series; the club keeps it while you keep coming to the runs and deletes it when you ask.",
    );
    for (const line of [ro.Event.groupRunDeclaration.line, en.Event.groupRunDeclaration.line]) {
      expect(line).not.toMatch(/Dacă vrei|If you wish/i);
    }
  });

  it("makes the sign button small, with a pen, and still a thumb's 44 pixels", () => {
    const button = OFFER.slice(OFFER.indexOf("<Button "), OFFER.indexOf("</Button>"));
    expect(button).toContain('size="small"');
    expect(button).toContain("...TAP_TARGET");
    expect(button).toMatch(/<DrawIcon aria-hidden="true"[^>]*sx=\{glyphSx\("small"\)\}/);
    expect(ro.Event.groupRunDeclaration.button).toBe("Semnează declarația");
    expect(en.Event.groupRunDeclaration.button).toBe("Sign the declaration");
  });
});

/**
 * The public pages' buttons. Every file a visitor's page renders a button from — the pages under
 * `app/[locale]` outside the backoffice and `/devs`, and the public modules' own components.
 *
 * `PUBLIC_FILES` is kept by hand, and it is the thing to extend: a public component added outside
 * `events/ui` — the contact form, the gallery, the team page, the newsletter — joins the walk only
 * when its file is named here (a grep of the other modules on §498's day found backoffice buttons
 * alone).
 */
const PUBLIC_ROOTS = ["src/app/[locale]", "src/modules/events/ui"];
const PUBLIC_FILES = [
  "src/modules/group-run-declarations/ui/DeclarationOffer.tsx",
  "src/modules/newsletter/ui/NewsletterSignup.tsx",
  "src/modules/registrations/ui/ActionLinkNotice.tsx",
  "src/modules/registrations/ui/CheckYourEmail.tsx",
  "src/modules/registrations/ui/ConfirmOnArrival.tsx",
  "src/modules/registrations/ui/EmailTwice.tsx",
  "src/modules/registrations/ui/ReadAndAgree.tsx",
  "src/modules/registrations/ui/RegistrationInterestForm.tsx",
  "src/shared/ui/NewBuildNotice.tsx",
  "src/shared/ui/SiteNav.tsx",
];
const BACKOFFICE = /^src\/app\/\[locale\]\/(admin|devs)\//;

function tsxUnder(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory)).flatMap((entry) => {
    const relative = `${directory}/${entry}`;
    if (statSync(path.join(ROOT, relative)).isDirectory()) return tsxUnder(relative);
    return relative.endsWith(".tsx") ? [relative] : [];
  });
}

/**
 * Buttons that wear no separate glyph on purpose, each with the reason:
 * - the race's conditions row (§422): the required checkbox drawn on the button's own surface is
 *   its picture, and a second glyph beside the box would read as a second control.
 * - the header's «Meniu ▾» / ☰ (`SiteNav`): an entry of the header's row, not a verb, and it
 *   already draws its own glyph in text — the ☰ on a phone, the ▾ from `sm` up — with no icon file.
 */
const WITHOUT_GLYPH = new Set([
  "src/modules/registrations/ui/ReadAndAgree.tsx:agreed ? agreedLabel : openLabel",
  'src/shared/ui/SiteNav.tsx:id="site-nav-more"',
]);

const BUTTONS = new Set(["Button", "ButtonLink", "SubmitButton"]);

/**
 * Whether a JSX subtree draws a glyph: an `…Icon` element (`SocialIcon` too), or an element the
 * caller hands in — `{children}` (`InstagramShareButton`) or `{icon}` (`ShareLinks`' pills).
 */
function drawsGlyph(node: ts.Node): boolean {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    const tag = node.tagName.getText();
    if (/Icon$/.test(tag) || tag === "Glyph") return true;
  }
  if (ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression) && ["children", "icon"].includes(node.expression.text)) return true;
  return ts.forEachChild(node, (child) => (drawsGlyph(child) ? true : undefined)) ?? false;
}

function buttonsWithoutGlyph(file: string): string[] {
  const text = read(file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening && BUTTONS.has(opening.tagName.getText())) {
      const attributes = opening.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => attribute.name.getText());
      const byProp = attributes.some((name) => name === "startIcon" || name === "runner" || name === "glyph");
      const byChild = ts.isJsxElement(node) && node.children.some((child) => drawsGlyph(child));
      const exempt = [...WITHOUT_GLYPH].some((allowed) => {
        const cut = allowed.indexOf(".tsx:") + ".tsx".length;
        const [where, words] = [allowed.slice(0, cut), allowed.slice(cut + 1)];
        return where === file && node.getText().includes(words);
      });
      if (!byProp && !byChild && !exempt) found.push(`${file}:${source.getLineAndCharacterOfPosition(opening.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("§498 every public button wears a glyph", () => {
  const files = [...PUBLIC_ROOTS.flatMap(tsxUnder).filter((file) => !BACKOFFICE.test(file)), ...PUBLIC_FILES];

  it("walks the public pages' buttons", () => {
    // Not blind: the walk reaches the event page, the registration pages and the sign button.
    expect(files).toContain("src/app/[locale]/events/[slug]/page.tsx");
    expect(files).toContain("src/app/[locale]/registrations/mine/[token]/page.tsx");
    expect(files).toContain("src/modules/group-run-declarations/ui/DeclarationOffer.tsx");
    expect(files.some((file) => BACKOFFICE.test(file))).toBe(false);
  });

  it("finds no Button, ButtonLink or SubmitButton on a public page without one", () => {
    expect(files.flatMap(buttonsWithoutGlyph)).toEqual([]);
  });

  it("the exception is still there and still what it says", () => {
    expect(read("src/modules/registrations/ui/ReadAndAgree.tsx")).toContain("{agreed ? agreedLabel : openLabel}");
  });

  it("draws a public SubmitButton's glyph in MUI's start-icon slot, where the running figure takes its place", () => {
    const button = read("src/shared/ui/SubmitButton.tsx");
    expect(button).toMatch(/children\?: ReactNode;/);
    expect(button).toMatch(/\) : Glyph \? \(\s*<Glyph fontSize="small" \/>\s*\) : \(\s*\(children \?\? undefined\)\s*\)/);
  });

  it("sizes a glyph drawn as a child as MUI's start-icon slot and SubmitButton do", () => {
    expect(BUTTON_GLYPH_PX).toEqual({ small: 18, medium: 20, large: 22 });
    expect(read("src/shared/ui/SubmitButton.tsx")).toContain("const GLYPH_PX = { small: 18, medium: 20, large: 22 } as const;");
  });

  it("imports each public glyph from its own file, never the barrel or the backoffice's registry", () => {
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(/from "@mui\/icons-material"/);
      expect(text, file).not.toMatch(/from "[^"]*action-icons"/);
    }
  });
});
