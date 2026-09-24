import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NeverKeptField, RecallHidden, RecallProvider } from "@/shared/forms/recall";

/**
 * The two boxes a refusal treats differently from `RecallField` (`DECISIONS.md` §312).
 *
 * Rendered to HTML on the server, the way a refused POST with JavaScript off reaches the
 * browser: whatever these print is what the next press posts.
 */
function renderWith(values: Record<string, string[]> | null, fields: string[], node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(
      RecallProvider,
      // The children go in as `createElement`'s third argument, which the props type cannot see.
      { value: { values, fields, generation: values ? 1 : 0, fieldError: "Verifică acest câmp." } } as unknown as ComponentProps<typeof RecallProvider>,
      node,
    ),
  );
}

describe("RecallHidden — the version guard after a refusal", () => {
  it("posts the version the refused press carried, not the newer one the page read from the database", () => {
    // A CONFLICT with JavaScript off: the page is rendered again from the row a colleague just
    // saved (version 4) while the boxes hold edits made against version 3.
    const html = renderWith({ "event.expectedVersion": ["3"] }, [], createElement(RecallHidden, { name: "event.expectedVersion", value: 4 }));
    expect(html).toContain('value="3"');
    expect(html).not.toContain('value="4"');
  });

  it("posts the page's own version when nothing has been refused", () => {
    const html = renderWith(null, [], createElement(RecallHidden, { name: "event.expectedVersion", value: 4 }));
    expect(html).toBe('<input type="hidden" name="event.expectedVersion" value="4"/>');
  });

  it("is what every version guard under a kept form uses", () => {
    // A plain hidden version input under an `ActionForm` is the hole this closes; each of the
    // four save forms that carries one says `RecallHidden` instead.
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    const guards: Array<[string, RegExp]> = [
      ["src/app/[locale]/admin/events/[id]/page.tsx", /<RecallHidden name="event\.expectedVersion"/],
      ["src/modules/content/events/ui/TranslationFields.tsx", /<RecallHidden name=\{name\("expectedVersion"\)\}/],
      ["src/app/[locale]/admin/pages/[id]/page.tsx", /<RecallHidden name="expectedVersion" value=\{page\.version\}/],
      ["src/app/[locale]/admin/gallery/[id]/page.tsx", /<RecallHidden name="expectedVersion" value=\{album\.version\}/],
    ];
    for (const [file, guard] of guards) expect(read(file), file).toMatch(guard);
    expect(read("src/app/[locale]/admin/events/[id]/page.tsx")).not.toContain('<input type="hidden" name="event.expectedVersion"');
  });
});

describe("NeverKeptField — a confirmation asked again", () => {
  it("never prints what was typed, but carries the id the summary links to and marks itself", () => {
    const html = renderWith(
      { typedTitle: ["Crosul de toamnă"], reason: ["dublură"] },
      ["typedTitle"],
      createElement(NeverKeptField, { name: "typedTitle", label: "Titlul", helperText: "Scrie: Crosul de toamnă" }),
    );
    expect(html).toContain('id="field-typedTitle"');
    expect(html).toContain('aria-invalid="true"');
    // The instruction stays beside "check this field" — it is what says what to type.
    expect(html).toContain("Verifică acest câmp.");
    expect(html).toContain("Scrie: Crosul de toamnă");
    expect(html).not.toMatch(/value="Crosul de toamnă"/);
  });

  it("is unmarked and empty on first paint", () => {
    const html = renderWith(null, [], createElement(NeverKeptField, { name: "confirmName", label: "Numele" }));
    expect(html).toContain('id="field-confirmName"');
    expect(html).toContain('aria-invalid="false"');
    expect(html).not.toContain("Verifică acest câmp.");
  });
});
